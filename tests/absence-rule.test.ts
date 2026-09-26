/**
 * The absence rule of modes without bots (docs/TURN_CLOCK.md, "Modes without bots"), on a fake clock: no stand-in
 * takes the seat; after 2 minutes offline the clock makes the absent player's forced moves whenever the game
 * waits on them, with or without a turn timer, until they return. Classic keeps its 30-second stand-in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ABSENCE_AFTER_MS, STANDIN_AFTER_MS, Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import type { ModeSwitches } from '../apps/server/src/modes.js';
import { newSession } from '../apps/client/src/connection.js';
import { activePlayer, total } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { pips, seededRandom } from '../packages/rules/src/board.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { CLASSIC } from '../packages/rules/src/rulesets.js';
import type { TurnTimerSeconds } from '../packages/protocol/src/settings.js';
import { TEST_TABLE, useTestTable } from './test-ruleset.js';

useTestTable();
const OPEN: ModeSwitches = { open: [CLASSIC.id, TEST_TABLE.id], testers: new Set() };

type Options = { mode?: string; timer?: TurnTimerSeconds | null; path?: string; clock?: { now: number } };
/** A started three-seat game on a fake clock, every seat connected, in the test mode unless told otherwise. */
function table(options: Options = {}) {
  const clock = options.clock ?? { now: 1_000_000 };
  const store = new Store(options.path ?? ':memory:', {
    now: () => clock.now,
    trackPresence: true,
    modes: OPEN,
    random: seededRandom(4242),
  });
  const sessions = ['Ann', 'Ben', 'Cat'].map((name) => newSession(name));
  const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
  const roomId = host.room_id;
  const seats: Seat[] = [host, ...sessions.slice(1).map((s) => store.enter('join', s.token, s.name, roomId))];
  for (const seat of seats) store.setConnected(seat, true);
  const revision = () => store.snapshot(roomId).revision;
  store.configureSettings(host, 'rules', revision(), {
    turnTimerSeconds: options.timer ?? null,
    ...(options.mode === CLASSIC.id ? {} : { mode: options.mode ?? TEST_TABLE.id }),
  });
  for (const seat of seats.slice(1)) store.lobby(seat, `ready-${seat.id}`, revision(), true);
  store.action(host, 'start', revision(), { kind: 'start' });
  return { store, clock, roomId, seats, revision };
}
type Table = ReturnType<typeof table>;
const game = ({ store, roomId }: Table) => store.loadGame(roomId)!;
const seatOf = (t: Table, id: string) => t.seats.find((seat) => seat.id === id)!;
const rng = seededRandom(99);
let commands = 0;
/** The first player the game waits on, who is at the table, makes the clock's move for themselves. */
function play(t: Table) {
  const owed = owedMoves(game(t))[0]!;
  const action = timeoutAction(game(t), owed.player, rng)!;
  t.store.action(seatOf(t, owed.player), `play-${++commands}`, t.revision(), action);
}
/** Play on, making present players' moves and letting the clock make the absent's, until `done`. */
function playUntil(t: Table, absent: Seat, done: (game: Game) => boolean) {
  for (let step = 0; step < 200 && !done(game(t)); step++)
    if (owedMoves(game(t)).some((move) => move.player === absent.id)) {
      assert.ok(t.store.dueRooms().includes(t.roomId), 'the room wakes for the absent player');
      assert.ok(t.store.expireRoom(t.roomId), 'the clock moves for them at once');
    } else play(t);
  assert.ok(done(game(t)));
}
/** Rewrite the saved game as a test scenario, keeping the journal head's hash in step with it. */
function rig(t: Table, edit: (game: Game) => void) {
  const g = game(t);
  edit(g);
  const state = JSON.stringify(g);
  t.store.db.prepare('UPDATE games SET state = ? WHERE room_id = ?').run(state, t.roomId);
  t.store.db
    .prepare(
      'UPDATE game_events SET state = ?, state_z = NULL, state_hash = ? WHERE room_id = ? AND revision = (SELECT max(revision) FROM game_events WHERE room_id = ?)',
    )
    .run(state, createHash('sha256').update(state).digest('hex'), t.roomId, t.roomId);
}
const production = (g: Game, vertex: number) =>
  g.board.vertices[vertex]!.hexes.reduce((n, hex) => n + pips(g.board.hexes[hex]!.number), 0);
const awayLines = (g: Game) => g.log.filter((line) => / is away; /.test(line.text)).map((line) => line.text);

test('in a mode without bots an absent player is shown as disconnected, and nobody takes their seat', () => {
  const t = table();
  try {
    const absent = seatOf(t, owedMoves(game(t))[0]!.player);
    const others = t.seats.filter((seat) => seat.id !== absent.id);
    t.store.setConnected(absent, false);
    t.clock.now += STANDIN_AFTER_MS;
    t.store.expireRoom(t.roomId);
    const player = t.store.snapshot(t.roomId).players.find((p) => p.id === absent.id)!;
    assert.equal(player.standIn, undefined);
    assert.equal(player.disconnectedAt, 1_000_000);
    assert.deepEqual(t.store.standInIds(t.roomId), []);
    assert.deepEqual(t.store.botSeatsIn(t.roomId), []);
    assert.equal(owedMoves(game(t))[0]!.player, absent.id, 'for the first 2 minutes the game waits for them');
    assert.ok(others.length === 2);
  } finally {
    t.store.close();
  }
});

test('after 2 minutes offline the clock places for a player in setup: the richest corner, then a road by it', () => {
  const t = table();
  try {
    play(t);
    play(t); // The first player has placed; the draft now waits on the second.
    const absent = seatOf(t, owedMoves(game(t))[0]!.player);
    assert.equal(game(t).phase, 'setupSettlement');
    const before = game(t);
    const sites = t.store.snapshot(t.roomId, absent.id).game!.legal.settlements;
    const richest = Math.max(...sites.map((v) => production(before, v)));
    t.store.setConnected(absent, false);
    // The room wakes by itself when the 2 minutes are up, with no turn timer.
    t.clock.now += ABSENCE_AFTER_MS - 1;
    assert.equal(t.store.clock(t.roomId), undefined, 'setup is untimed');
    assert.ok(!t.store.dueRooms().includes(t.roomId));
    assert.equal(t.store.expireRoom(t.roomId), false);
    assert.equal(game(t).phase, 'setupSettlement');
    t.clock.now += 1;
    assert.ok(t.store.dueRooms().includes(t.roomId));
    assert.equal(t.store.expireRoom(t.roomId), true);
    const after = game(t);
    const [corner] = Object.entries(after.buildings).find(([, b]) => b.player === absent.id)!;
    assert.equal(production(after, Number(corner)), richest);
    const [road] = Object.entries(after.roads).find(([, owner]) => owner === absent.id)!;
    const edge = after.board.edges[Number(road)]!;
    assert.ok(edge.a === Number(corner) || edge.b === Number(corner));
    assert.deepEqual(awayLines(after), [
      `${absent.name} is away; starting settlement placed automatically.`,
      `${absent.name} is away; starting road placed automatically.`,
    ]);
    // The draft moves on to a player who is here, and waits for them.
    assert.notEqual(owedMoves(after)[0]!.player, absent.id);
    const history = t.store.history(t.roomId).entries.slice(0, 2);
    assert.ok(history.every((entry) => entry.automatic));
    assert.equal(
      t.store.db
        .prepare("SELECT count(*) AS n FROM game_events WHERE room_id = ? AND actor_kind = 'timer'")
        .get(t.roomId)!.n,
      2,
    );
  } finally {
    t.store.close();
  }
});

test('a player who placed the settlement before leaving gets only the road', () => {
  const t = table();
  try {
    const first = seatOf(t, owedMoves(game(t))[0]!.player);
    const vertex = t.store.snapshot(t.roomId, first.id).game!.legal.settlements[0]!;
    t.store.action(first, 'own-settlement', t.revision(), { kind: 'settlement', vertex });
    t.store.setConnected(first, false);
    t.clock.now += ABSENCE_AFTER_MS;
    t.store.expireRoom(t.roomId);
    const g = game(t);
    assert.equal(g.buildings[vertex]?.player, first.id, 'their own choice stands');
    assert.equal(Object.values(g.buildings).filter((b) => b.player === first.id).length, 1);
    assert.equal(Object.values(g.roads).filter((owner) => owner === first.id).length, 1);
    assert.deepEqual(awayLines(g), [`${first.name} is away; starting road placed automatically.`]);
  } finally {
    t.store.close();
  }
});

test('in play the clock makes only forced moves for the absent player, until they come back', () => {
  const t = table();
  try {
    while (game(t).turn === 0) play(t);
    const absent = seatOf(t, game(t).players[(game(t).active + 1) % 3]!.id);
    t.store.setConnected(absent, false);
    const before = game(t);
    const owned = (g: Game) => ({
      buildings: Object.entries(g.buildings).filter(([, b]) => b.player === absent.id),
      roads: Object.entries(g.roads).filter(([, owner]) => owner === absent.id),
      cards: g.players.find((p) => p.id === absent.id)!.cards,
    });
    t.clock.now += ABSENCE_AFTER_MS + 1;
    t.store.expireRoom(t.roomId);
    assert.notEqual(activePlayer(game(t)).id, absent.id, 'not their turn: nothing to do yet');
    // Their turn comes round and passes: the clock rolls and ends it at once.
    playUntil(t, absent, (g) => awayLines(g).some((line) => /turn ended automatically/.test(line)));
    const g = game(t);
    assert.ok(awayLines(g).includes(`${absent.name} is away; dice rolled automatically.`));
    assert.notEqual(activePlayer(g).id, absent.id);
    // Nothing bought, built or played for them.
    assert.deepEqual(owned(g), owned(before));
    // Back again: the rule stops the moment they reconnect.
    t.store.setConnected(absent, true);
    playUntil(t, absent, (next) => activePlayer(next).id === absent.id);
    const waiting = awayLines(game(t)).length;
    t.clock.now += 10 * ABSENCE_AFTER_MS;
    t.store.expireRoom(t.roomId);
    assert.equal(activePlayer(game(t)).id, absent.id, 'a returned player plays their own turn');
    assert.equal(awayLines(game(t)).length, waiting);
  } finally {
    t.store.close();
  }
});

test('an absent player the game is not waiting on does not wake the room on every tick', () => {
  const t = table();
  try {
    while (game(t).turn === 0) play(t);
    // Two seats on: nobody waits for them this turn, nor for the next one's.
    const absent = seatOf(t, game(t).players[(game(t).active + 2) % 3]!.id);
    t.store.setConnected(absent, false);
    t.clock.now += ABSENCE_AFTER_MS + 5_000;
    const next = () =>
      (
        t.store.db.prepare('SELECT next_deadline FROM room_presence WHERE room_id = ?').get(t.roomId) as {
          next_deadline: number | null;
        }
      ).next_deadline;
    // Past the 2 minutes, but the game waits on someone who is here: no deadline, so no wake-ups.
    assert.equal(next(), null);
    for (let tick = 0; tick < 20; tick++) {
      assert.ok(!t.store.dueRooms().includes(t.roomId), `tick ${tick}`);
      t.store.expireRoom(t.roomId);
      t.clock.now += 500;
    }
    assert.deepEqual(awayLines(game(t)), []);
    // Once the game does wait on them, the room is due at once.
    playUntil(t, absent, (g) => owedMoves(g).some((move) => move.player === absent.id));
    assert.ok(next()! <= t.clock.now);
    assert.ok(t.store.dueRooms().includes(t.roomId));
  } finally {
    t.store.close();
  }
});

test('an absent player owed a discard has it made for them, and the others still choose their own', () => {
  const t = table();
  try {
    while (game(t).turn === 0) play(t);
    const g = game(t);
    const [roller, absentId, third] = [0, 1, 2].map((i) => g.players[(g.active + i) % 3]!.id) as [
      string,
      string,
      string,
    ];
    rig(t, (rigged) => {
      // A seven with two big hands to halve: the absent player's and a present one's.
      for (const id of [absentId, third]) {
        const player = rigged.players.find((p) => p.id === id)!;
        for (const r of RESOURCES) {
          player.hand[r] += 2;
          rigged.bank[r] -= 2;
        }
      }
      rigged.phase = 'discard';
      rigged.discards = {
        [absentId]: Math.floor(total(rigged.players.find((p) => p.id === absentId)!.hand) / 2),
        [third]: Math.floor(total(rigged.players.find((p) => p.id === third)!.hand) / 2),
      };
      rigged.returnPhase = 'actions';
    });
    const held = total(game(t).players.find((p) => p.id === absentId)!.hand);
    t.store.setConnected(seatOf(t, absentId), false);
    t.clock.now += ABSENCE_AFTER_MS;
    t.store.expireRoom(t.roomId);
    const after = game(t);
    assert.deepEqual(Object.keys(after.discards), [third], 'only the absent player’s discard was made');
    assert.equal(total(after.players.find((p) => p.id === absentId)!.hand), held - Math.floor(held / 2));
    for (const r of RESOURCES)
      assert.equal(after.bank[r] + after.players.reduce((n, p) => n + p.hand[r], 0), TEST_TABLE.supply.bank);
    assert.equal(activePlayer(after).id, roller);
    assert.deepEqual(awayLines(after), [
      `${seatOf(t, absentId).name} is away; required cards discarded automatically.`,
    ]);
  } finally {
    t.store.close();
  }
});

test('an empty table pauses the rule; the first player back finds it acting again at once, timer or not', () => {
  const t = table({ timer: 40 });
  try {
    while (game(t).turn === 0) play(t);
    const absent = seatOf(t, game(t).players[(game(t).active + 1) % 3]!.id);
    t.store.setConnected(absent, false);
    t.clock.now += ABSENCE_AFTER_MS + 1;
    // Everyone else leaves too: nothing moves while nobody is at the table.
    const others = t.seats.filter((seat) => seat.id !== absent.id);
    for (const seat of others) t.store.setConnected(seat, false);
    assert.equal(t.store.snapshot(t.roomId).paused, true);
    const paused = JSON.stringify(game(t));
    t.clock.now += 60_000;
    t.store.expireRoom(t.roomId);
    assert.equal(JSON.stringify(game(t)), paused);
    // The others return within their grace. The absent player is still gone, so their turn passes at once,
    // long before the 40-second timer would end it.
    for (const seat of others) t.store.setConnected(seat, true);
    const started = t.clock.now;
    playUntil(t, absent, (g) => awayLines(g).some((line) => /turn ended automatically/.test(line)));
    assert.equal(t.clock.now, started, 'no time passed');
  } finally {
    t.store.close();
  }
});

test('Classic is unchanged: a stand-in takes an empty seat after 30 seconds and the clock never acts for it', () => {
  const t = table({ mode: CLASSIC.id });
  try {
    play(t);
    play(t);
    const absent = seatOf(t, owedMoves(game(t))[0]!.player);
    t.store.setConnected(absent, false);
    t.clock.now += STANDIN_AFTER_MS;
    t.store.expireRoom(t.roomId);
    assert.deepEqual(t.store.standInIds(t.roomId), [absent.id]);
    t.clock.now += 10 * ABSENCE_AFTER_MS;
    t.store.expireRoom(t.roomId);
    assert.deepEqual(awayLines(game(t)), []);
    assert.equal(owedMoves(game(t))[0]!.player, absent.id, 'the stand-in bot, not the clock, plays the seat');
  } finally {
    t.store.close();
  }
});

test('after a restart a seat still gone counts from start-up; one already gone keeps its time', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-absence-restart-'));
  const path = join(directory, 'game.sqlite');
  const clock = { now: 1_000_000 };
  const t = table({ path, clock });
  let store = t.store;
  try {
    play(t);
    play(t);
    const gone = seatOf(t, owedMoves(game(t))[0]!.player);
    store.setConnected(gone, false);
    clock.now += 60_000;
    store.close();
    // The server restarts a minute later. One player was still connected then and never comes back.
    store = new Store(path, { now: () => clock.now, trackPresence: true, modes: OPEN });
    const restartedAt = clock.now;
    const late = t.seats.find((seat) => seat.id !== gone.id)!;
    for (const seat of t.seats)
      if (seat.id !== gone.id && seat.id !== late.id) store.setConnected(seat, true);
    const seats = Object.fromEntries(store.snapshot(t.roomId).players.map((p) => [p.id, p.disconnectedAt]));
    assert.equal(seats[gone.id], 1_000_000, 'already gone: its own disconnection still counts');
    assert.equal(seats[late.id], restartedAt, 'connected before the restart: counted from start-up');
    // One more minute is the gone player's 2 minutes: the clock places for them.
    clock.now += 60_000;
    store.expireRoom(t.roomId);
    assert.ok(Object.values(store.loadGame(t.roomId)!.buildings).some((b) => b.player === gone.id));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
