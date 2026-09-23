import type { FriendsState, PublicAccount } from '../../../packages/protocol/src/profile.js';
import type { FriendPresenceChange } from '../../../packages/protocol/src/player-hub.js';

export const SOCIAL_HEARTBEAT_MS = 25_000;
export const SOCIAL_HEARTBEAT_TIMEOUT_MS = 15_000;

/**
 * How long ago someone was here, in the words a person would use.
 *
 * Deliberately vague at the top end. A friends list is not a log: "last week"
 * is as much as anyone needs, and the exact hour of someone's Tuesday is not
 * ours to publish even when we happen to know it. Anything under a minute
 * reads as "just now" rather than counting seconds, which would make an
 * offline friend look like they were being watched.
 */
export function lastSeenLabel(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'Last seen just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Last seen ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Last seen yesterday';
  if (days < 7) return `Last seen ${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `Last seen ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Last seen ${months} ${months === 1 ? 'month' : 'months'} ago`;
  return 'Last seen over a year ago';
}

/** A friends list as the client holds it: presence fields are absent until known. */
export type FriendsWithPresence = Omit<FriendsState, 'friends'> & {
  friends: (PublicAccount & Partial<Omit<FriendPresenceChange, 'id'>>)[];
};

/** One friend's pushed change applied to the list. An id not on the list leaves it untouched. */
export function applyFriendChange(
  state: FriendsWithPresence,
  change: FriendPresenceChange,
): FriendsWithPresence {
  const index = state.friends.findIndex((friend) => friend.id === change.id);
  if (index < 0) return state;
  const { online: _online, lastSeenAt: _seen, watchable: _watchable, ...account } = state.friends[index]!;
  const friends = [...state.friends];
  friends[index] = {
    ...account,
    online: change.online,
    ...(change.lastSeenAt === undefined ? {} : { lastSeenAt: change.lastSeenAt }),
    ...(change.watchable ? { watchable: change.watchable } : {}),
  };
  return { ...state, friends };
}

/** The older HTTP heartbeat, one request at a time and only while visible. It now stands in for the
 *  presence socket while that is down (see presence-socket.ts). */
export function startSocialPresence(
  ping: (signal: AbortSignal) => Promise<unknown>,
  target: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
  timers: Pick<
    typeof globalThis,
    'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'
  > = globalThis,
) {
  let closed = false;
  let pending: { controller: AbortController; timeout: ReturnType<typeof setTimeout> } | null = null;
  const cancel = () => {
    if (!pending) return;
    timers.clearTimeout(pending.timeout);
    pending.controller.abort();
    pending = null;
  };
  const heartbeat = () => {
    if (closed || pending || target.visibilityState !== 'visible') return;
    const controller = new AbortController();
    const work = {
      controller,
      // The token lookup happens before fetch's own timeout. Bound that wait too.
      timeout: timers.setTimeout(() => {
        if (pending === work) cancel();
      }, SOCIAL_HEARTBEAT_TIMEOUT_MS),
    };
    pending = work;
    void Promise.resolve()
      .then(() => {
        if (!controller.signal.aborted) return ping(controller.signal);
      })
      .catch(() => {})
      .finally(() => {
        timers.clearTimeout(work.timeout);
        if (pending === work) pending = null;
      });
  };
  const visibility = () => {
    if (target.visibilityState !== 'visible') cancel();
    else heartbeat();
  };
  heartbeat();
  const interval = timers.setInterval(heartbeat, SOCIAL_HEARTBEAT_MS);
  target.addEventListener('visibilitychange', visibility);
  return () => {
    closed = true;
    cancel();
    timers.clearInterval(interval);
    target.removeEventListener('visibilitychange', visibility);
  };
}

type SocialRequest = { controller: AbortController; promise: Promise<void> };
/** Reads coalesce, writes invalidate older reads, and account changes cancel the whole lifetime. */
export class FriendRequestQueue<T> {
  private generation = 0;
  private reading: SocialRequest | null = null;
  private writing: SocialRequest | null = null;
  reset() {
    ++this.generation;
    this.reading?.controller.abort();
    this.writing?.controller.abort();
    this.reading = null;
    this.writing = null;
  }
  read(
    load: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
    fail: () => void,
  ): Promise<void> {
    if (this.writing) {
      const generation = this.generation;
      return this.writing.promise
        .catch(() => {})
        .then(() => {
          if (generation === this.generation) return this.read(load, apply, fail);
        });
    }
    if (this.reading) return this.reading.promise;
    const work = this.request(load, apply, fail);
    this.reading = work;
    return work.promise;
  }
  write(load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void): Promise<void> {
    if (this.writing) return Promise.reject(new Error('A friend action is still finishing. Try again.'));
    ++this.generation;
    this.reading?.controller.abort();
    this.reading = null;
    const work = this.request(load, apply);
    this.writing = work;
    return work.promise;
  }
  private request(
    load: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
    fail?: () => void,
  ): SocialRequest {
    const generation = this.generation;
    const controller = new AbortController();
    const current = () => generation === this.generation && !controller.signal.aborted;
    const work: SocialRequest = { controller, promise: Promise.resolve() };
    work.promise = Promise.resolve()
      .then(async () => {
        if (!current()) return;
        try {
          const value = await load(controller.signal);
          if (current()) apply(value);
        } catch (error) {
          if (!current()) return;
          fail?.();
          throw error;
        }
      })
      .finally(() => {
        if (this.reading === work) this.reading = null;
        if (this.writing === work) this.writing = null;
      });
    return work;
  }
}
