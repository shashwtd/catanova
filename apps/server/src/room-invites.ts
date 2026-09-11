import { randomUUID } from 'node:crypto';
import type { AccountService } from './accounts.js';
import { accountFailure } from './accounts.js';
import { RoomAccessLimit } from './room-access.js';
import { ProtocolError, type Store } from './store.js';
import type { Account, PublicAccount } from '../../../packages/protocol/src/profile.js';
import { isRoomReference, isShortRoomCode } from '../../../packages/protocol/src/room-reference.js';
import type {
  RoomInvite,
  RoomInvitesState,
  SentRoomInvite,
} from '../../../packages/protocol/src/room-invites.js';

export const ROOM_INVITE_TTL_MS = 5 * 60_000;
export const ROOM_INVITE_ACCOUNT_LIMIT = 20;
const GLOBAL_LIMIT = 10_000;
type InviteRow = {
  id: string;
  room_id: string;
  sender_id: string;
  recipient_id: string;
  created_at: number;
  expires_at: number;
  dismissed: number;
};

/** Small durable invitations share the game's backup, while friendships remain authoritative in Supabase. */
export class RoomInviteService {
  private readonly reads = new RoomAccessLimit(30);
  private readonly writes = new RoomAccessLimit(30);
  constructor(
    private readonly store: Store,
    private readonly accounts: Pick<AccountService, 'get' | 'friends'>,
    private readonly now = Date.now,
  ) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS room_invites (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
        sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN (0,1)),
        UNIQUE(sender_id,recipient_id,room_id)
      );
      CREATE INDEX IF NOT EXISTS room_invites_recipient ON room_invites(recipient_id,expires_at);
      CREATE INDEX IF NOT EXISTS room_invites_sender ON room_invites(sender_id,expires_at);
      CREATE INDEX IF NOT EXISTS room_invites_expiry ON room_invites(expires_at);
    `);
  }
  private async actor(token: string | undefined, writing = false): Promise<Account> {
    const account = await this.accounts.get(token);
    if (account.expiresAt !== null && Date.parse(account.expiresAt) <= this.now())
      throw accountFailure('GUEST_EXPIRED');
    if (!account.registered || !account.profile) throw accountFailure('ONBOARDING_REQUIRED');
    if (account.isGuest) throw accountFailure('GOOGLE_REQUIRED');
    if (!(writing ? this.writes : this.reads).consume(account.id, this.now()).allowed)
      throw accountFailure('ACCOUNT_RATE_LIMIT');
    return account;
  }
  private sweep() {
    this.store.db.prepare('DELETE FROM room_invites WHERE expires_at<=?').run(this.now());
  }
  private openRoom(roomId: string, sender: string, recipient: string) {
    if (!this.store.hasAccountSeat(roomId, sender)) return null;
    if (
      this.store.hasAccountSeat(roomId, recipient) ||
      this.store.db.prepare('SELECT 1 FROM games WHERE room_id=?').get(roomId)
    )
      return null;
    const players = this.store.db
      .prepare('SELECT COUNT(*) AS count FROM seats WHERE room_id=? AND departed=0')
      .get(roomId)?.count as number | undefined;
    if (!players || players >= 4) return null;
    return { players, roomCode: this.store.roomCode(roomId) };
  }
  private incoming(row: InviteRow, from: PublicAccount): RoomInvite | null {
    const room = this.openRoom(row.room_id, row.sender_id, row.recipient_id);
    return room
      ? {
          id: row.id,
          roomId: row.room_id,
          ...(room.roomCode ? { roomCode: room.roomCode } : {}),
          from,
          players: room.players,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        }
      : null;
  }
  private sent(row: InviteRow): SentRoomInvite {
    return {
      id: row.id,
      roomId: row.room_id,
      to: row.recipient_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }
  async list(token: string | undefined): Promise<RoomInvitesState> {
    const actor = await this.actor(token);
    // Removal of a friendship revokes its outstanding invitations as soon as the list is read.
    const friends = new Map(
      (await this.accounts.friends(token)).friends
        .filter((friend) => !friend.isGuest)
        .map((friend) => [friend.id, friend]),
    );
    this.sweep();
    const incoming = (
      this.store.db
        .prepare(
          'SELECT * FROM room_invites WHERE recipient_id=? AND dismissed=0 AND expires_at>? ORDER BY created_at DESC LIMIT ?',
        )
        .all(actor.id, this.now(), ROOM_INVITE_ACCOUNT_LIMIT) as InviteRow[]
    ).flatMap((row) => {
      const from = friends.get(row.sender_id);
      const invite = from ? this.incoming(row, from) : null;
      return invite ? [invite] : [];
    });
    const sent = (
      this.store.db
        .prepare(
          'SELECT * FROM room_invites WHERE sender_id=? AND expires_at>? ORDER BY created_at DESC LIMIT ?',
        )
        .all(actor.id, this.now(), ROOM_INVITE_ACCOUNT_LIMIT) as InviteRow[]
    )
      .filter(
        (row) => friends.has(row.recipient_id) && this.openRoom(row.room_id, row.sender_id, row.recipient_id),
      )
      .map((row) => this.sent(row));
    return { incoming, sent };
  }
  async send(token: string | undefined, input: unknown): Promise<RoomInvite> {
    const actor = await this.actor(token, true);
    const data =
      input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    if (
      typeof data.roomId !== 'string' ||
      !isRoomReference(data.roomId) ||
      isShortRoomCode(data.roomId) ||
      typeof data.other !== 'string' ||
      data.other === actor.id
    )
      throw new ProtocolError('INVITE_INVALID', 'Choose a friend and a current room.');
    const friend = (await this.accounts.friends(token)).friends.find(
      (friend) => friend.id === data.other && !friend.isGuest,
    );
    if (!friend)
      throw new ProtocolError('INVITE_NOT_FRIENDS', 'You can invite players who are already your friends.');
    const roomId = data.roomId;
    // Check membership and room phase after the remote authority read, immediately before the write.
    if (!this.openRoom(roomId, actor.id, friend.id))
      throw new ProtocolError(
        'INVITE_ROOM_UNAVAILABLE',
        'This room is full, started, or no longer available for invitations.',
      );
    this.sweep();
    const existing = this.store.db
      .prepare('SELECT * FROM room_invites WHERE sender_id=? AND recipient_id=? AND room_id=?')
      .get(actor.id, friend.id, roomId) as InviteRow | undefined;
    const from = { id: actor.id, username: actor.username!, isGuest: false, profile: actor.profile! };
    if (existing) {
      if (existing.dismissed)
        throw new ProtocolError(
          'INVITE_ALREADY_SENT',
          'You already invited this player. Give them a moment.',
        );
      return this.incoming(existing, from)!;
    }
    const count = (column: 'sender_id' | 'recipient_id', id: string) =>
      this.store.db.prepare(`SELECT COUNT(*) AS count FROM room_invites WHERE ${column}=?`).get(id)!
        .count as number;
    if (
      count('sender_id', actor.id) >= ROOM_INVITE_ACCOUNT_LIMIT ||
      count('recipient_id', friend.id) >= ROOM_INVITE_ACCOUNT_LIMIT ||
      (this.store.db.prepare('SELECT COUNT(*) AS count FROM room_invites').get()!.count as number) >=
        GLOBAL_LIMIT
    )
      throw new ProtocolError(
        'INVITE_LIMIT',
        'There are too many recent invitations. Try again in a few minutes.',
      );
    const now = this.now();
    const row: InviteRow = {
      id: randomUUID(),
      room_id: roomId,
      sender_id: actor.id,
      recipient_id: friend.id,
      created_at: now,
      expires_at: now + ROOM_INVITE_TTL_MS,
      dismissed: 0,
    };
    this.store.db
      .prepare(
        'INSERT INTO room_invites(id,room_id,sender_id,recipient_id,created_at,expires_at) VALUES(?,?,?,?,?,?)',
      )
      .run(row.id, roomId, actor.id, friend.id, now, row.expires_at);
    return this.incoming(row, from)!;
  }
  async dismiss(token: string | undefined, input: unknown): Promise<{ dismissed: true }> {
    const actor = await this.actor(token, true);
    const id = input && typeof input === 'object' ? (input as { id?: unknown }).id : undefined;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
      throw new ProtocolError('INVITE_INVALID', 'This invitation is no longer available.');
    // Keep a short tombstone so repeatedly inviting a player cannot undo their dismissal.
    this.store.db
      .prepare('UPDATE room_invites SET dismissed=1 WHERE id=? AND recipient_id=?')
      .run(id, actor.id);
    return { dismissed: true };
  }
}
