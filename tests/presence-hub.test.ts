import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceHub } from '../apps/server/src/presence-hub.js';
import type { FriendPresenceChange } from '../packages/protocol/src/player-hub.js';

/** A hub with a hand-driven clock and grace timer, friends from a table, and a record of every push. */
function hub(friendships: Record<string, string[]>, options: { hiddenLastSeen?: string[] } = {}) {
  let now = 1_000_000;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let nextTimer = 1;
  const sent: { to: string; change: FriendPresenceChange }[] = [];
  const seen = new Map<string, number>();
  const rooms = new Map<string, { roomId: string; roomCode?: string }>();
  const heartbeats = new Set<string>();
  const failures: unknown[] = [];
  const presence = new PresenceHub<string>({
    now: () => now,
    graceMs: 10_000,
    send: (socket, change) => sent.push({ to: socket, change }),
    friendIds: async (token) => {
      if (token === 'broken') throw new Error('Supabase unavailable');
      return friendships[token] ?? [];
    },
    markSeen: (userId, at) => seen.set(userId, at),
    lastSeen: (userId) => (options.hiddenLastSeen?.includes(userId) ? null : (seen.get(userId) ?? null)),
    watchable: (userId) => rooms.get(userId) ?? null,
    heartbeat: (userId) => heartbeats.has(userId),
    onError: (error) => failures.push(error),
    timers: {
      setTimeout: ((run: () => void, ms: number) => {
        const timer = { at: now + ms, run, id: nextTimer++ };
        timers.push(timer);
        return timer.id;
      }) as unknown as typeof setTimeout,
      clearTimeout: ((id: number) => {
        const index = timers.findIndex((timer) => timer.id === id);
        if (index >= 0) timers.splice(index, 1);
      }) as unknown as typeof clearTimeout,
    },
  });
  /** A tab for `user`: sockets are named `user:n` so pushes show who received them. */
  const open = (user: string, tab = 1, kind: 'presence' | 'game' = 'presence', token: string = user) =>
    presence.add(`${user}:${tab}`, kind, { id: user, name: user.toUpperCase() }, token);
  return {
    presence,
    sent,
    seen,
    rooms,
    heartbeats,
    failures,
    open,
    advance(ms: number) {
      now += ms;
      for (const timer of timers.filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    },
    now: () => now,
    to: (socket: string) => sent.filter((entry) => entry.to === socket).map((entry) => entry.change),
    clear: () => (sent.length = 0),
  };
}

test('an account coming online is told only to online accounts that count it as a friend', async () => {
  const h = hub({ ana: ['bo'], bo: ['ana'], cy: [] });
  await h.open('bo');
  await h.open('cy');
  h.clear();
  await h.open('ana');
  assert.deepEqual(h.to('bo:1'), [{ id: 'ana', online: true }]);
  assert.deepEqual(h.to('cy:1'), [], 'not a friend, so never told');
  assert.equal(h.presence.isOnline('ana'), true);
  assert.equal(h.seen.get('ana'), h.now(), 'arriving counts as being seen');
});

test('a new tab is told where each friend is, online or not', async () => {
  const h = hub({ ana: ['bo', 'cy'], bo: ['ana'], cy: ['ana'] });
  await h.open('bo');
  h.rooms.set('bo', { roomId: 'room-1', roomCode: 'ABCD' });
  h.seen.set('cy', 42);
  h.clear();
  await h.open('ana');
  assert.deepEqual(h.to('ana:1'), [
    { id: 'bo', online: true, watchable: { roomId: 'room-1', roomCode: 'ABCD' } },
    { id: 'cy', online: false, lastSeenAt: 42 },
  ]);
});

test('closing a tab keeps the account online while another is open, and the last one after a grace', async () => {
  const h = hub({ ana: ['bo'], bo: ['ana'] });
  await h.open('bo');
  await h.open('ana', 1);
  await h.open('ana', 2);
  h.clear();
  h.presence.remove('ana:1');
  h.advance(60_000);
  assert.deepEqual(h.to('bo:1'), [], 'still here in the other tab');
  h.presence.remove('ana:2');
  h.advance(9_999);
  assert.equal(h.presence.isOnline('ana'), true, 'a reload within the grace does not flicker');
  assert.deepEqual(h.to('bo:1'), []);
  h.advance(1);
  assert.equal(h.presence.isOnline('ana'), false);
  assert.deepEqual(h.to('bo:1'), [{ id: 'ana', online: false, lastSeenAt: h.now() }]);
});

test('reconnecting within the grace is not news, and hidden last-seen stays hidden', async () => {
  const h = hub({ ana: ['bo'], bo: ['ana'] }, { hiddenLastSeen: ['ana'] });
  await h.open('bo');
  await h.open('ana');
  h.clear();
  h.presence.remove('ana:1');
  h.advance(5_000);
  await h.open('ana', 2);
  h.advance(60_000);
  assert.deepEqual(h.to('bo:1'), [], 'a reload is not an arrival or a departure');
  h.presence.remove('ana:2');
  h.advance(10_000);
  assert.deepEqual(h.to('bo:1'), [{ id: 'ana', online: false }], 'no last-seen time for one who hides it');
});

test('an older client still sending heartbeats is not announced as gone', async () => {
  const h = hub({ ana: ['bo'], bo: ['ana'] });
  await h.open('bo');
  await h.open('ana');
  h.heartbeats.add('ana');
  h.clear();
  h.presence.remove('ana:1');
  h.advance(10_000);
  assert.deepEqual(h.to('bo:1'), []);
});

test('taking or leaving a seat tells friends where they can watch', async () => {
  const h = hub({ ana: ['bo'], bo: ['ana'] });
  await h.open('bo');
  await h.open('ana');
  h.clear();
  h.rooms.set('ana', { roomId: 'room-2' });
  await h.open('ana', 9, 'game');
  assert.deepEqual(h.to('bo:1'), [{ id: 'ana', online: true, watchable: { roomId: 'room-2' } }]);
  assert.deepEqual(h.to('ana:9'), [], 'game sockets carry the game, not friends');
  h.clear();
  h.rooms.delete('ana');
  h.presence.remove('ana:9');
  assert.deepEqual(h.to('bo:1'), [{ id: 'ana', online: true }]);
});

test('friendships made or ended while both are here take effect at once, on both sides', async () => {
  const h = hub({ ana: [], bo: [] });
  await h.open('ana');
  await h.open('bo');
  h.clear();
  h.presence.setFriends('ana', ['bo']);
  assert.deepEqual(h.to('bo:1'), [{ id: 'ana', online: true }]);
  assert.deepEqual(h.to('ana:1'), [{ id: 'bo', online: true }]);
  h.clear();
  h.presence.setFriends('ana', []);
  h.presence.remove('bo:1');
  h.advance(10_000);
  assert.deepEqual(h.to('ana:1'), [], 'no longer friends, so no longer told');
});

test('guests are counted but have no friends to load, and a failed load leaves the account online', async () => {
  const h = hub({ bo: ['ana'] });
  await h.presence.add('guest:1', 'presence', { id: 'guest', name: 'Visitor', isGuest: true }, 'guest');
  await h.open('ana', 1, 'presence', 'broken');
  assert.equal(h.failures.length, 1);
  assert.equal(h.presence.isOnline('ana'), true);
  assert.deepEqual(
    h.presence.list().map(({ userId, name, guest, tabs }) => ({ userId, name, guest, tabs })),
    [
      { userId: 'guest', name: 'Visitor', guest: true, tabs: 1 },
      { userId: 'ana', name: 'ANA', guest: false, tabs: 1 },
    ],
  );
});
