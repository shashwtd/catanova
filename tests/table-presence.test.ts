import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, RECONNECT_GRACE_MS, STANDIN_AFTER_MS } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import { newSession } from '../apps/client/src/connection.js';
import { activePlayer, gameView } from '../packages/rules/src/game.js';
import type { GameAction } from '../packages/rules/src/game.js';
import { readyLobby } from './helpers.js';

function finishSetup(store: Store, roomId: string) {
  for (let n = 0; n < 16 && store.loadGame(roomId)!.turn === 0; n++) {
    const game = store.loadGame(roomId)!,
      p = activePlayer(game),
      legal = gameView(game, p.id).legal;
    const action: GameAction =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! };
    store.action({ ...p, room_id: roomId }, `setup-${n}`, store.snapshot(roomId).revision, action, 'bot');
  }
}
/** Ann, Ben and Cat, all connected, past setup. */
function table(store: Store) {
  const sessions = ['Ann', 'Ben', 'Cat'].map((name) => newSession(name));
  const ann = store.enter('create', sessions[0]!.token, 'Ann');
  const seats = [ann, ...sessions.slice(1).map((s) => store.enter('join', s.token, s.name, ann.room_id))];
  for (const seat of seats) store.setConnected(seat, true);
  store.action(ann, 'start-table', readyLobby(store, ann.room_id), { kind: 'start' });
  finishSetup(store, ann.room_id);
  return { roomId: ann.room_id, seats: seats as [Seat, Seat, Seat], sessions };
}
function withBots(store: Store, bots: number) {
  const session = newSession('Human');
  const human = store.enter('create', session.token, session.name);
  for (let i = 0; i < bots; i++)
    store.lobby(
      human,
      `add-bot-${i}`,
      store.snapshot(human.room_id).revision,
      false,
      undefined,
      undefined,
      true,
    );
  store.setConnected(human, true);
  store.action(human, 'start-with-bots', store.snapshot(human.room_id).revision, { kind: 'start' });
  finishSetup(store, human.room_id);
  return { human, roomId: human.room_id };
}
const resigned = (store: Store, roomId: string) =>
  store
    .loadGame(roomId)!
    .players.filter((p) => p.resigned)
    .map((p) => p.name);

test('the last person at a table reloading never resigns the seats bots are covering', () => {
  let now = 1_000_000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const { roomId, seats } = table(store);
    const [ann, ben, cat] = seats;
    store.setConnected(ben, false);
    store.setConnected(cat, false);
    now += STANDIN_AFTER_MS;
    store.expireRoom(roomId);
    assert.deepEqual(store.standInIds(roomId).sort(), [ben.id, cat.id].sort());
    // Ben and Cat have been covered for four minutes, well past their own grace.
    now += 4 * 60_000;
    store.expireRoom(roomId);
    // Ann reloads: her socket closes, one scheduler tick passes, she is back.
    store.setConnected(ann, false);
    now += 500;
    for (const due of store.dueRooms()) store.expireRoom(due);
    now += 1000;
    store.setConnected(ann, true);
    const game = store.loadGame(roomId)!;
    assert.deepEqual(resigned(store, roomId), []);
    assert.equal(game.winner, null);
    assert.notEqual(game.phase, 'finished');
    assert.deepEqual(store.standInIds(roomId).sort(), [ben.id, cat.id].sort());
  } finally {
    store.close();
  }
});

test('a restart keeps seats a bot was covering for the full grace, then ends the table only if nobody returns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-restart-cover-')),
    path = join(dir, 'game.sqlite');
  let now = 1_000_000,
    store = new Store(path, { now: () => now, trackPresence: true });
  try {
    const { roomId, seats, sessions } = table(store);
    const [ann, ben, cat] = seats;
    store.setConnected(cat, false);
    now += STANDIN_AFTER_MS;
    store.expireRoom(roomId);
    now += 10 * 60_000;
    store.expireRoom(roomId);
    assert.deepEqual(store.standInIds(roomId), [cat.id]);
    // A deploy: the process stops without recording anyone as gone, and comes back.
    store.close();
    now += 2_000;
    store = new Store(path, { now: () => now, trackPresence: true });
    now += 500;
    for (const due of store.dueRooms()) store.expireRoom(due);
    assert.deepEqual(resigned(store, roomId), [], 'nobody is resigned on the first tick after a restart');
    now += 3_000;
    for (const seat of [ann, ben]) {
      const session = sessions.find((s) => s.name === seat.name)!;
      store.setConnected(store.enter('resume', session.token, session.name, roomId), true);
    }
    for (const due of store.dueRooms()) store.expireRoom(due);
    assert.deepEqual(resigned(store, roomId), []);
    assert.notEqual(store.loadGame(roomId)!.phase, 'finished');

    // The same restart with nobody coming back does end the table, after the grace.
    store.close();
    now += 60_000;
    store = new Store(path, { now: () => now, trackPresence: true });
    now += RECONNECT_GRACE_MS - 1;
    for (const due of store.dueRooms()) store.expireRoom(due);
    assert.notEqual(store.loadGame(roomId)!.phase, 'finished');
    now += 1;
    store.expireRoom(roomId);
    assert.equal(store.loadGame(roomId)!.finishReason, 'abandoned');
    assert.equal(store.loadGame(roomId)!.winner, null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bots alone never keep a table: the last person leaving or timing out ends it as abandoned', () => {
  for (const [bots, how] of [
    [1, 'disconnect'],
    [3, 'disconnect'],
    [2, 'leave'],
  ] as const) {
    let now = 1_000_000;
    const store = new Store(':memory:', { now: () => now, trackPresence: true });
    try {
      const { human, roomId } = withBots(store, bots);
      assert.deepEqual(store.botRooms(), [roomId]);
      if (how === 'leave') store.leave(human, 'leave-table', store.snapshot(roomId).revision);
      else {
        store.setConnected(human, false);
        now += RECONNECT_GRACE_MS;
        store.expireRoom(roomId);
      }
      const game = store.loadGame(roomId)!;
      assert.equal(game.phase, 'finished', `${bots} bots, ${how}`);
      assert.equal(game.finishReason, 'abandoned');
      assert.equal(game.winner, null);
      assert.deepEqual(store.botRooms(), [], 'the bot driver stops asking about it');
      assert.equal(store.snapshot(roomId).paused, undefined);
    } finally {
      store.close();
    }
  }
});

test('a table only bots were left at from before this fix is settled when the server starts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-bots-only-')),
    path = join(dir, 'game.sqlite');
  let now = 1_000_000,
    store = new Store(path, { now: () => now, trackPresence: true });
  try {
    const { human, roomId } = withBots(store, 2);
    // The state an older server left behind: the person resigned, two bots still
    // "playing" a paused game nobody can ever resume.
    const stuck = store.loadGame(roomId)!;
    stuck.players.find((p) => p.id === human.id)!.resigned = true;
    const state = JSON.stringify(stuck);
    store.db.prepare('UPDATE games SET state=? WHERE room_id=?').run(state, roomId);
    store.db
      .prepare(
        'UPDATE game_events SET state=?, state_hash=? WHERE room_id=? AND revision=(SELECT max(revision) FROM game_events WHERE room_id=?)',
      )
      .run(state, createHash('sha256').update(state).digest('hex'), roomId, roomId);
    store.close();
    now += 86_400_000;
    store = new Store(path, { now: () => now, trackPresence: true });
    const game = store.loadGame(roomId)!;
    assert.equal(game.phase, 'finished');
    assert.equal(game.finishReason, 'abandoned');
    assert.equal(game.winner, null);
    assert.equal(store.history(roomId).entries[0]!.kind, 'abandoned');
    assert.deepEqual(store.botRooms(), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the bot driver is only handed rooms where a bot can actually move', () => {
  let now = 1_000_000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const { human, roomId } = withBots(store, 2);
    assert.deepEqual(store.botRooms(), [roomId]);
    store.setConnected(human, false);
    assert.equal(store.snapshot(roomId).paused, true);
    assert.deepEqual(store.botRooms(), [], 'paused: bots wait for the person to come back');
    now += 60_000;
    store.setConnected(human, true);
    assert.deepEqual(store.botRooms(), [roomId]);
    store.leave(human, 'leave-now', store.snapshot(roomId).revision);
    assert.deepEqual(store.botRooms(), [], 'finished: nothing left to play');
  } finally {
    store.close();
  }
});
