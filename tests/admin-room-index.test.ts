import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { ROOM_CODE_LEASE_MS, Store } from '../apps/server/src/store.js';
import type { Identity } from '../apps/server/src/auth.js';
import { RoomIndex, countActivity } from '../apps/server/src/admin/room-index.js';
import { Analysis } from '../apps/server/src/admin/analysis-runner.js';
import { AdminRequestError } from '../apps/server/src/admin/api.js';
import { newSession } from '../apps/client/src/connection.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';

async function database(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'catanova-room-index-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'game.sqlite');
  const store = new Store(path);
  const lobby = (name = 'Host', identity?: Identity) =>
    store.enter('create', newSession(name).token, name, undefined, identity).room_id;
  return { path, store, lobby };
}

async function refused(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminRequestError, `expected a refusal, got ${String(error)}`);
    assert.equal(error.status, 503);
    assert.equal(error.code, code);
    return true;
  });
}

/** Retries while the last run is still stopping. */
async function eventually<T>(attempt: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      const busy = error instanceof AdminRequestError && /_BUSY$/.test(error.code);
      if (!busy || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Holds the database the way a long scan holds a thread: any other connection
 * that reads now waits inside SQLite (its busy timeout), where nothing outside
 * can interrupt it. Only possible once no other connection has it open.
 */
function lock(path: string) {
  const locker = new DatabaseSync(path);
  locker.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT');
  return locker;
}

test('the room index counts on its own thread, reuses a pass until it is dropped, and finds accounts', async (t) => {
  const { path, store, lobby } = await database(t);
  t.after(() => store.close());
  const first = lobby();
  const index = new RoomIndex({
    databasePath: path,
    db: store.db,
    leaseMs: ROOM_CODE_LEASE_MS,
    maxAgeMs: 60_000,
  });
  t.after(() => index.close());
  assert.equal(index.running, false, 'no thread until someone asks');
  const summary = await index.summary(Date.now());
  assert.equal(index.running, true, 'answered by a worker thread');
  assert.deepEqual(summary.counts, { lobby: 1, live: 0, paused: 0, finished: 0, empty: 0 });
  assert.equal(summary.total, 1);
  assert.equal(summary.liveBotSeats, 0);
  assert.equal(summary.journalRows, 0);
  const second = lobby('Alicia', {
    id: '00000000-0000-4000-8000-000000000301',
    name: 'Alicia',
    expiresAt: Date.now() + 3_600_000,
    profile: defaultProfile('Alicia'),
  });
  assert.equal((await index.summary(Date.now())).total, 1, 'the same pass, reused');
  index.invalidate();
  assert.equal((await index.summary(Date.now())).total, 2, 'a new pass once dropped');
  const listed = await index.list(Date.now(), { status: 'lobby', q: '', page: 1 });
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.rooms.map((room) => room.id).sort(), [first, second].sort());
  assert.deepEqual(
    (await index.list(Date.now(), { status: 'all', q: 'alic', page: 1 })).rooms.map((room) => room.id),
    [second],
  );
  assert.equal((await index.list(Date.now(), { status: 'all', q: '', page: 2 })).rooms.length, 0);
  // Seat names and account ids, never a LIKE pattern.
  assert.deepEqual(await index.accounts('LICI'), ['00000000-0000-4000-8000-000000000301']);
  assert.deepEqual(await index.accounts('00000000-0000-4000-8000-0000000003'), [
    '00000000-0000-4000-8000-000000000301',
  ]);
  assert.deepEqual(await index.accounts('%'), []);
  index.close();
  assert.equal(index.running, false);
  await refused(index.summary(Date.now()), 'SHUTTING_DOWN');
});

test('an idle room index lets its thread go, and starts another when asked again', async (t) => {
  const { path, store, lobby } = await database(t);
  t.after(() => store.close());
  lobby();
  const index = new RoomIndex({ databasePath: path, db: store.db, leaseMs: ROOM_CODE_LEASE_MS, idleMs: 50 });
  t.after(() => index.close());
  assert.equal((await index.summary(Date.now())).total, 1);
  await until(() => !index.running, 'the idle worker to stop');
  lobby();
  assert.equal((await index.summary(Date.now())).total, 2);
  assert.equal(index.running, true);
});

test('a room count stuck inside SQLite times out, and nothing starts beside it until its thread exits', async (t) => {
  const { path, store, lobby } = await database(t);
  lobby();
  store.close();
  const locker = lock(path);
  t.after(() => locker.isOpen && locker.close());
  const index = new RoomIndex({
    databasePath: path,
    db: locker,
    leaseMs: ROOM_CODE_LEASE_MS,
    timeoutMs: 2000,
  });
  t.after(() => index.close());
  const started = Date.now();
  await refused(index.summary(Date.now()), 'ROOM_INDEX_TIMEOUT');
  assert.ok(Date.now() - started >= 1900);
  // The thread is still waiting inside SQLite, so no second pass starts beside it.
  await refused(index.summary(Date.now()), 'ROOM_INDEX_BUSY');
  await refused(index.list(Date.now(), { status: 'all', q: '', page: 1 }), 'ROOM_INDEX_BUSY');
  await refused(index.accounts('host'), 'ROOM_INDEX_BUSY');
  // Still so a while later: it is waiting on SQLite, which a terminate() cannot cut short.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await refused(index.summary(Date.now()), 'ROOM_INDEX_BUSY');
  assert.equal(index.running, true);
  locker.close();
  // Once the lock goes, the stuck statement returns, its thread exits, and a fresh one answers.
  assert.equal((await eventually(() => index.summary(Date.now()))).total, 1);
});

test('statistics stuck inside SQLite time out, and the next run waits for that thread to exit', async (t) => {
  const { path, store, lobby } = await database(t);
  lobby();
  store.close();
  const locker = lock(path);
  t.after(() => locker.isOpen && locker.close());
  const analysis = new Analysis({ databasePath: path, db: locker, now: Date.now, timeoutMs: 2000 });
  await refused(analysis.stats(), 'ANALYSIS_TIMEOUT');
  await refused(analysis.stats(true), 'ANALYSIS_BUSY');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await refused(analysis.stats(), 'ANALYSIS_BUSY');
  locker.close();
  const stats = await eventually(() => analysis.stats());
  assert.equal(stats.fresh, true);
  assert.equal(stats.value.totals.matches, 0);
});

test('games and players are counted since the start of the day and week the page asks about', async (t) => {
  const HOUR = 3_600_000;
  const now = Date.parse('2026-09-24T12:00:00Z');
  let clock = now - 240 * HOUR;
  const dir = await mkdtemp(join(tmpdir(), 'catanova-activity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'game.sqlite');
  const store = new Store(path, { now: () => clock });
  t.after(() => store.close());
  const person = (name: string, n: number): Identity => ({
    id: `00000000-0000-4000-8000-00000000050${n}`,
    name,
    expiresAt: now + HOUR,
    profile: defaultProfile(name),
  });
  const [alice, bob, cara, dan, eve] = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve'].map(person);
  /** Two accounts start a game; unless `playing`, the second leaves and the first wins by resignation. */
  const game = (first: Identity, second: Identity, playing = false) => {
    const host = store.enter('create', newSession(first.name).token, first.name, undefined, first);
    const guest = store.enter('join', newSession(second.name).token, second.name, host.room_id, second);
    store.lobby(guest, `ready-${guest.id}`, store.snapshot(host.room_id).revision, true);
    store.action(host, `start-${host.id}`, store.snapshot(host.room_id).revision, { kind: 'start' });
    clock += HOUR / 2;
    if (!playing) store.leave(guest, `leave-${guest.id}`, store.snapshot(host.room_id).revision);
  };
  game(alice!, bob!); // ten days ago
  clock = now - 48 * HOUR;
  game(alice!, cara!); // two days ago
  clock = now - HOUR;
  game(dan!, eve!, true); // an hour ago, still being played
  clock = now;
  const activity = countActivity(store.db, now, now - 5 * HOUR, now - 72 * HOUR);
  assert.deepEqual(activity.started, { day: 1, week: 2 });
  assert.deepEqual(activity.finished, { day: 0, week: 1 });
  assert.deepEqual(activity.abandoned, { day: 0, week: 0 });
  assert.deepEqual(activity.players, { day: 2, week: 4 }, 'Dan and Eve today; Alice and Cara too this week');
  assert.deepEqual(activity.newPlayers, { day: 2, week: 3 }, 'Alice first played ten days ago');
  // The worker gives the same answer, and reuses it for half a minute.
  const index = new RoomIndex({ databasePath: path, db: store.db, leaseMs: ROOM_CODE_LEASE_MS });
  t.after(() => index.close());
  assert.deepEqual(await index.activity(now, now - 5 * HOUR, now - 72 * HOUR), activity);
});
