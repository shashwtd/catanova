import type { FriendsState } from '../../../packages/protocol/src/profile.js';
import type { FriendPresenceState } from '../../../packages/protocol/src/player-hub.js';

export const ACCOUNT_PRESENCE_TTL_MS = 75_000;
/**
 * Online means an open socket (see `PresenceHub`, passed in as `live`) or, from
 * an older client that still sends them, a verified heartbeat received recently.
 *
 * Presence itself still holds no room data and no history: what a friend is
 * allowed to know about someone who is *not* online — whether they were here
 * an hour ago or in March — is looked up through the callback the caller
 * supplies, which is also where that person's own privacy switch is checked.
 */
export class AccountPresence {
  private readonly deadlines = new Map<string, number>();
  private nextSweep = 0;
  constructor(
    private readonly maxAccounts = 10_000,
    private readonly live?: (userId: string) => boolean,
  ) {}
  touch(userId: string, now: number, validUntil = Infinity) {
    if (now >= this.nextSweep || this.deadlines.size >= this.maxAccounts) {
      for (const [id, deadline] of this.deadlines) if (deadline <= now) this.deadlines.delete(id);
      this.nextSweep = now + 25_000;
    }
    if (validUntil <= now) return;
    if (!this.deadlines.has(userId) && this.deadlines.size >= this.maxAccounts) return;
    this.deadlines.set(userId, Math.min(now + ACCOUNT_PRESENCE_TTL_MS, validUntil));
  }
  online(userId: string, now: number) {
    return (this.live?.(userId) ?? false) || this.heartbeat(userId, now);
  }
  /** A heartbeat alone, without the live sockets. */
  heartbeat(userId: string, now: number) {
    return (this.deadlines.get(userId) ?? 0) > now;
  }
  /** `watchable` and `lastSeen` are supplied by the caller, which owns the
   *  store; presence itself deliberately keeps no room data and nothing
   *  durable. A friend who is online carries no last-seen time: "online"
   *  already answers the question, and the exact minute would say more than
   *  they agreed to. */
  friends(
    state: FriendsState,
    now: number,
    watchable?: (userId: string) => { roomId: string; roomCode?: string } | null,
    lastSeen?: (userId: string) => number | null,
  ): FriendPresenceState {
    return {
      friends: state.friends.map((friend) => {
        const online = !friend.isGuest && this.online(friend.id, now);
        const room = online ? watchable?.(friend.id) : null;
        const seen = online || friend.isGuest ? null : (lastSeen?.(friend.id) ?? null);
        return {
          ...friend,
          online,
          ...(seen === null ? {} : { lastSeenAt: seen }),
          ...(room ? { watchable: room } : {}),
        };
      }),
      incoming: state.incoming,
      outgoing: state.outgoing,
    };
  }
}
