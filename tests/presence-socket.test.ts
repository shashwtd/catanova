import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENCE_AUTH_CHECK_MS,
  PRESENCE_PROBE_MS,
  PresenceSocket,
} from '../apps/client/src/presence-socket.js';
import { applyFriendChange } from '../apps/client/src/social-presence.js';
import { PROTOCOL_VERSION } from '../packages/protocol/src/index.js';
import type { FriendPresenceChange } from '../packages/protocol/src/player-hub.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';

class FakeSocket {
  static made: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

/** Hand-driven time: `advance` runs due timeouts and intervals in order. */
function clock() {
  let now = 0,
    next = 1;
  const pending: { id: number; at: number; every?: number; run: () => void }[] = [];
  const add = (run: () => void, ms: number, every?: number) => {
    const id = next++;
    pending.push({ id, at: now + ms, run, ...(every ? { every } : {}) });
    return id;
  };
  const cancel = (id: unknown) => {
    const index = pending.findIndex((timer) => timer.id === id);
    if (index >= 0) pending.splice(index, 1);
  };
  return {
    now: () => now,
    timers: {
      setTimeout: ((run: () => void, ms: number) => add(run, ms)) as unknown as typeof setTimeout,
      clearTimeout: cancel as typeof clearTimeout,
      setInterval: ((run: () => void, ms: number) => add(run, ms, ms)) as unknown as typeof setInterval,
      clearInterval: cancel as typeof clearInterval,
    },
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        const due = pending[0];
        if (!due || due.at > until) break;
        now = due.at;
        if (due.every) due.at += due.every;
        else pending.splice(0, 1);
        due.run();
        await Promise.resolve();
      }
      now = until;
    },
  };
}

function harness(tokens: string[] = ['token-1']) {
  FakeSocket.made = [];
  const time = clock();
  const listeners = new Map<string, () => void>();
  const events = {
    addEventListener: (name: string, run: () => void) => listeners.set(name, run),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const doc = { ...events, visibilityState: 'visible' as DocumentVisibilityState };
  const friends: FriendPresenceChange[] = [];
  const connected: boolean[] = [];
  let tokenIndex = 0;
  const socket = new PresenceSocket({
    url: 'ws://game/ws',
    accessToken: async () => tokens[Math.min(tokenIndex, tokens.length - 1)],
    onFriend: (change) => friends.push(change),
    onConnected: (up) => connected.push(up),
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    timers: time.timers,
    window: events as unknown as Window,
    document: doc as unknown as Document,
    clock: time.now,
    minRetryMs: 1000,
    maxRetryMs: 30_000,
  });
  return {
    socket,
    time,
    doc,
    friends,
    connected,
    fire: (name: string) => listeners.get(name)?.(),
    nextToken: () => tokenIndex++,
    latest: () => FakeSocket.made.at(-1)!,
    async join(ws = FakeSocket.made.at(-1)!) {
      ws.open();
      await new Promise((resolve) => setImmediate(resolve));
      ws.receive({ type: 'presence', ok: true });
    },
  };
}

test('the socket joins with the sign-in token and passes friends on', async () => {
  const h = harness();
  h.socket.start();
  await h.join();
  assert.deepEqual(h.latest().sent[0], {
    type: 'presence',
    version: PROTOCOL_VERSION,
    accessToken: 'token-1',
  });
  assert.deepEqual(h.connected, [true]);
  h.latest().receive({ type: 'friend', friend: { id: 'bo', online: true } });
  assert.deepEqual(h.friends, [{ id: 'bo', online: true }]);
  h.socket.stop();
});

test('a dropped socket comes back with backoff, and at once when the tab returns', async () => {
  const h = harness();
  h.socket.start();
  await h.join();
  h.latest().close();
  assert.deepEqual(h.connected, [true, false]);
  assert.equal(FakeSocket.made.length, 1);
  await h.time.advance(1200);
  assert.equal(FakeSocket.made.length, 2, 'retried after about a second');
  h.latest().close();
  h.fire('visibilitychange');
  assert.equal(FakeSocket.made.length, 3, 'the tab coming back does not wait for the backoff');
  await h.join();
  assert.equal(h.socket.isConnected, true);
  h.socket.stop();
});

test('coming back checks that an open-looking socket really answers', async () => {
  const h = harness();
  h.socket.start();
  await h.join();
  const ws = h.latest();
  h.fire('visibilitychange');
  assert.equal(ws.sent.at(-1)!.type, 'ping');
  await h.time.advance(PRESENCE_PROBE_MS + 1);
  assert.equal(ws.closed, true, 'silently dead: closed, so it reconnects');
  await h.time.advance(1200);
  const alive = h.latest();
  await h.join(alive);
  h.fire('visibilitychange');
  alive.receive({ type: 'pong', nonce: 'x' });
  await h.time.advance(PRESENCE_PROBE_MS + 1);
  assert.equal(alive.closed, false, 'it answered, so it stays');
  h.socket.stop();
});

test('a refreshed sign-in is offered on the open socket', async () => {
  const h = harness(['token-1', 'token-2']);
  h.socket.start();
  await h.join();
  h.nextToken();
  await h.time.advance(PRESENCE_AUTH_CHECK_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.latest().sent.at(-1), { type: 'auth', accessToken: 'token-2' });
  h.socket.stop();
});

test('a server without accounts, or stopping, ends the retries', async () => {
  const h = harness();
  h.socket.start();
  h.latest().open();
  await new Promise((resolve) => setImmediate(resolve));
  h.latest().receive({ type: 'error', code: 'ACCOUNT_SETUP_REQUIRED', message: 'no accounts' });
  await h.time.advance(60_000);
  assert.equal(FakeSocket.made.length, 1);
  const again = harness();
  again.socket.start();
  await again.join();
  again.socket.stop();
  await again.time.advance(60_000);
  assert.equal(FakeSocket.made.length, 1, 'no reconnect after stop');
  assert.equal(again.latest().closed, true);
});

test('a pushed change updates that friend only, and replaces stale fields', () => {
  const profile = defaultProfile('Bo');
  const state = {
    friends: [
      { id: 'bo', username: 'Bo', isGuest: false, profile, online: true, watchable: { roomId: 'r1' } },
      { id: 'cy', username: 'Cy', isGuest: false, profile, online: false, lastSeenAt: 5 },
    ],
    incoming: [],
    outgoing: [],
  };
  const next = applyFriendChange(state, { id: 'bo', online: false, lastSeenAt: 9 });
  assert.deepEqual(next.friends[0], {
    id: 'bo',
    username: 'Bo',
    isGuest: false,
    profile,
    online: false,
    lastSeenAt: 9,
  });
  assert.equal(next.friends[1], state.friends[1]);
  assert.equal(
    applyFriendChange(state, { id: 'zed', online: true }),
    state,
    'unknown friends leave it alone',
  );
});
