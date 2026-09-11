import {
  isRoomReference,
  isShortRoomCode,
  normalizeRoomReference,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../../../packages/protocol/src/room-reference.js';
import { defaultProfile, parseProfile } from '../../../packages/protocol/src/profile.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
import type { HistoryEntry } from '../../../packages/protocol/src/index.js';
import { DEFAULT_ROOM_SETTINGS, parseRoomSettings } from '../../../packages/protocol/src/settings.js';
import type { RoomSettings, TurnClock } from '../../../packages/protocol/src/settings.js';
import type { Identity } from './auth.js';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  applyAction,
  createGame,
  gameView,
  parseGameAction,
  resignPlayers,
} from '../../../packages/rules/src/game.js';
import type { Game, GameAction } from '../../../packages/rules/src/game.js';
import { timeoutAction, timeoutDescription } from '../../../packages/rules/src/timeout.js';
import { generateBoard, shuffle } from '../../../packages/rules/src/board.js';
import type { Board } from '../../../packages/rules/src/board.js';
import { PlayerRecords, parseGamesCursor } from './player-records.js';
import { setImmediate } from 'node:timers/promises';

export class ProtocolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type Seat = { id: string; room_id: string; name: string };
type Receipt = { expected_revision: number; revision: number; counter: number };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const privateRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;
export const ROOM_CODE_LEASE_MS = 30 * 24 * 60 * 60 * 1000;
export const RECONNECT_GRACE_MS = 3 * 60 * 1000;
type Absence = { disconnectedAt: number; resignAt: number };
type Presence = { version?: 2; pausedAt?: number; seats: Record<string, Absence> };
const ROOM_CODE_SPACE = ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH;
function codeForSlot(slot: number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code = ROOM_CODE_ALPHABET[slot % ROOM_CODE_ALPHABET.length]! + code;
    slot = Math.floor(slot / ROOM_CODE_ALPHABET.length);
  }
  return code;
}

/** Single-process probe store. Cloud play will use the Postgres adapter described in docs. */
export class Store {
  readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly codeRandom: (max: number) => number;
  private readonly trackPresence: boolean;
  private readonly records: PlayerRecords;
  private connectedSeats = new Set<string>();
  private readonly pendingPresence = new Set<string>();
  private dueRoomCursor = '';
  constructor(
    path: string,
    options: {
      now?: () => number;
      random?: () => number;
      codeRandom?: (max: number) => number;
      trackPresence?: boolean;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? privateRandom;
    this.codeRandom = options.codeRandom ?? ((max) => randomInt(max));
    this.trackPresence = options.trackPresence ?? false;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
        counter INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS room_codes (
        code TEXT PRIMARY KEY CHECK(length(code)=4 AND code NOT GLOB '*[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]*'),
        slot INTEGER NOT NULL UNIQUE CHECK(slot>=0 AND slot<1048576),
        room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id), expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS room_codes_expiry ON room_codes(expires_at);
      CREATE TABLE IF NOT EXISTS seats (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
        token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS seats_room ON seats(room_id);
      CREATE TABLE IF NOT EXISTS receipts (
        room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES seats(id),
        command_id TEXT NOT NULL, expected_revision INTEGER NOT NULL,
        revision INTEGER NOT NULL, counter INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS games (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id), state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_receipts (
        room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES seats(id),
        command_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
        revision INTEGER NOT NULL, counter INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, profile TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lobby_receipts (
        room_id TEXT NOT NULL, player_id TEXT NOT NULL, command_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL, revision INTEGER NOT NULL, counter INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS settings_receipts (
        room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES seats(id),
        command_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
        revision INTEGER NOT NULL, counter INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS room_settings (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id), settings TEXT NOT NULL,
        revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS turn_clocks (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id), state TEXT NOT NULL,
        next_deadline INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS clocks_due ON turn_clocks(next_deadline);
      CREATE TABLE IF NOT EXISTS room_presence (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id), state TEXT NOT NULL, next_deadline INTEGER
      );
      CREATE INDEX IF NOT EXISTS presence_due ON room_presence(next_deadline);
      CREATE TABLE IF NOT EXISTS game_events (
        room_id TEXT NOT NULL REFERENCES rooms(id), revision INTEGER NOT NULL,
        command_id TEXT NOT NULL, actor TEXT, action TEXT NOT NULL,
        previous_hash TEXT, state_hash TEXT NOT NULL, state TEXT NOT NULL,
        public_entry TEXT NOT NULL, PRIMARY KEY(room_id, revision)
      );
      CREATE TABLE IF NOT EXISTS room_boards (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id), board TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leave_receipts (
        room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES seats(id),
        command_id TEXT NOT NULL, expected_revision INTEGER NOT NULL,
        revision INTEGER NOT NULL, counter INTEGER NOT NULL, released INTEGER NOT NULL,
        PRIMARY KEY(room_id, player_id, command_id)
      );
    `);
    if (
      !this.db
        .prepare('PRAGMA table_info(seats)')
        .all()
        .some((column) => column.name === 'departed')
    )
      this.db.exec('ALTER TABLE seats ADD COLUMN departed INTEGER NOT NULL DEFAULT 0');
    const columns = this.db
      .prepare('PRAGMA table_info(seats)')
      .all()
      .map((c) => c.name);
    for (const [name, type] of [
      ['user_id', 'TEXT'],
      ['profile', 'TEXT'],
      ['ready', 'INTEGER NOT NULL DEFAULT 0'],
    ])
      if (!columns.includes(name)) this.db.exec('ALTER TABLE seats ADD COLUMN ' + name + ' ' + type);
    this.db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS seat_account_room ON seats(user_id, room_id) WHERE user_id IS NOT NULL AND departed = 0',
    );
    this.records = new PlayerRecords(this.db);
    if (this.trackPresence) this.initializePresence();
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Anonymous previews are read-only: code leases only change after admitted player activity. */
  resolveRoom(reference: string): string {
    const normalized = normalizeRoomReference(reference);
    if (!isRoomReference(normalized)) throw new ProtocolError('ROOM_NOT_FOUND', 'Room not found');
    if (isShortRoomCode(normalized)) {
      const row = this.db
        .prepare('SELECT room_id FROM room_codes WHERE code=? AND expires_at>?')
        .get(normalized, this.now()) as { room_id: string } | undefined;
      if (!row)
        throw new ProtocolError('ROOM_NOT_FOUND', 'Room not found. Check the code or ask for a new invite.');
      return row.room_id;
    }
    if (!this.db.prepare('SELECT 1 FROM rooms WHERE id=?').get(normalized))
      throw new ProtocolError('ROOM_NOT_FOUND', 'Room not found');
    return normalized;
  }
  roomCode(roomId: string): string | undefined {
    return this.db
      .prepare('SELECT code FROM room_codes WHERE room_id=? AND expires_at>?')
      .get(roomId, this.now())?.code as string | undefined;
  }
  /** Must run inside the caller's successful admission/action transaction. */
  private renewRoomCode(roomId: string, required = false): string | undefined {
    const old = this.db.prepare('SELECT code FROM room_codes WHERE room_id=?').get(roomId) as
      { code: string } | undefined;
    if (old) {
      this.db
        .prepare('UPDATE room_codes SET expires_at=? WHERE room_id=?')
        .run(this.now() + ROOM_CODE_LEASE_MS, roomId);
      return old.code;
    }
    this.db.prepare('DELETE FROM room_codes WHERE expires_at<=?').run(this.now());
    let slot: number | undefined;
    for (let attempt = 0; attempt < 32; attempt++) {
      const candidate = this.codeRandom(ROOM_CODE_SPACE);
      if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate >= ROOM_CODE_SPACE)
        throw new Error('Invalid room code randomness');
      if (!this.db.prepare('SELECT 1 FROM room_codes WHERE slot=?').get(candidate)) {
        slot = candidate;
        break;
      }
    }
    if (slot === undefined) {
      // Ordered bounded scan finds the first gap, without an unbounded random retry loop.
      let candidate = 0;
      for (const row of this.db.prepare('SELECT slot FROM room_codes ORDER BY slot').iterate()) {
        if (row.slot !== candidate) break;
        candidate++;
      }
      if (candidate < ROOM_CODE_SPACE) slot = candidate;
    }
    if (slot === undefined) {
      if (required)
        throw new ProtocolError(
          'ROOM_CODES_FULL',
          'All room codes are in use. Please try creating a room later.',
        );
      return undefined; // Existing games and permanent resume links still work when aliases are exhausted.
    }
    const code = codeForSlot(slot);
    this.db
      .prepare('INSERT INTO room_codes(code,slot,room_id,expires_at) VALUES(?,?,?,?)')
      .run(code, slot, roomId, this.now() + ROOM_CODE_LEASE_MS);
    return code;
  }
  enter(
    mode: 'create' | 'join' | 'resume',
    token: string,
    name: string,
    roomId?: string,
    identity?: Identity,
    requestedProfile?: Profile,
  ): Seat {
    return this.transaction(() => {
      if (roomId) roomId = this.resolveRoom(roomId);
      let existing = this.db
        .prepare('SELECT id, room_id, name, departed, user_id FROM seats WHERE token_hash = ?')
        .get(hash(token)) as (Seat & { departed: number; user_id: string | null }) | undefined;
      if (existing?.user_id && existing.user_id !== identity?.id)
        throw new ProtocolError('AUTH_MISMATCH', 'This seat belongs to another account');
      if (!existing && identity && roomId) {
        existing = this.db
          .prepare(
            'SELECT id, room_id, name, departed, user_id FROM seats WHERE user_id = ? AND room_id = ? AND departed = 0',
          )
          .get(identity.id, roomId) as (Seat & { departed: number; user_id: string | null }) | undefined;
        if (existing)
          this.db.prepare('UPDATE seats SET token_hash = ? WHERE id = ?').run(hash(token), existing.id);
      }
      // Retrying a handshake after its reply was lost returns the same seat and room.
      if (existing) {
        if (existing.departed) throw new ProtocolError('SEAT_LEFT', 'You permanently left this room');
        if (roomId && existing.room_id !== roomId)
          throw new ProtocolError('INVALID_SESSION', 'Seat belongs to another room');
        if (identity && !existing.user_id)
          this.db.prepare('UPDATE seats SET user_id = ? WHERE id = ?').run(identity.id, existing.id);
        // Account cosmetics/names are canonical before a match starts; live match names stay historical.
        if (identity?.profile && !this.loadGame(existing.room_id)) {
          const profile = parseProfile(identity.profile),
            encoded = JSON.stringify(profile);
          const saved = this.db.prepare('SELECT profile FROM seats WHERE id=?').get(existing.id)!;
          if (saved.profile !== encoded || existing.name !== profile.name) {
            this.db
              .prepare('UPDATE seats SET name=?,profile=?,ready=0 WHERE id=?')
              .run(profile.name, encoded, existing.id);
            this.db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=?').run(existing.room_id);
            existing.name = profile.name;
          }
        }
        this.renewRoomCode(existing.room_id);
        return { id: existing.id, room_id: existing.room_id, name: existing.name };
      }
      if (mode === 'resume') throw new ProtocolError('INVALID_SESSION', 'This seat cannot be resumed');
      if (mode === 'create') {
        roomId = randomUUID();
        this.db.prepare('INSERT INTO rooms(id) VALUES (?)').run(roomId);
        this.renewRoomCode(roomId, true);
        this.board(roomId);
      } else if (!this.db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId!)) {
        throw new ProtocolError('ROOM_NOT_FOUND', 'Room not found');
      }
      if (
        (this.db.prepare('SELECT COUNT(*) AS n FROM seats WHERE room_id = ? AND departed = 0').get(roomId!)!
          .n as number) >= 4
      )
        throw new ProtocolError('ROOM_FULL', 'Room already has four seats');
      if (this.loadGame(roomId!))
        throw new ProtocolError('GAME_STARTED', 'This game has already started; existing players can resume');
      const profile = identity
        ? (identity.profile ?? this.profile(identity.id, identity.name))
        : parseProfile(requestedProfile ?? defaultProfile(name));
      const seat = { id: randomUUID(), room_id: roomId!, name: profile.name };
      this.db
        .prepare(
          'INSERT INTO seats(id, room_id, token_hash, name, user_id, profile) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(seat.id, seat.room_id, hash(token), profile.name, identity?.id ?? null, JSON.stringify(profile));
      this.renewRoomCode(seat.room_id);
      return seat;
    });
  }
  snapshot(roomId: string, viewer?: string) {
    const room = this.db.prepare('SELECT revision, counter FROM rooms WHERE id = ?').get(roomId) as {
      revision: number;
      counter: number;
    };
    const game = this.loadGame(roomId);
    const players = (
      this.db
        .prepare('SELECT id, name, profile, ready, departed FROM seats WHERE room_id = ? ORDER BY rowid')
        .all(roomId) as {
        id: string;
        name: string;
        profile: string | null;
        ready: number;
        departed: number;
      }[]
    ).filter((p) => (game ? game.players.some((player) => player.id === p.id) : !p.departed));
    const presence = this.presence(roomId);
    const roomCode = this.roomCode(roomId);
    return {
      roomId,
      ...(roomCode ? { roomCode } : {}),
      ...room,
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        profile: p.profile ? (JSON.parse(p.profile) as Profile) : defaultProfile(p.name),
        ready: !!p.ready,
        ...presence?.seats[p.id],
      })),
      ...(presence?.pausedAt !== undefined ? { paused: true } : {}),
      historyRevision: this.eventHead(roomId)?.revision ?? 0,
      settings: this.settings(roomId),
      serverNow: this.now(),
      ...(this.clock(roomId) ? { turnClock: this.clock(roomId)! } : {}),
      board: this.board(roomId),
      ...(game && viewer ? { game: gameView(game, viewer) } : {}),
    };
  }
  board(roomId: string): Board {
    const game = this.loadGame(roomId);
    if (game) return game.board;
    const saved = this.db.prepare('SELECT board FROM room_boards WHERE room_id = ?').get(roomId) as
      { board: string } | undefined;
    if (saved) return JSON.parse(saved.board) as Board;
    if (!this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId))
      throw new ProtocolError('ROOM_NOT_FOUND', 'Room not found');
    const board = generateBoard(randomInt(0, 2 ** 32));
    this.db
      .prepare('INSERT INTO room_boards(room_id, board) VALUES (?, ?)')
      .run(roomId, JSON.stringify(board));
    return board;
  }
  preview(reference: string) {
    const roomId = this.resolveRoom(reference);
    const state = this.snapshot(roomId);
    return {
      roomId,
      ...(state.roomCode ? { roomCode: state.roomCode } : {}),
      board: state.board,
      players: state.players,
      settings: state.settings,
      started: !!this.loadGame(roomId),
    };
  }
  hasAccountSeat(roomId: string, userId: string) {
    return !!this.db
      .prepare('SELECT 1 FROM seats WHERE room_id = ? AND user_id = ? AND departed = 0')
      .get(roomId, userId);
  }
  private historyCursor(rawCursor?: string) {
    try {
      return parseGamesCursor(rawCursor);
    } catch {
      throw new ProtocolError('INVALID_HISTORY_CURSOR', 'Please reload your game history');
    }
  }
  /** Synchronous helper for maintenance/tests; HTTP uses accountGamesAsync to yield between batches. */
  accountGames(userId: string, rawCursor?: string) {
    const cursor = this.historyCursor(rawCursor);
    return this.transaction(() => {
      let afterRoomId = '';
      for (;;) {
        const batch = this.records.backfillBatch(userId, (roomId) => this.loadGame(roomId), afterRoomId);
        if (batch.complete) break;
        afterRoomId = batch.afterRoomId;
      }
      return this.records.page(userId, this.now(), cursor);
    });
  }
  /** Keep the game loop responsive while older accounts gain their index; never return partial totals. */
  async accountGamesAsync(
    userId: string,
    rawCursor?: string,
    options: {
      maxDurationMs?: number;
      cancelled?: () => boolean;
    } = {},
  ) {
    const cursor = this.historyCursor(rawCursor),
      deadline = performance.now() + (options.maxDurationMs ?? 2000);
    let afterRoomId = '';
    for (;;) {
      if (options.cancelled?.())
        throw new ProtocolError('ACCOUNT_UNAVAILABLE', 'Game history request was interrupted. Please retry.');
      const result = this.transaction(() => {
        const batch = this.records.backfillBatch(userId, (roomId) => this.loadGame(roomId), afterRoomId);
        return { ...batch, page: batch.complete ? this.records.page(userId, this.now(), cursor) : undefined };
      });
      if (result.page) return result.page;
      afterRoomId = result.afterRoomId;
      if (performance.now() >= deadline)
        throw new ProtocolError(
          'ACCOUNT_UNAVAILABLE',
          'Your older game history is still being prepared. Please retry shortly.',
        );
      // Every completed batch is durable. A retry continues from the remaining matches.
      await setImmediate();
    }
  }
  leave(seat: Seat, commandId: string, expectedRevision: number) {
    const receipt = this.transaction(() => {
      this.rejectSettingsReceipt(seat, commandId);
      if (
        this.db
          .prepare('SELECT 1 FROM lobby_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used in the lobby');
      if (
        this.db
          .prepare('SELECT 1 FROM game_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId) ||
        this.db
          .prepare('SELECT 1 FROM receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used');
      const old = this.db
        .prepare(
          'SELECT expected_revision, revision, counter, released FROM leave_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as
        { expected_revision: number; revision: number; counter: number; released: number } | undefined;
      if (old) {
        if (old.expected_revision !== expectedRevision)
          throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used with different intent');
        return { revision: old.revision, counter: old.counter, released: !!old.released, duplicate: true };
      }
      const room = this.snapshot(seat.room_id);
      if (room.revision !== expectedRevision)
        throw new ProtocolError('STALE_STATE', 'The room changed; try leaving again');
      const current = this.loadGame(seat.room_id);
      const connected = new Set(this.connectedSeats);
      connected.delete(seat.id);
      this.db.prepare('UPDATE seats SET departed = 1 WHERE id = ?').run(seat.id);
      const revision = current
        ? this.saveLifecycle(
            seat.room_id,
            current,
            resignPlayers(current, [seat.id], {
              reason: 'leave',
              ...(this.trackPresence ? { winnerEligibleIds: [...connected] } : {}),
            }),
            commandId,
            seat.id,
            { kind: 'leave', player: seat.id },
            'leave',
            false,
            connected,
          )
        : room.revision + 1;
      if (!current) this.db.prepare('UPDATE rooms SET revision = ? WHERE id = ?').run(revision, seat.room_id);
      this.db
        .prepare(
          'INSERT INTO leave_receipts(room_id, player_id, command_id, expected_revision, revision, counter, released) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(seat.room_id, seat.id, commandId, expectedRevision, revision, room.counter, 1);
      this.renewRoomCode(seat.room_id);
      return { revision, counter: room.counter, released: true, duplicate: false };
    });
    // The transport is retired only after the entire resignation and receipt commit.
    this.connectedSeats.delete(seat.id);
    return receipt;
  }
  profile(userId: string, name = 'Player'): Profile {
    const row = this.db.prepare('SELECT profile FROM profiles WHERE user_id = ?').get(userId) as
      { profile: string } | undefined;
    if (row) return parseProfile(JSON.parse(row.profile));
    const profile = defaultProfile(name);
    this.saveProfile(userId, profile);
    return profile;
  }
  saveProfile(userId: string, input: Profile): Profile {
    const profile = parseProfile(input);
    this.db
      .prepare(
        'INSERT INTO profiles(user_id, profile) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile',
      )
      .run(userId, JSON.stringify(profile));
    return profile;
  }
  private eventHead(roomId: string) {
    return this.db
      .prepare(
        'SELECT revision, state_hash FROM game_events WHERE room_id = ? ORDER BY revision DESC LIMIT 1',
      )
      .get(roomId) as { revision: number; state_hash: string } | undefined;
  }
  private recordEvent(
    roomId: string,
    revision: number,
    commandId: string,
    actor: string | null,
    action: unknown,
    game: Game,
    lines: string[],
    kind: string,
    automatic = false,
  ) {
    const state = JSON.stringify(game);
    const entry: HistoryEntry = {
      revision,
      actor,
      kind,
      turn: game.turn,
      at: new Date(this.now()).toISOString(),
      lines,
      ...(automatic ? { automatic: true } : {}),
    };
    this.db
      .prepare(
        'INSERT INTO game_events(room_id, revision, command_id, actor, action, previous_hash, state_hash, state, public_entry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        roomId,
        revision,
        commandId,
        actor,
        JSON.stringify(action),
        this.eventHead(roomId)?.state_hash ?? null,
        hash(state),
        state,
        JSON.stringify(entry),
      );
    this.records.record(roomId, revision, game, entry);
  }
  history(roomId: string, before = Number.MAX_SAFE_INTEGER) {
    const rows = this.db
      .prepare(
        'SELECT public_entry FROM game_events WHERE room_id = ? AND revision < ? ORDER BY revision DESC LIMIT 41',
      )
      .all(roomId, before) as { public_entry: string }[];
    return {
      entries: rows.slice(0, 40).map((r) => JSON.parse(r.public_entry) as HistoryEntry),
      hasMore: rows.length > 40,
    };
  }
  lobby(seat: Seat, commandId: string, expectedRevision: number, ready: boolean, input?: Profile) {
    const profile = input ? parseProfile(input) : undefined;
    const payloadHash = hash(JSON.stringify({ expectedRevision, ready, profile }));
    return this.transaction(() => {
      this.rejectSettingsReceipt(seat, commandId);
      for (const table of ['receipts', 'game_receipts', 'leave_receipts'])
        if (
          this.db
            .prepare('SELECT 1 FROM ' + table + ' WHERE room_id = ? AND player_id = ? AND command_id = ?')
            .get(seat.room_id, seat.id, commandId)
        )
          throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used');
      const old = this.db
        .prepare(
          'SELECT payload_hash, revision, counter FROM lobby_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as
        { payload_hash: string; revision: number; counter: number } | undefined;
      if (old) {
        if (old.payload_hash !== payloadHash)
          throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used with different intent');
        return { revision: old.revision, counter: old.counter, duplicate: true };
      }
      const room = this.snapshot(seat.room_id);
      // Readiness is an explicit intent for this seat, independent of another seat's update.
      if (expectedRevision > room.revision)
        throw new ProtocolError('STALE_STATE', 'The lobby changed; try again');
      const settingsRevision = this.db
        .prepare('SELECT revision FROM room_settings WHERE room_id = ?')
        .get(seat.room_id)?.revision as number | undefined;
      if (settingsRevision !== undefined && expectedRevision < settingsRevision)
        throw new ProtocolError('STALE_STATE', 'Game settings changed; review them before getting ready');
      if (this.loadGame(seat.room_id)) throw new ProtocolError('GAME_STARTED', 'The game has started');
      if (!room.players.some((p) => p.id === seat.id))
        throw new ProtocolError('SEAT_LEFT', 'You left this lobby');
      if (profile) {
        this.db
          .prepare('UPDATE seats SET name = ?, profile = ? WHERE id = ?')
          .run(profile.name, JSON.stringify(profile), seat.id);
        const account = this.db.prepare('SELECT user_id FROM seats WHERE id = ?').get(seat.id)!;
        if (typeof account.user_id === 'string') this.saveProfile(account.user_id, profile);
      }
      this.db.prepare('UPDATE seats SET ready = ? WHERE id = ?').run(Number(ready), seat.id);
      const revision = room.revision + 1;
      this.db.prepare('UPDATE rooms SET revision = ? WHERE id = ?').run(revision, seat.room_id);
      this.db
        .prepare('INSERT INTO lobby_receipts VALUES (?, ?, ?, ?, ?, ?)')
        .run(seat.room_id, seat.id, commandId, payloadHash, revision, room.counter);
      this.renewRoomCode(seat.room_id);
      return { revision, counter: room.counter, duplicate: false };
    });
  }
  settings(roomId: string): RoomSettings {
    const row = this.db.prepare('SELECT settings FROM room_settings WHERE room_id = ?').get(roomId) as
      { settings: string } | undefined;
    return row ? parseRoomSettings(JSON.parse(row.settings)) : { ...DEFAULT_ROOM_SETTINGS };
  }
  private rejectSettingsReceipt(seat: Seat, commandId: string) {
    if (
      this.db
        .prepare('SELECT 1 FROM settings_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
        .get(seat.room_id, seat.id, commandId)
    )
      throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for game settings');
  }
  configureSettings(seat: Seat, commandId: string, expectedRevision: number, input: RoomSettings) {
    const settings = parseRoomSettings(input);
    const payloadHash = hash(JSON.stringify({ expectedRevision, settings }));
    return this.transaction(() => {
      for (const table of ['receipts', 'game_receipts', 'leave_receipts', 'lobby_receipts'])
        if (
          this.db
            .prepare('SELECT 1 FROM ' + table + ' WHERE room_id = ? AND player_id = ? AND command_id = ?')
            .get(seat.room_id, seat.id, commandId)
        )
          throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used');
      const old = this.db
        .prepare(
          'SELECT payload_hash, revision, counter FROM settings_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as
        { payload_hash: string; revision: number; counter: number } | undefined;
      if (old) {
        if (old.payload_hash !== payloadHash)
          throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used with different intent');
        return { revision: old.revision, counter: old.counter, duplicate: true };
      }
      const room = this.snapshot(seat.room_id);
      if (this.loadGame(seat.room_id))
        throw new ProtocolError('GAME_STARTED', 'Game settings are locked after starting');
      if (room.players[0]?.id !== seat.id)
        throw new ProtocolError('NOT_HOST', 'Only the host can change game settings');
      if (room.revision !== expectedRevision)
        throw new ProtocolError('STALE_STATE', 'The lobby changed; review the latest settings');
      const revision = room.revision + 1;
      this.db
        .prepare(
          'INSERT INTO room_settings(room_id, settings, revision) VALUES (?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET settings = excluded.settings, revision = excluded.revision',
        )
        .run(seat.room_id, JSON.stringify(settings), revision);
      this.db.prepare('UPDATE seats SET ready = 0 WHERE room_id = ? AND departed = 0').run(seat.room_id);
      this.db.prepare('UPDATE rooms SET revision = ? WHERE id = ?').run(revision, seat.room_id);
      this.db
        .prepare('INSERT INTO settings_receipts VALUES (?, ?, ?, ?, ?, ?)')
        .run(seat.room_id, seat.id, commandId, payloadHash, revision, room.counter);
      this.renewRoomCode(seat.room_id);
      return { revision, counter: room.counter, duplicate: false };
    });
  }
  private presence(roomId: string): Presence | undefined {
    if (!this.trackPresence) return undefined;
    const row = this.db.prepare('SELECT state FROM room_presence WHERE room_id=?').get(roomId) as
      { state: string } | undefined;
    return row ? (JSON.parse(row.state) as Presence) : undefined;
  }
  private initializePresence() {
    this.transaction(() => {
      const now = this.now();
      for (const row of this.db.prepare('SELECT room_id,state FROM games').all()) {
        const roomId = row.room_id as string;
        const game = JSON.parse(row.state as string) as Game;
        if (game.phase === 'finished') {
          this.db.prepare('DELETE FROM room_presence WHERE room_id=?').run(roomId);
          this.db.prepare('DELETE FROM turn_clocks WHERE room_id=?').run(roomId);
          continue;
        }
        const old = this.presence(roomId);
        // Old paused saves never had a running absence deadline. Migrate them once with
        // a full grace. In v2, an already disconnected player's deadline survives restarts.
        const previous = old?.version === 2 ? old : undefined;
        const state: Presence = { version: 2, pausedAt: previous?.pausedAt ?? now, seats: {} };
        for (const player of game.players.filter((p) => !p.resigned))
          state.seats[player.id] = previous?.seats[player.id] ?? {
            disconnectedAt: now,
            resignAt: now + RECONNECT_GRACE_MS,
          };
        this.writePresence(roomId, state);
      }
    });
  }
  private writePresence(roomId: string, state: Presence) {
    const deadlines = Object.values(state.seats).map((seat) => seat.resignAt);
    this.db
      .prepare(
        'INSERT INTO room_presence(room_id,state,next_deadline) VALUES(?,?,?) ON CONFLICT(room_id) DO UPDATE SET state=excluded.state,next_deadline=excluded.next_deadline',
      )
      .run(roomId, JSON.stringify(state), deadlines.length ? Math.min(...deadlines) : null);
  }
  private updatePresence(roomId: string, game: Game, connected = this.connectedSeats) {
    if (!this.trackPresence) return;
    if (game.phase === 'finished') {
      this.db.prepare('DELETE FROM room_presence WHERE room_id=?').run(roomId);
      return;
    }
    const old = this.presence(roomId),
      now = this.now();
    const remaining = game.players.filter((p) => !p.resigned);
    const paused = !remaining.some((p) => connected.has(p.id));
    const resumed = old?.pausedAt !== undefined && !paused;
    const state: Presence = { version: 2, seats: {} };
    if (paused) state.pausedAt = old?.pausedAt ?? now;
    for (const p of remaining)
      if (!connected.has(p.id)) {
        state.seats[p.id] = old?.seats[p.id] || {
          disconnectedAt: now,
          resignAt: now + RECONNECT_GRACE_MS,
        };
      }
    this.writePresence(roomId, state);
    if (resumed) {
      // Nobody owes an immediate automatic move for time when nobody could see the game.
      this.db.prepare('DELETE FROM turn_clocks WHERE room_id=?').run(roomId);
      this.updateClock(roomId, game);
    }
  }
  /** Call only for admitted sockets, after replacement checks. A returning resigned seat can watch. */
  setConnected(seat: Seat, connected: boolean) {
    if (!this.trackPresence) return;
    if (connected) this.expireAbsences(seat.room_id);
    const nextConnected = new Set(this.connectedSeats);
    if (connected) nextConnected.add(seat.id);
    else nextConnected.delete(seat.id);
    try {
      this.transaction(() => {
        const game = this.loadGame(seat.room_id);
        if (game) {
          const next = resignPlayers(game, [], { winnerEligibleIds: [...nextConnected] });
          if (next !== game) {
            this.saveLifecycle(
              seat.room_id,
              game,
              next,
              'return-' +
                hash(
                  JSON.stringify({
                    roomId: seat.room_id,
                    player: seat.id,
                    revision: this.snapshot(seat.room_id).revision,
                  }),
                ).slice(0, 48),
              seat.id,
              { kind: 'return', player: seat.id },
              'resign',
              false,
              nextConnected,
            );
          } else this.updatePresence(seat.room_id, game, nextConnected);
        }
      });
    } catch (error) {
      // A closed transport stays closed even if its presence write needs a retry.
      if (!connected) {
        this.connectedSeats = nextConnected;
        this.pendingPresence.add(seat.room_id);
      }
      throw error;
    }
    this.connectedSeats = nextConnected;
    this.pendingPresence.delete(seat.room_id);
  }
  /** Presence expiry and the complete resulting game transition have one durable commit. */
  private expireAbsences(roomId: string): boolean {
    const presence = this.presence(roomId);
    if (!presence) return false;
    const due = Object.entries(presence.seats)
      .filter(([id, absence]) => !this.connectedSeats.has(id) && absence.resignAt <= this.now())
      .map(([id]) => id);
    if (!due.length) return false;
    return this.transaction(() => {
      const current = this.loadGame(roomId);
      if (!current || current.phase === 'finished') return false;
      const next = resignPlayers(current, due, {
        reason: 'disconnect',
        winnerEligibleIds: [...this.connectedSeats],
      });
      if (next === current) {
        this.updatePresence(roomId, current);
        return false;
      }
      this.saveLifecycle(
        roomId,
        current,
        next,
        'resign-' +
          hash(JSON.stringify({ roomId, revision: this.snapshot(roomId).revision, due })).slice(0, 48),
        due.length === 1 ? due[0]! : null,
        { kind: 'resign', players: due },
        next.finishReason === 'abandoned' ? 'abandoned' : 'resign',
        true,
      );
      return true;
    });
  }
  /** Lifecycle changes and their private/public projections share the caller's transaction. */
  private saveLifecycle(
    roomId: string,
    current: Game,
    next: Game,
    commandId: string,
    actor: string | null,
    action: unknown,
    kind: string,
    automatic: boolean,
    connected = this.connectedSeats,
  ) {
    const revision =
      (this.db.prepare('SELECT revision FROM rooms WHERE id=?').get(roomId)!.revision as number) + 1;
    if (!this.eventHead(roomId))
      this.recordEvent(
        roomId,
        revision - 1,
        'legacy-import',
        null,
        { kind: 'legacy' },
        current,
        current.log.map((e) => e.text),
        'legacy',
      );
    const lines = next.log.filter((e) => e.id >= current.nextLog).map((e) => e.text);
    if (!lines.length && kind === 'leave')
      lines.push(`${next.players.find((p) => p.id === actor)?.name ?? 'A player'} left the room.`);
    this.recordEvent(roomId, revision, commandId, actor, action, next, lines, kind, automatic);
    this.db.prepare('UPDATE games SET state=? WHERE room_id=?').run(JSON.stringify(next), roomId);
    this.db.prepare('UPDATE rooms SET revision=? WHERE id=?').run(revision, roomId);
    this.updateClock(roomId, next);
    this.updatePresence(roomId, next, connected);
    return revision;
  }
  clock(roomId: string): TurnClock | undefined {
    const row = this.db.prepare('SELECT state FROM turn_clocks WHERE room_id = ?').get(roomId) as
      { state: string } | undefined;
    return row ? (JSON.parse(row.state) as TurnClock) : undefined;
  }
  private updateClock(roomId: string, next: Game) {
    const seconds = this.settings(roomId).turnTimerSeconds;
    if (seconds === null || next.turn === 0 || next.phase === 'finished') {
      this.db.prepare('DELETE FROM turn_clocks WHERE room_id = ?').run(roomId);
      return;
    }
    const now = this.now();
    const playerId = next.players[next.active]!.id;
    let clock = this.clock(roomId);
    if (!clock || clock.turn !== next.turn || clock.playerId !== playerId)
      clock = { playerId, turn: next.turn, startedAt: now, deadlineAt: now + seconds * 1000 };
    if (next.phase === 'discard') {
      clock.pausedAt ??= now;
      const existing = clock.discardDeadlines ?? {};
      clock.discardDeadlines = Object.fromEntries(
        Object.keys(next.discards).map((id) => [id, existing[id] ?? now + seconds * 1000]),
      );
    } else if (clock.pausedAt !== undefined) {
      clock.deadlineAt += Math.max(0, now - clock.pausedAt);
      delete clock.pausedAt;
      delete clock.discardDeadlines;
    }
    const nextDeadline =
      clock.pausedAt === undefined ? clock.deadlineAt : Math.min(...Object.values(clock.discardDeadlines!));
    this.db
      .prepare(
        'INSERT INTO turn_clocks(room_id, state, next_deadline) VALUES (?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, next_deadline = excluded.next_deadline',
      )
      .run(roomId, JSON.stringify(clock), nextDeadline);
  }
  dueRooms(): string[] {
    // Reserve at least half the batch for saved deadlines. Rotate both queues even if a
    // selected room fails: one damaged room must never strand healthy games behind it.
    const pendingCount = Math.min(16, this.pendingPresence.size);
    const normalLimit = 32 - pendingCount;
    const query = this.trackPresence
      ? `
        SELECT room_id FROM (
          SELECT c.room_id,c.next_deadline FROM turn_clocks c JOIN room_presence p ON p.room_id=c.room_id
          WHERE c.next_deadline<=? AND json_extract(p.state,'$.pausedAt') IS NULL
          UNION ALL SELECT room_id,next_deadline FROM room_presence WHERE next_deadline<=?
        )
      `
      : 'SELECT room_id FROM turn_clocks WHERE next_deadline<=?';
    const times = this.trackPresence ? [this.now(), this.now()] : [this.now()];
    const select = (operator: '>' | '<=', limit: number) =>
      this.db
        .prepare(
          `SELECT DISTINCT room_id FROM (${query}) WHERE room_id ${operator} ? ORDER BY room_id LIMIT ?`,
        )
        .all(...times, this.dueRoomCursor, limit)
        .map((row) => row.room_id as string);
    const due = select('>', normalLimit);
    if (due.length < normalLimit && this.dueRoomCursor) due.push(...select('<=', normalLimit - due.length));
    if (due.length) this.dueRoomCursor = due[due.length - 1]!;
    const pending = [...this.pendingPresence].slice(0, 32 - due.length);
    for (const roomId of pending) {
      this.pendingPresence.delete(roomId);
      this.pendingPresence.add(roomId);
    }
    return [...new Set([...due, ...pending])];
  }
  /** Each chosen action commits independently, so a crash resumes from the last saved mandatory choice. */
  expireRoom(roomId: string): boolean {
    let presenceRecovered = false;
    if (this.pendingPresence.has(roomId)) {
      this.transaction(() => {
        const game = this.loadGame(roomId);
        if (game) this.updatePresence(roomId, game);
      });
      this.pendingPresence.delete(roomId);
      presenceRecovered = true;
    }
    if (this.trackPresence) {
      const game = this.loadGame(roomId);
      if (
        game &&
        game.phase !== 'finished' &&
        !game.players.some((p) => !p.resigned && this.connectedSeats.has(p.id))
      ) {
        this.transaction(() => this.updatePresence(roomId, game));
      }
    }
    let changed = this.expireAbsences(roomId) || presenceRecovered;
    if (this.trackPresence && (!this.presence(roomId) || this.presence(roomId)?.pausedAt !== undefined))
      return changed;
    const firstClock = this.clock(roomId);
    if (!firstClock) return changed;
    // At most four discards, two free roads, a robber move, a roll and an end-turn.
    for (let step = 0; step < 12; step++) {
      const clock = this.clock(roomId);
      if (!clock || clock.turn !== firstClock.turn) break;
      let playerId = clock.playerId;
      if (clock.pausedAt !== undefined) {
        const due = Object.entries(clock.discardDeadlines ?? {}).find(
          ([, deadline]) => deadline <= this.now(),
        );
        if (!due) break;
        playerId = due[0];
      } else if (clock.deadlineAt > this.now()) break;
      const game = this.loadGame(roomId);
      if (!game || game.phase === 'finished') break;
      const action = timeoutAction(game, playerId, this.random);
      if (!action)
        throw new ProtocolError(
          'CLOCK_STATE',
          'The turn clock needs recovery before automatic play can continue',
        );
      const player = game.players.find((p) => p.id === playerId)!;
      const revision = this.db.prepare('SELECT revision FROM rooms WHERE id = ?').get(roomId)!
        .revision as number;
      const commandId =
        'timer-' +
        hash(JSON.stringify({ roomId, playerId, revision, turn: game.turn, phase: game.phase })).slice(0, 48);
      this.action({ id: playerId, name: player.name, room_id: roomId }, commandId, revision, action, true);
      changed = true;
    }
    return changed;
  }
  loadGame(roomId: string): Game | undefined {
    const row = this.db.prepare('SELECT state FROM games WHERE room_id = ?').get(roomId) as
      { state: string } | undefined;
    const head = this.eventHead(roomId);
    if (head && (!row || hash(row.state) !== head.state_hash))
      throw new ProtocolError('STATE_INTEGRITY', 'Saved game needs recovery; no moves were discarded');
    if (!row) return undefined;
    const game = JSON.parse(row.state) as Game;
    if (game.schema !== 1)
      throw new ProtocolError('VERSION_MISMATCH', 'This saved game needs a compatible server version');
    return game;
  }
  action(seat: Seat, commandId: string, expectedRevision: number, input: GameAction, automatic = false) {
    const action = parseGameAction(input);
    if (!automatic) this.expireRoom(seat.room_id);
    const payloadHash = hash(
      JSON.stringify({ expectedRevision, action, ...(automatic ? { automatic: true } : {}) }),
    );
    return this.transaction(() => {
      this.rejectSettingsReceipt(seat, commandId);
      if (
        this.db
          .prepare('SELECT 1 FROM lobby_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used in the lobby');
      if (
        this.db
          .prepare('SELECT 1 FROM leave_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for leaving');
      if (
        this.db
          .prepare('SELECT 1 FROM receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for another operation');
      const old = this.db
        .prepare(
          'SELECT payload_hash, revision, counter FROM game_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as
        { payload_hash: string; revision: number; counter: number } | undefined;
      if (old) {
        if (old.payload_hash !== payloadHash)
          throw new ProtocolError('COMMAND_REUSED', 'A command ID cannot be reused with a different payload');
        return { revision: old.revision, counter: old.counter, duplicate: true };
      }
      const room = this.snapshot(seat.room_id);
      if (room.revision !== expectedRevision)
        throw new ProtocolError('STALE_STATE', 'State changed; review the latest snapshot and try again');
      const current = this.loadGame(seat.room_id);
      if (
        current &&
        current.phase !== 'finished' &&
        this.trackPresence &&
        !current.players.some((p) => !p.resigned && this.connectedSeats.has(p.id))
      )
        throw new ProtocolError('GAME_PAUSED', 'The game is paused while everyone is disconnected');
      let next: Game;
      if (action.kind === 'start') {
        if (current) throw new ProtocolError('GAME_STARTED', 'This game is already underway');
        if (room.players[0]?.id !== seat.id)
          throw new ProtocolError('NOT_HOST', 'Only the room creator can start the game');
        if (!room.players.slice(1).every((p) => p.ready))
          throw new ProtocolError('NOT_READY', 'Every other player must be ready');
        next = createGame(
          shuffle(
            room.players.map((p) => ({ id: p.id, name: p.name })),
            this.random,
          ),
          room.board.seed,
          this.random,
        );
      } else {
        if (!current) throw new ProtocolError('NOT_STARTED', 'Start the game first');
        next = applyAction(current, seat.id, action, this.random);
      }
      if (automatic) {
        next.log.push({
          id: next.nextLog++,
          text: `${seat.name}'s timer expired; ${timeoutDescription(action)}.`,
        });
        if (next.log.length > 80) next.log.shift();
      }
      if (current && !this.eventHead(seat.room_id))
        this.recordEvent(
          seat.room_id,
          room.revision,
          'legacy-history',
          null,
          {},
          current,
          [
            'Earlier game imported; only its last saved journal entries are available.',
            ...current.log.map((e) => e.text),
          ],
          'legacy',
        );
      const revision = room.revision + 1;
      this.recordEvent(
        seat.room_id,
        revision,
        commandId,
        seat.id,
        action,
        next,
        next.log.filter((e) => e.id >= (current?.nextLog ?? 0)).map((e) => e.text),
        action.kind,
        automatic,
      );
      this.db
        .prepare(
          'INSERT INTO games(room_id, state) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET state = excluded.state',
        )
        .run(seat.room_id, JSON.stringify(next));
      this.updateClock(seat.room_id, next);
      this.updatePresence(seat.room_id, next);
      this.db.prepare('UPDATE rooms SET revision = ? WHERE id = ?').run(revision, seat.room_id);
      this.db
        .prepare(
          'INSERT INTO game_receipts(room_id, player_id, command_id, payload_hash, revision, counter) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(seat.room_id, seat.id, commandId, payloadHash, revision, room.counter);
      if (!automatic) this.renewRoomCode(seat.room_id);
      return { revision, counter: room.counter, duplicate: false };
    });
  }
  increment(seat: Seat, commandId: string, expectedRevision: number) {
    return this.transaction(() => {
      this.rejectSettingsReceipt(seat, commandId);
      if (
        this.db
          .prepare('SELECT 1 FROM lobby_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used in the lobby');
      if (
        this.db
          .prepare('SELECT 1 FROM leave_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for leaving');
      if (
        this.db
          .prepare('SELECT 1 FROM game_receipts WHERE room_id = ? AND player_id = ? AND command_id = ?')
          .get(seat.room_id, seat.id, commandId)
      )
        throw new ProtocolError('COMMAND_REUSED', 'Command ID was already used for another operation');
      if (this.loadGame(seat.room_id))
        throw new ProtocolError('GAME_STARTED', 'Connectivity counters are disabled during games');
      const old = this.db
        .prepare(
          'SELECT expected_revision, revision, counter FROM receipts WHERE room_id = ? AND player_id = ? AND command_id = ?',
        )
        .get(seat.room_id, seat.id, commandId) as Receipt | undefined;
      if (old) {
        if (old.expected_revision !== expectedRevision)
          throw new ProtocolError('COMMAND_REUSED', 'A command ID cannot be reused with a different payload');
        return { revision: old.revision, counter: old.counter, duplicate: true };
      }
      const state = this.snapshot(seat.room_id);
      if (state.revision !== expectedRevision)
        throw new ProtocolError('STALE_STATE', 'State changed; review the latest snapshot and try again');
      const revision = state.revision + 1;
      const counter = state.counter + 1;
      this.db
        .prepare('UPDATE rooms SET revision = ?, counter = ? WHERE id = ?')
        .run(revision, counter, seat.room_id);
      this.db
        .prepare(
          'INSERT INTO receipts(room_id, player_id, command_id, expected_revision, revision, counter) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(seat.room_id, seat.id, commandId, expectedRevision, revision, counter);
      this.renewRoomCode(seat.room_id);
      return { revision, counter, duplicate: false };
    });
  }
  close() {
    this.db.close();
  }
}
