import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, RECONNECT_GRACE_MS } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import { newSession, Connection } from '../apps/client/src/connection.js';
import {
  activePlayer,
  applyAction,
  createGame,
  emptyHand,
  gameView,
  resignPlayers,
  robberVictims,
  total,
} from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { startServer } from '../apps/server/src/server.js';
import { readyLobby } from './helpers.js';

function room(store: Store, count = 3, timed = false, setup = false) {
  const sessions = Array.from({ length: count }, (_, i) => newSession(`Player${i}`));
  const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
  const seats = [host, ...sessions.slice(1).map((s) => store.enter('join', s.token, s.name, host.room_id))];
  for (const seat of seats) store.setConnected(seat, true);
  if (timed) store.configureSettings(host, 'timer-settings', 0, { turnTimerSeconds: 90 });
  store.action(host, 'start-game', readyLobby(store, host.room_id), { kind: 'start' });
  if (!setup) finishSetup(store, host.room_id);
  const order = store.loadGame(host.room_id)!.players.map((p) => p.id);
  seats.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  sessions.sort(
    (a, b) => seats.findIndex((s) => s.name === a.name) - seats.findIndex((s) => s.name === b.name),
  );
  return { host, seats, sessions, roomId: host.room_id };
}
const presenceOf = (store: Store, seat: Seat) =>
  store.snapshot(seat.room_id).players.find((p) => p.id === seat.id)!;
function finishSetup(store: Store, roomId: string) {
  for (let n = 0; n < 16 && store.loadGame(roomId)!.turn === 0; n++) {
    const game = store.loadGame(roomId)!,
      p = activePlayer(game),
      legal = gameView(game, p.id).legal;
    const action: GameAction =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! };
    store.action({ ...p, room_id: roomId }, `setup-${n}`, store.snapshot(roomId).revision, action);
  }
}
function conserved(game: Game) {
  for (const r of RESOURCES)
    assert.equal(game.bank[r] + game.players.reduce((n, p) => n + p.hand[r], 0), 19, r);
}
test('disconnect grace is server timed, reconnect cancels it, repeated disconnect gets a fresh deadline', () => {
  let now = 1000000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const { roomId, seats } = room(store);
    store.setConnected(seats[1]!, false);
    assert.equal(presenceOf(store, seats[1]!).resignAt, now + RECONNECT_GRACE_MS);
    now += RECONNECT_GRACE_MS - 1;
    assert.equal(store.expireRoom(roomId), false);
    store.setConnected(seats[1]!, true);
    assert.equal(presenceOf(store, seats[1]!).resignAt, undefined);
    now += RECONNECT_GRACE_MS;
    assert.equal(store.expireRoom(roomId), false);
    store.setConnected(seats[1]!, false);
    assert.equal(presenceOf(store, seats[1]!).resignAt, now + RECONNECT_GRACE_MS);
    now += RECONNECT_GRACE_MS;
    assert.equal(store.expireRoom(roomId), true);
    assert.equal(store.loadGame(roomId)!.players[1]!.resigned, true);
    store.setConnected(seats[1]!, true);
    assert.equal(store.snapshot(roomId, seats[1]!.id).game!.players[1]!.resigned, true);
    assert.throws(
      () => store.action(seats[1]!, 'return-too-late', store.snapshot(roomId).revision, { kind: 'roll' }),
      /resigned/,
    );
  } finally {
    store.close();
  }
});

test('batch resignations are atomic, retry safe, preserve pieces and release a two-player winner by resignation', () => {
  let now = 1000000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const { roomId, seats } = room(store, 4);
    for (const seat of seats.slice(1)) store.setConnected(seat, false);
    const before = store.loadGame(roomId)!,
      revision = store.snapshot(roomId).revision;
    now += RECONNECT_GRACE_MS;
    store.db.exec(
      "CREATE TEMP TRIGGER fail_resign BEFORE INSERT ON game_events WHEN NEW.action LIKE '%resign%' BEGIN SELECT RAISE(ABORT,'Simulated storage failure'); END",
    );
    assert.throws(() => store.expireRoom(roomId), /Simulated storage failure/);
    assert.deepEqual(store.loadGame(roomId), before);
    assert.equal(store.snapshot(roomId).revision, revision);
    assert.ok(presenceOf(store, seats[1]!).resignAt);
    store.db.exec('DROP TRIGGER fail_resign');
    assert.equal(store.expireRoom(roomId), true);
    const after = store.loadGame(roomId)!;
    assert.equal(after.phase, 'finished');
    assert.equal(after.winner, seats[0]!.id);
    assert.equal(after.finishReason, 'resignation');
    assert.equal(after.players.filter((p) => p.resigned).length, 3);
    assert.deepEqual(after.roads, before.roads);
    assert.deepEqual(after.buildings, before.buildings);
    for (const p of after.players.slice(1)) assert.equal(total(p.hand), 0);
    conserved(after);
    assert.equal(store.snapshot(roomId).revision, revision + 1);
    assert.equal(store.expireRoom(roomId), false);
    assert.equal(store.history(roomId).entries.filter((e) => e.kind === 'resign').length, 1);
    assert.equal(store.clock(roomId), undefined);
  } finally {
    store.close();
  }
});

test('all players offline pauses clocks and grace; a human return grants fresh time without simulating missed turns', () => {
  let now = 1000000;
  const store = new Store(':memory:', { now: () => now, random: () => 0.34, trackPresence: true });
  try {
    const { roomId, seats } = room(store, 3, true);
    for (const seat of seats) store.setConnected(seat, false);
    const before = store.loadGame(roomId)!;
    now += 86400000;
    assert.equal(store.snapshot(roomId).paused, true);
    assert.deepEqual(store.dueRooms(), []);
    assert.equal(store.expireRoom(roomId), false);
    assert.deepEqual(store.loadGame(roomId), before);
    store.setConnected(seats[0]!, true);
    assert.equal(store.snapshot(roomId).paused, undefined);
    assert.equal(store.clock(roomId)!.deadlineAt, now + 90000);
    assert.equal(presenceOf(store, seats[1]!).resignAt, now + RECONNECT_GRACE_MS);
    assert.equal(store.expireRoom(roomId), false);
    now += 90000;
    for (let i = 0; i < 20; i++) store.expireRoom(roomId);
    assert.equal(store.loadGame(roomId)!.turn, before.turn + 1);
    assert.equal(store.history(roomId).entries.filter((e) => e.automatic && e.kind === 'roll').length, 1);
    assert.equal(store.clock(roomId)!.deadlineAt, now + 90000);
  } finally {
    store.close();
  }
});

test('restart does not forfeit offline players and retains board, ledger and seat ownership', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-presence-')),
    path = join(dir, 'game.sqlite');
  let now = 1000000,
    store = new Store(path, { now: () => now, trackPresence: true });
  try {
    const { roomId, seats, sessions } = room(store, 3, true);
    store.setConnected(seats[1]!, false);
    const game = store.loadGame(roomId)!,
      history = store.history(roomId);
    store.close();
    now += 86400000;
    store = new Store(path, { now: () => now, trackPresence: true });
    assert.deepEqual(store.dueRooms(), []);
    assert.equal(store.expireRoom(roomId), false);
    assert.deepEqual(store.loadGame(roomId), game);
    assert.deepEqual(store.history(roomId), history);
    const seat = store.enter('resume', sessions[0]!.token, sessions[0]!.name, roomId);
    store.setConnected(seat, true);
    assert.equal(seat.id, seats[0]!.id);
    assert.equal(presenceOf(store, seats[1]!).resignAt, now + RECONNECT_GRACE_MS);
    assert.equal(store.clock(roomId)!.deadlineAt, now + 90000);
    assert.equal(store.expireRoom(roomId), false);
    assert.deepEqual(store.loadGame(roomId), game);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('failed presence writes retry without another move in an untimed room, then publish a fresh full grace', () => {
  let now = 1000000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const { roomId, seats } = room(store, 3);
    const before = store.loadGame(roomId)!,
      revision = store.snapshot(roomId).revision;
    store.db.exec(
      "CREATE TEMP TRIGGER fail_presence BEFORE UPDATE ON room_presence BEGIN SELECT RAISE(ABORT,'Presence unavailable'); END",
    );
    assert.throws(() => store.setConnected(seats[1]!, false), /Presence unavailable/);
    assert.deepEqual(store.dueRooms(), [roomId]);
    assert.throws(() => store.expireRoom(roomId), /Presence unavailable/);
    assert.deepEqual(store.loadGame(roomId), before);
    store.db.exec('DROP TRIGGER fail_presence');
    now += 600000;
    assert.equal(
      store.expireRoom(roomId),
      true,
      'publish the recovered deadline even without a game revision',
    );
    assert.equal(store.snapshot(roomId).revision, revision);
    assert.equal(presenceOf(store, seats[1]!).resignAt, now + RECONNECT_GRACE_MS);
    assert.deepEqual(store.dueRooms(), []);
    now += RECONNECT_GRACE_MS;
    assert.deepEqual(store.dueRooms(), [roomId]);
    assert.equal(store.expireRoom(roomId), true);
    assert.equal(store.loadGame(roomId)!.players.find((p) => p.id === seats[1]!.id)!.resigned, true);
  } finally {
    store.close();
  }
});

test('more than 32 failed presence retries cannot starve a healthy turn clock or later retry rooms', () => {
  let now = 1000000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true, random: () => 0.34 });
  try {
    const retries = Array.from({ length: 35 }, () => room(store, 2, false, true));
    const healthy = room(store, 2, true);
    store.db.exec(`CREATE TEMP TABLE presence_faults(room_id TEXT PRIMARY KEY);
      CREATE TEMP TRIGGER selective_presence_failure BEFORE UPDATE ON room_presence
      WHEN EXISTS(SELECT 1 FROM presence_faults WHERE room_id=NEW.room_id)
      BEGIN SELECT RAISE(ABORT,'Selective presence failure'); END`);
    for (const retry of retries) {
      store.db.prepare('INSERT INTO presence_faults VALUES(?)').run(retry.roomId);
      assert.throws(() => store.setConnected(retry.seats[1]!, false), /Selective presence failure/);
    }
    for (const retry of retries.slice(33))
      store.db.prepare('DELETE FROM presence_faults WHERE room_id=?').run(retry.roomId);
    now += 90000;
    const attempted = new Set<string>();
    for (let tick = 0; tick < 3; tick++) {
      const due = store.dueRooms();
      assert.ok(due.length <= 32);
      for (const roomId of due) {
        attempted.add(roomId);
        try {
          store.expireRoom(roomId);
        } catch (error) {
          assert.match(String(error), /Selective presence failure/);
        }
      }
    }
    assert.equal(store.loadGame(healthy.roomId)!.turn, 2, 'normal clocks receive reserved capacity');
    for (const retry of retries) assert.ok(attempted.has(retry.roomId), 'every pending room gets a turn');
    for (const retry of retries.slice(33))
      assert.equal(presenceOf(store, retry.seats[1]!).resignAt, now + RECONNECT_GRACE_MS);
    for (const retry of retries.slice(0, 33)) assert.equal(store.loadGame(retry.roomId)!.turn, 0);
  } finally {
    store.close();
  }
});

test('persistently failing ordinary deadlines rotate so a later healthy room can still advance', () => {
  let now = 1000000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true, random: () => 0.34 });
  try {
    const rooms = Array.from({ length: 34 }, () => room(store, 2, true)).sort((a, b) =>
      a.roomId.localeCompare(b.roomId),
    );
    const healthy = rooms[33]!;
    store.db.exec(`CREATE TEMP TABLE clock_faults(room_id TEXT PRIMARY KEY);
      CREATE TEMP TRIGGER selective_clock_failure BEFORE INSERT ON game_events
      WHEN EXISTS(SELECT 1 FROM clock_faults WHERE room_id=NEW.room_id)
      BEGIN SELECT RAISE(ABORT,'Selective clock failure'); END`);
    for (const failed of rooms.slice(0, 33))
      store.db.prepare('INSERT INTO clock_faults VALUES(?)').run(failed.roomId);
    now += 90000;
    const attempted = new Set<string>();
    for (let tick = 0; tick < 2; tick++) {
      const due = store.dueRooms();
      assert.ok(due.length <= 32);
      for (const roomId of due) {
        attempted.add(roomId);
        try {
          store.expireRoom(roomId);
        } catch (error) {
          assert.match(String(error), /Selective clock failure/);
        }
      }
    }
    assert.equal(attempted.size, 34);
    assert.equal(store.loadGame(healthy.roomId)!.turn, 2);
    for (const failed of rooms.slice(0, 33)) assert.equal(store.loadGame(failed.roomId)!.turn, 1);
  } finally {
    store.close();
  }
});

test('a setup departure skips its unfinished and future slots while all existing roads and houses remain', () => {
  let now = 1000000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const { roomId, seats } = room(store, 3, false, true);
    const game = store.loadGame(roomId)!;
    store.action(seats[0]!, 'partial-settlement', store.snapshot(roomId).revision, {
      kind: 'settlement',
      vertex: gameView(game, seats[0]!.id).legal.settlements[0]!,
    });
    const placed = structuredClone(store.loadGame(roomId)!.buildings);
    store.setConnected(seats[0]!, false);
    now += RECONNECT_GRACE_MS;
    store.expireRoom(roomId);
    assert.equal(activePlayer(store.loadGame(roomId)!).id, seats[1]!.id);
    finishSetup(store, roomId);
    const after = store.loadGame(roomId)!;
    assert.equal(after.turn, 1);
    assert.equal(activePlayer(after).id, seats[1]!.id);
    for (const [vertex, building] of Object.entries(placed))
      assert.deepEqual(after.buildings[+vertex], building);
    assert.equal(Object.values(after.buildings).filter((b) => b.player === seats[0]!.id).length, 1);
    conserved(after);
  } finally {
    store.close();
  }
});

test('departed seats cannot produce, hold awards, trade, or receive robber theft; remaining players rotate normally', () => {
  const seats = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `Player${i}` }));
  let game = createGame(seats, 21, () => 0.34);
  game.turn = 1;
  game.phase = 'actions';
  const hex = game.board.hexes.find((h) => h.number === 6 && h.terrain !== 'desert')!;
  game.buildings[hex.vertices[0]!] = { player: 'p1', kind: 'city' };
  game.buildings[hex.vertices[2]!] = { player: 'p2', kind: 'settlement' };
  game.players[1]!.knights = 4;
  game.largestArmy = 'p1';
  game.players[2]!.knights = 3;
  game.players[1]!.hand.wood = 2;
  game.bank.wood -= 2;
  game.trade = {
    id: 1,
    player: 'p0',
    give: { ...emptyHand(), wood: 1 },
    want: { ...emptyHand(), sheep: 1 },
    declinedBy: ['p2', 'p3'],
  };
  game = resignPlayers(game, ['p1']);
  assert.equal(game.largestArmy, 'p2');
  assert.equal(game.trade, null);
  assert.deepEqual(robberVictims(game, 'p0', hex.id), ['p2']);
  assert.equal(gameView(game, 'p1').legal.roads.length, 0);
  game = applyAction(game, 'p0', { kind: 'endTurn' }, () => 0.34);
  assert.equal(activePlayer(game).id, 'p2');
  game = applyAction(game, 'p2', { kind: 'roll' }, () => 0.34);
  assert.equal(total(game.players[1]!.hand), 0);
  assert.ok(total(game.players[2]!.hand) > 0);
  conserved(game);
});

test('resignation during discard or robber preserves the required robber move, then gives the next player their own roll', () => {
  for (const phase of ['discard', 'robber'] as const) {
    let game = createGame(
      Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
      21,
      () => 0.34,
    );
    game.turn = 1;
    game.phase = phase;
    game.dice = [3, 4];
    game.returnPhase = 'actions';
    game.players[0]!.hand.wood = 8;
    game.bank.wood -= 8;
    if (phase === 'discard') {
      game.players[1]!.hand.brick = 8;
      game.bank.brick -= 8;
      game.discards = { p0: 4, p1: 4 };
    }
    game = resignPlayers(game, ['p0']);
    if (phase === 'discard') {
      assert.equal(game.phase, 'discard');
      assert.deepEqual(game.discards, { p1: 4 });
      game = applyAction(
        game,
        'p1',
        { kind: 'discard', resources: { ...emptyHand(), brick: 4 } },
        () => 0.34,
      );
    }
    assert.equal(game.phase, 'robber');
    assert.equal(activePlayer(game).id, 'p1');
    game = applyAction(
      game,
      'p1',
      timeoutAction(game, 'p1', () => 0.34)!,
      () => 0.34,
    );
    assert.equal(game.phase, 'roll');
    assert.equal(game.turn, 2);
    game = applyAction(game, 'p1', { kind: 'roll' }, () => 0.34);
    assert.deepEqual(game.dice, [3, 3]);
    conserved(game);
  }
});

test('resignation checks a points win after an award transfers or the next player begins their turn', () => {
  for (const departing of ['p1', 'p0']) {
    const game = createGame(
      Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
      21,
      () => 0.34,
    );
    game.turn = 1;
    game.phase = 'actions';
    const winner = departing === 'p1' ? 'p0' : 'p1';
    for (let v = 0; v < 4; v++) game.buildings[v] = { player: winner, kind: 'city' };
    if (departing === 'p1') {
      game.players[0]!.knights = 3;
      game.players[1]!.knights = 4;
      game.largestArmy = 'p1';
    } else {
      game.players[1]!.cards = [
        { id: 'victory1', kind: 'victoryPoint', boughtTurn: 0 },
        { id: 'victory2', kind: 'victoryPoint', boughtTurn: 0 },
      ];
    }
    const after = resignPlayers(game, [departing]);
    assert.equal(after.phase, 'finished');
    assert.equal(after.winner, winner);
    assert.equal(after.finishReason, undefined, 'this is a ten-point win with two remaining players');
  }
  let pending = createGame(
    Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    21,
    () => 0.34,
  );
  pending.turn = 1;
  pending.phase = 'discard';
  pending.discards = { p2: 4 };
  pending.players[2]!.hand.wood = 8;
  pending.bank.wood -= 8;
  for (let v = 0; v < 4; v++) pending.buildings[v] = { player: 'p1', kind: 'city' };
  pending.players[1]!.cards = [
    { id: 'victory1', kind: 'victoryPoint', boughtTurn: 0 },
    { id: 'victory2', kind: 'victoryPoint', boughtTurn: 0 },
  ];
  pending = resignPlayers(pending, ['p0']);
  assert.equal(pending.phase, 'discard');
  pending = applyAction(
    pending,
    'p2',
    { kind: 'discard', resources: { ...emptyHand(), wood: 4 } },
    () => 0.34,
  );
  assert.equal(pending.winner, 'p1');
  assert.equal(pending.phase, 'finished');
});

test('resigning a nonactive discarder unblocks robber selection; free-road leftovers are abandoned without creating pieces', () => {
  let game = createGame(
    Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    21,
    () => 0.34,
  );
  game.turn = 1;
  game.phase = 'discard';
  game.discards = { p1: 4 };
  game.players[1]!.hand.wood = 8;
  game.bank.wood -= 8;
  game = resignPlayers(game, ['p1']);
  assert.equal(game.phase, 'robber');
  assert.equal(activePlayer(game).id, 'p0');
  conserved(game);
  game.phase = 'freeRoads';
  game.freeRoads = 2;
  const roads = structuredClone(game.roads);
  const next = resignPlayers(game, ['p0']);
  assert.equal(next.phase, 'finished');
  assert.deepEqual(next.roads, roads);
  assert.equal(next.freeRoads, 0);
});

test('lobby disconnects never create a resignation deadline', () => {
  let now = 1000000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const session = newSession('Host'),
      seat = store.enter('create', session.token, session.name);
    store.setConnected(seat, true);
    store.setConnected(seat, false);
    now += 86400000;
    assert.equal(store.snapshot(seat.room_id).players[0]!.resignAt, undefined);
    assert.equal(store.expireRoom(seat.room_id), false);
    assert.deepEqual(store.dueRooms(), []);
  } finally {
    store.close();
  }
});

test('real disconnected sockets publish a deadline and the scheduler broadcasts a resignation win exactly once', async (t) => {
  let now = Date.now();
  const server = await startServer({ port: 0, databasePath: ':memory:', auth: null, now: () => now });
  const clients: Connection[] = [];
  t.after(async () => {
    for (const client of clients) client.stop();
    await server.close();
  });
  async function until(check: () => boolean) {
    const deadline = Date.now() + 6000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('Timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  const a = new Connection(server.url, newSession('Host'));
  clients.push(a);
  a.start();
  await until(() => a.status === 'connected');
  const b = new Connection(server.url, newSession('Friend', a.session.roomId));
  clients.push(b);
  b.start();
  await until(() => b.status === 'connected' && a.state?.players.length === 2);
  await b.lobby(true);
  await until(() => a.state?.players[1]?.ready === true);
  await a.action({ kind: 'start' });
  await until(() => !!b.state?.game);
  b.stop();
  await until(() => a.state?.players[1]?.connected === false && !!a.state?.players[1]?.resignAt);
  assert.equal(a.state!.players[1]!.resignAt, now + RECONNECT_GRACE_MS);
  now += RECONNECT_GRACE_MS;
  await until(() => a.state?.game?.phase === 'finished');
  assert.equal(a.state!.game!.winner, a.playerId);
  assert.equal(a.state!.game!.finishReason, 'resignation');
  assert.equal(server.store.history(a.session.roomId!).entries.filter((e) => e.kind === 'resign').length, 1);
});
