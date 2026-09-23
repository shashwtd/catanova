/**
 * Live presence: who has Catanova open, told to their friends as it changes.
 *
 * Every tab of a signed-in player keeps a small presence socket open, and a
 * seat at a table has its own game socket. An account is online while any of
 * its sockets is open, whether its tab is in front or not. When the last one
 * closes, the account stays online for a short grace, long enough for a reload
 * or a hop between pages to reconnect, and then goes offline with its
 * last-seen time recorded. Each change is pushed straight to the account's
 * friends who are online, so a friends list no longer waits for its next poll,
 * or for a heartbeat to lapse, to show someone arrive or leave.
 *
 * Friendships live in Supabase. The hub caches each account's accepted
 * friends, fetched with that account's own token, and keeps the caches of two
 * accounts in step when a friendship starts or ends while both are here. News
 * about A reaches B only if B's own cached friends include A: a stale cache can
 * delay news, never show presence to someone who is not a friend.
 */
import type { FriendPresenceChange } from '../../../packages/protocol/src/player-hub.js';

/** Long enough for a reload or a hop between pages; short enough to feel live. */
export const PRESENCE_GRACE_MS = 10_000;
/** A friends list fetched this recently is reused when an account reconnects. */
export const FRIENDS_CACHE_MS = 5 * 60_000;
/** Most friends lists kept, for accounts online now or here recently. */
const MAX_CACHED_FRIENDS = 10_000;

export type SocketKind = 'presence' | 'game';

/** A signed-in account with Catanova open right now. */
export type OnlineAccount = {
  userId: string;
  name: string | null;
  guest: boolean;
  since: number;
  tabs: number;
};

export type PresenceIdentity = { id: string; name?: string | null; isGuest?: boolean };

export type PresenceHubOptions<Socket> = {
  now: () => number;
  /** Deliver one friend's change to one presence socket. */
  send: (socket: Socket, change: FriendPresenceChange) => void;
  /** Accepted friends' ids, fetched with that account's own token. */
  friendIds: (token: string) => Promise<string[]>;
  markSeen: (userId: string, at: number) => void;
  /** When the account was last here, or null when it keeps that to itself. */
  lastSeen: (userId: string) => number | null;
  watchable: (userId: string) => { roomId: string; roomCode?: string } | null;
  /** Still here by another route: an older client's HTTP heartbeat. */
  heartbeat: (userId: string) => boolean;
  graceMs?: number;
  timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
  onError?: (error: unknown) => void;
};

type Live<Socket> = {
  name: string | null;
  guest: boolean;
  since: number;
  sockets: Map<Socket, SocketKind>;
  leaving?: ReturnType<typeof setTimeout>;
};

export class PresenceHub<Socket> {
  private readonly live = new Map<string, Live<Socket>>();
  private readonly owners = new Map<Socket, string>();
  /** Insertion order is refresh order, so the oldest list is evicted first. */
  private readonly friends = new Map<string, { ids: Set<string>; at: number }>();
  private readonly fetching = new Map<string, Promise<void>>();

  constructor(private readonly options: PresenceHubOptions<Socket>) {}

  private get timers() {
    return this.options.timers ?? globalThis;
  }

  isOnline(userId: string): boolean {
    return this.live.has(userId);
  }

  /**
   * Count a socket for this account. The first one brings the account online,
   * once its friends are known, and then tells the new socket which friends
   * are here; a later game socket tells friends where to watch.
   */
  async add(socket: Socket, kind: SocketKind, identity: PresenceIdentity, token?: string): Promise<void> {
    if (this.owners.has(socket)) return;
    const userId = identity.id;
    let entry = this.live.get(userId);
    const arriving = !entry;
    if (!entry) {
      entry = {
        name: identity.name ?? null,
        guest: !!identity.isGuest,
        since: this.options.now(),
        sockets: new Map(),
      };
      this.live.set(userId, entry);
    } else if (entry.leaving) {
      this.timers.clearTimeout(entry.leaving);
      entry.leaving = undefined;
    }
    if (identity.name) entry.name = identity.name;
    entry.guest = !!identity.isGuest;
    entry.sockets.set(socket, kind);
    this.owners.set(socket, userId);
    this.options.markSeen(userId, this.options.now());
    if (!entry.guest && token) await this.loadFriends(userId, token);
    // Nothing to announce if every socket closed while the friends list loaded.
    if (this.live.get(userId) !== entry || !entry.sockets.has(socket)) return;
    if (arriving || kind === 'game') this.announce(userId);
    if (kind === 'presence') for (const friend of this.friendsOf(userId)) this.tell(userId, friend, socket);
  }

  /** Forget a socket. The account's last one starts the grace before it goes offline. */
  remove(socket: Socket): void {
    const userId = this.owners.get(socket);
    if (userId === undefined) return;
    this.owners.delete(socket);
    const entry = this.live.get(userId);
    if (!entry) return;
    const kind = entry.sockets.get(socket);
    entry.sockets.delete(socket);
    if (entry.sockets.size) {
      // Still here in another tab; a table left changes where friends can watch.
      if (kind === 'game') this.announce(userId);
      return;
    }
    if (entry.leaving) return;
    entry.leaving = this.timers.setTimeout(() => {
      if (this.live.get(userId) !== entry || entry.sockets.size) return;
      this.live.delete(userId);
      this.options.markSeen(userId, this.options.now());
      if (!this.options.heartbeat(userId)) this.announce(userId);
    }, this.options.graceMs ?? PRESENCE_GRACE_MS);
    (entry.leaving as { unref?: () => void }).unref?.();
  }

  /** Where friends can watch has changed without a socket opening or closing. */
  roomChanged(userId: string): void {
    if (this.live.has(userId)) this.announce(userId);
  }

  /**
   * A fresh accepted-friends list for this account, from its own request.
   * Friendship is mutual, so the other side's list is kept in step while both
   * are here, and two people who just became friends see each other at once.
   */
  setFriends(userId: string, ids: Iterable<string>): void {
    const next = new Set(ids);
    next.delete(userId);
    const known = this.friends.get(userId);
    this.cache(userId, next);
    if (!known) return;
    for (const other of next)
      if (!known.ids.has(other)) {
        this.friends.get(other)?.ids.add(userId);
        this.tell(other, userId);
        this.tell(userId, other);
      }
    for (const other of known.ids) if (!next.has(other)) this.friends.get(other)?.ids.delete(userId);
  }

  /** Everyone online now, for the admin console. */
  list(): OnlineAccount[] {
    return [...this.live].map(([userId, entry]) => {
      const tabs = [...entry.sockets.values()].filter((kind) => kind === 'presence').length;
      return {
        userId,
        name: entry.name,
        guest: entry.guest,
        since: entry.since,
        tabs: tabs || entry.sockets.size,
      };
    });
  }

  close(): void {
    for (const entry of this.live.values()) if (entry.leaving) this.timers.clearTimeout(entry.leaving);
    this.live.clear();
    this.owners.clear();
  }

  private friendsOf(userId: string): Set<string> {
    return this.friends.get(userId)?.ids ?? new Set();
  }

  private cache(userId: string, ids: Set<string>) {
    this.friends.delete(userId);
    this.friends.set(userId, { ids, at: this.options.now() });
    if (this.friends.size <= MAX_CACHED_FRIENDS) return;
    for (const id of this.friends.keys()) {
      if (this.friends.size <= MAX_CACHED_FRIENDS) break;
      if (!this.live.has(id)) this.friends.delete(id);
    }
  }

  private loadFriends(userId: string, token: string): Promise<void> {
    const cached = this.friends.get(userId);
    if (cached && this.options.now() - cached.at < FRIENDS_CACHE_MS) return Promise.resolve();
    const running = this.fetching.get(userId);
    if (running) return running;
    const work = this.options
      .friendIds(token)
      .then((ids) => this.setFriends(userId, ids))
      .catch((error) => this.options.onError?.(error))
      .finally(() => this.fetching.delete(userId));
    this.fetching.set(userId, work);
    return work;
  }

  /** Tell everyone here who counts this account as a friend. */
  private announce(userId: string) {
    for (const other of this.live.keys()) if (other !== userId) this.tell(other, userId);
  }

  /** Send `to`'s presence sockets (or just `only`) the state of `about`, if `to` counts them as a friend. */
  private tell(to: string, about: string, only?: Socket) {
    const target = this.live.get(to);
    if (!target || !this.friends.get(to)?.ids.has(about)) return;
    const change = this.change(about);
    for (const [socket, kind] of target.sockets)
      if (kind === 'presence' && (only === undefined || socket === only)) this.options.send(socket, change);
  }

  private change(userId: string): FriendPresenceChange {
    if (this.live.has(userId)) {
      const room = this.options.watchable(userId);
      return { id: userId, online: true, ...(room ? { watchable: room } : {}) };
    }
    const seen = this.options.lastSeen(userId);
    return { id: userId, online: false, ...(seen === null ? {} : { lastSeenAt: seen }) };
  }
}
