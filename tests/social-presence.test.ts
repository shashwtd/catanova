import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FriendRequestQueue,
  SOCIAL_HEARTBEAT_MS,
  SOCIAL_HEARTBEAT_TIMEOUT_MS,
  startSocialPresence,
} from '../apps/client/src/social-presence.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
class Page extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  setVisibility(visibility: DocumentVisibilityState) {
    this.visibilityState = visibility;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}
function clock() {
  let now = 0,
    id = 0;
  const jobs = new Map<number, { at: number; every: number; callback: () => void }>();
  const add = (callback: () => void, delay: number, every: number) => {
    const key = ++id;
    jobs.set(key, { at: now + delay, every, callback });
    return key;
  };
  const timers = {
    setTimeout: ((callback: () => void, delay = 0) =>
      add(callback, delay, 0)) as unknown as typeof setTimeout,
    clearTimeout: ((key: number) => jobs.delete(key)) as unknown as typeof clearTimeout,
    setInterval: ((callback: () => void, delay = 0) =>
      add(callback, delay, delay)) as unknown as typeof setInterval,
    clearInterval: ((key: number) => jobs.delete(key)) as unknown as typeof clearInterval,
  };
  return {
    timers,
    pending: () => jobs.size,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [key, job] = next;
        now = job.at;
        if (job.every) job.at += job.every;
        else jobs.delete(key);
        job.callback();
      }
      now = end;
    },
  };
}

test('social presence immediately checks in, repeats in the foreground and cleans up completely', async () => {
  const page = new Page(),
    time = clock();
  const signals: AbortSignal[] = [];
  const stop = startSocialPresence(
    async (signal) => {
      signals.push(signal);
    },
    page,
    time.timers,
  );
  await settle();
  assert.equal(signals.length, 1);
  time.advance(SOCIAL_HEARTBEAT_MS);
  await settle();
  assert.equal(signals.length, 2);
  stop();
  assert.equal(time.pending(), 0);
  time.advance(SOCIAL_HEARTBEAT_MS * 3);
  page.setVisibility('hidden');
  page.setVisibility('visible');
  await settle();
  assert.equal(signals.length, 2);
});

test('hidden pages make no requests and return to a fresh foreground heartbeat', async () => {
  const page = new Page(),
    time = clock();
  page.visibilityState = 'hidden';
  const signals: AbortSignal[] = [];
  const first = deferred<void>();
  const stop = startSocialPresence(
    (signal) => {
      signals.push(signal);
      return first.promise;
    },
    page,
    time.timers,
  );
  time.advance(SOCIAL_HEARTBEAT_MS * 2);
  await settle();
  assert.equal(signals.length, 0);
  page.setVisibility('visible');
  await settle();
  assert.equal(signals.length, 1);
  page.setVisibility('hidden');
  assert.equal(signals[0]!.aborted, true);
  time.advance(SOCIAL_HEARTBEAT_MS);
  await settle();
  assert.equal(signals.length, 1);
  page.setVisibility('visible');
  await settle();
  assert.equal(signals.length, 2);
  stop();
  assert.equal(signals[1]!.aborted, true);
  first.resolve();
  await settle();
  assert.equal(time.pending(), 0);
});

test('a stalled token lookup cannot prevent all later presence heartbeats', async () => {
  const page = new Page(),
    time = clock();
  const signals: AbortSignal[] = [];
  const stop = startSocialPresence(
    (signal) => {
      signals.push(signal);
      return new Promise(() => {});
    },
    page,
    time.timers,
  );
  await settle();
  page.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(signals.length, 1, 'an in-flight foreground request is not duplicated');
  time.advance(SOCIAL_HEARTBEAT_TIMEOUT_MS);
  assert.equal(signals[0]!.aborted, true);
  time.advance(SOCIAL_HEARTBEAT_MS - SOCIAL_HEARTBEAT_TIMEOUT_MS);
  await settle();
  assert.equal(signals.length, 2);
  stop();
  assert.equal(signals[1]!.aborted, true);
  assert.equal(time.pending(), 0);
});

test('failed heartbeats are retried, including a synchronously failing transport', async () => {
  const page = new Page(),
    time = clock();
  let attempts = 0;
  const stop = startSocialPresence(
    () => {
      attempts++;
      throw new Error('network unavailable');
    },
    page,
    time.timers,
  );
  await settle();
  assert.equal(attempts, 1);
  time.advance(SOCIAL_HEARTBEAT_MS);
  await settle();
  assert.equal(attempts, 2);
  stop();
  assert.equal(time.pending(), 0);
});

test('closing a presence lifetime before its first microtask sends no request', async () => {
  const page = new Page(),
    time = clock();
  let attempts = 0;
  const stop = startSocialPresence(
    async () => {
      attempts++;
    },
    page,
    time.timers,
  );
  stop();
  await settle();
  assert.equal(attempts, 0);
  assert.equal(time.pending(), 0);
});

test('friend refreshes coalesce and an older read cannot restore a removed friend', async () => {
  const queue = new FriendRequestQueue<string[]>();
  const old = deferred<string[]>();
  let value = ['Sailor'];
  let reads = 0;
  let oldSignal!: AbortSignal;
  const load = (signal: AbortSignal) => {
    reads++;
    oldSignal = signal;
    return old.promise;
  };
  const apply = (next: string[]) => {
    value = next;
  };
  const refresh = queue.read(load, apply, () => assert.fail('stale read failed'));
  const same = queue.read(load, apply, () => {});
  assert.equal(refresh, same);
  await settle();
  assert.equal(reads, 1);
  await queue.write(async () => [], apply);
  assert.equal(oldSignal.aborted, true);
  assert.deepEqual(value, []);
  old.resolve(['Sailor']);
  await refresh;
  assert.deepEqual(value, []);
});

test('refreshing during a friend mutation waits for the write and reads current relationships', async () => {
  const queue = new FriendRequestQueue<string[]>();
  const mutation = deferred<string[]>();
  const applied: string[][] = [];
  const write = queue.write(
    () => mutation.promise,
    (value) => applied.push(value),
  );
  let reads = 0;
  const read = queue.read(
    async () => {
      reads++;
      return ['NewFriend'];
    },
    (value) => applied.push(value),
    () => {},
  );
  await settle();
  assert.equal(reads, 0);
  mutation.resolve(['NewFriend']);
  await Promise.all([write, read]);
  assert.equal(reads, 1);
  assert.deepEqual(applied, [['NewFriend'], ['NewFriend']]);
});

test('switching accounts cancels old reads, writes, and queued refreshes before they can publish', async () => {
  const queue = new FriendRequestQueue<string>();
  const staleRead = deferred<string>();
  const applied: string[] = [];
  let failures = 0;
  const read = queue.read(
    () => staleRead.promise,
    (value) => applied.push(value),
    () => {
      failures++;
    },
  );
  await settle();
  queue.reset();
  staleRead.reject(new Error('old account failure'));
  await read;
  const staleWrite = deferred<string>();
  let oldSignal!: AbortSignal;
  const write = queue.write(
    (signal) => {
      oldSignal = signal;
      return staleWrite.promise;
    },
    (value) => applied.push(value),
  );
  let staleRefreshes = 0;
  const waiting = queue.read(
    async () => {
      staleRefreshes++;
      return 'old refresh';
    },
    (value) => applied.push(value),
    () => {},
  );
  await settle();
  queue.reset();
  assert.equal(oldSignal.aborted, true);
  await queue.read(
    async () => 'new account',
    (value) => applied.push(value),
    () => {},
  );
  staleWrite.resolve('old account');
  await Promise.all([write, waiting]);
  assert.deepEqual(applied, ['new account']);
  assert.equal(failures, 0);
  assert.equal(staleRefreshes, 0);
});

test('current refresh failures invalidate cached presence and failed writes permit a safe retry', async () => {
  const queue = new FriendRequestQueue<string>();
  let failures = 0;
  await assert.rejects(
    queue.read(
      async () => {
        throw new Error('offline');
      },
      () => {},
      () => {
        failures++;
      },
    ),
    /offline/,
  );
  assert.equal(failures, 1);
  await assert.rejects(
    queue.write(
      async () => {
        throw new Error('declined');
      },
      () => {},
    ),
    /declined/,
  );
  let value = '';
  await queue.write(
    async () => 'retry succeeded',
    (next) => {
      value = next;
    },
  );
  assert.equal(value, 'retry succeeded');
});

test('duplicate friend mutations cannot execute concurrently', async () => {
  const queue = new FriendRequestQueue<string>();
  const first = deferred<string>();
  const one = queue.write(
    () => first.promise,
    () => {},
  );
  let duplicateRuns = 0;
  await assert.rejects(
    queue.write(
      async () => {
        duplicateRuns++;
        return 'duplicate';
      },
      () => {},
    ),
    /still finishing/,
  );
  assert.equal(duplicateRuns, 0);
  first.resolve('done');
  await one;
});
