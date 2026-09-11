import type { FriendsState } from '../../../packages/protocol/src/profile.js';
import type { FriendPresenceState } from '../../../packages/protocol/src/player-hub.js';

export const ACCOUNT_PRESENCE_TTL_MS = 75_000;
/** Online means a verified app/socket heartbeat was received recently; no room or last-seen data. */
export class AccountPresence {
  private readonly deadlines = new Map<string, number>();
  private nextSweep = 0;
  constructor(private readonly maxAccounts = 10_000) {}
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
    return (this.deadlines.get(userId) ?? 0) > now;
  }
  friends(state: FriendsState, now: number): FriendPresenceState {
    return {
      friends: state.friends.map((friend) => ({
        ...friend,
        online: !friend.isGuest && this.online(friend.id, now),
      })),
      incoming: state.incoming,
      outgoing: state.outgoing,
    };
  }
}
