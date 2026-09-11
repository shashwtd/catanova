export const SOCIAL_HEARTBEAT_MS = 25_000;
export const SOCIAL_HEARTBEAT_TIMEOUT_MS = 15_000;

/** One foreground heartbeat at a time; hidden tabs stop fetching and expire naturally on the server. */
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
