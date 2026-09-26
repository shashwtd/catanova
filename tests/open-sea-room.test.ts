/**
 * Open Sea in a room, through the Store (docs/RULEBOOK-OPEN-SEA.md, section 15, and docs/TURN_CLOCK.md): the
 * lobby's board by seated count, the 20-second gold clock with and without a turn timer, the player on turn
 * waiting while picks are made, resignations and absences during them, and a whole game with an absent player
 * that replays from its journal, passes the restore verifier and reads in the admin's game analytics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ABSENCE_AFTER_MS, Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import type { ModeSwitches } from '../apps/server/src/modes.js';
import { computeGameAnalytics } from '../apps/server/src/admin/game-analytics.js';
import { newSession } from '../apps/client/src/connection.js';
import { gameInvariantProblems, verifyStore } from '../scripts/verify-restored-games.js';
import { dealBoard, isLand, pips, seededRandom } from '../packages/rules/src/board.js';
import { RuleError, activePlayer, applyAction, total } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { CLASSIC, OPEN_SEA } from '../packages/rules/src/rulesets.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import type { TurnTimerSeconds } from '../packages/protocol/src/settings.js';
import { accountedFor, dealCards, rigGold } from './open-sea-game.js';
import { scriptedMove } from './open-sea-play.js';

const OPEN: ModeSwitches = { open: [CLASSIC.id, OPEN_SEA.id], testers: new Set() };
const die = (face: number) => (face - 0.5) / 6;
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const NAMES = ['Ann', 'Ben', 'Cat', 'Dan'];

/** A lobby of `count` players in a store on a fake clock, whose dice a test may queue. */
function lobby(count: number, clock = { now: 1_000_000 }) {
  const queue: number[] = [];
  const seeded = seededRandom(20260926);
  const store = new Store(':memory:', {
    now: () => clock.now,
    trackPresence: true,
    modes: OPEN,
    random: () => (queue.length ? queue.shift()! : seeded()),
  });
  const sessions = NAMES.slice(0, count).map((name) => newSession(name));
  const host = store.enter('create', sessions[0]!.token, sessions[0]!.name);
  const seats: Seat[] = [host];
  const join = (name: string) => {
    const session = newSession(name);
    const seat = store.enter('join', session.token, session.name, host.room_id);
    store.setConnected(seat, true);
    seats.push(seat);
    return seat;
  };
  store.setConnected(host, true);
  for (const name of NAMES.slice(1, count)) join(name);
  const roomId = host.room_id;
  const revision = () => store.snapshot(roomId).revision;
  return { store, clock, queue, roomId, host, seats, revision, join };
}
type Table = ReturnType<typeof lobby>;

/**
 * An Open Sea game of `count` players, started, with setup played by the clock's own placements. The store deals
 * the lobby's board from the server's own randomness; a test lays down one from a fixed seed instead, so that it
 * plays the same game every time. With `goldOnMain`, the main island's richest tile is a gold field, which Outer
 * Isles never deals but the rules allow (section 5.5): gold then comes into setup and most turns.
 */
function table(count: number, timer: TurnTimerSeconds | null = null, options: { goldOnMain?: boolean } = {}) {
  const t = started(count, timer, options);
  while (game(t).turn === 0) play(t);
  return t;
}
/** The same game, just started: setup is still to play. */
function started(
  count: number,
  timer: TurnTimerSeconds | null = null,
  options: { goldOnMain?: boolean } = {},
) {
  const t = lobby(count);
  t.store.configureSettings(t.host, 'sea', t.revision(), { turnTimerSeconds: timer, mode: OPEN_SEA.id });
  const board = dealBoard(2026, OPEN_SEA.board, count);
  if (options.goldOnMain)
    board.hexes
      .filter((h) => h.island === 'main' && h.terrain !== 'desert')
      .sort((a, b) => pips(b.number) - pips(a.number))[0]!.terrain = 'gold';
  t.store.db
    .prepare('UPDATE room_boards SET board = ? WHERE room_id = ?')
    .run(JSON.stringify(board), t.roomId);
  for (const seat of t.seats.slice(1)) t.store.lobby(seat, `ready-${seat.id}`, t.revision(), true);
  t.store.action(t.host, 'start', t.revision(), { kind: 'start' });
  return t;
}
const game = (t: Table) => t.store.loadGame(t.roomId)!;
const seatOf = (t: Table, id: string) => t.seats.find((seat) => seat.id === id)!;
let commands = 0;
/** The first player the game waits on makes a move: the clock's, unless a move is given. */
function play(t: Table, move?: { player: string; action: GameAction }) {
  const owed = owedMoves(game(t))[0]!;
  const player = move?.player ?? owed.player;
  const action = move?.action ?? timeoutAction(game(t), player, seededRandom(++commands))!;
  t.store.action(seatOf(t, player), `move-${++commands}`, t.revision(), action);
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
/**
 * Rig the next roll to pay gold to `pickers`, in the order given: a settlement for each on a corner of a gold
 * field, with the island bonus it would have earned, and the dice queued for its number. Nothing else on the
 * board has that number.
 */
function goldRoll(t: Table, pickers: string[]) {
  const g = game(t);
  const gold = g.board.hexes.find((h) => h.terrain === 'gold')!;
  rig(t, (rigged) => {
    for (const h of rigged.board.hexes) if (h.id !== gold.id && h.number === gold.number) h.number = 0;
    const corners = gold.vertices.filter((v) => !rigged.buildings[v]);
    for (const [i, player] of pickers.entries()) {
      rigged.buildings[corners[i * 2]!] = { player, kind: 'settlement' };
      rigged.islandBonuses![player] = [...(rigged.islandBonuses![player] ?? []), gold.island!];
    }
  });
  const first = Math.max(1, gold.number - 6);
  t.queue.push(die(first), die(gold.number - first));
  return gold;
}
const lines = (t: Table, pattern: RegExp) =>
  game(t)
    .log.filter((line) => pattern.test(line.text))
    .map((line) => line.text);

test('§15.1 an Open Sea lobby holds the board for its seated count, dealt again from the same seed as it moves', () => {
  const t = lobby(2);
  try {
    // Two players may switch to Open Sea and wait for a third; the target becomes 14.
    t.store.configureSettings(t.host, 'sea', t.revision(), { turnTimerSeconds: 90, mode: OPEN_SEA.id });
    assert.equal(t.store.settings(t.roomId).mode, OPEN_SEA.id);
    assert.equal(t.store.settings(t.roomId).victoryPoints, undefined, 'the mode’s default, 14');
    const two = t.store.board(t.roomId);
    assert.deepEqual([two.preset, two.players, two.hexes.length], ['outer-isles-v1', 3, 72]);
    assert.throws(
      () => t.store.lobby(t.host, 'bot', t.revision(), false, undefined, undefined, true),
      code('MODE_BOTS'),
    );
    const third = t.join('Cat');
    assert.deepEqual(t.store.board(t.roomId), two, 'three players keep the three-player board');
    for (const seat of t.seats.slice(1)) t.store.lobby(seat, `ready-${seat.id}`, t.revision(), true);
    const settingsRevision = () =>
      t.store.db.prepare('SELECT revision FROM room_settings WHERE room_id = ?').get(t.roomId)!.revision;
    const before = settingsRevision();
    // A fourth sits down: the same seed, dealt on the four-player template, well within the 100 ms budget.
    const fourth = t.join('Dan');
    const started = performance.now();
    const four = t.store.board(t.roomId);
    assert.ok(performance.now() - started < 100, 'dealt within 100 ms');
    assert.deepEqual([four.players, four.hexes.length, four.seed], [4, 77, two.seed]);
    assert.deepEqual(four, dealBoard(two.seed, 'outer-isles-v1', 4));
    assert.equal(t.store.snapshot(t.roomId).board!.players, 4);
    // Nobody has seen the board, so it is not a settings change: readiness stands.
    assert.equal(settingsRevision(), before);
    assert.ok(
      t.store
        .snapshot(t.roomId)
        .players.filter((p) => p.id !== fourth.id && p.id !== t.host.id)
        .every((p) => p.ready),
    );
    // The fourth leaves: the three-player board again, the same one.
    t.store.lobby(t.host, 'kick', t.revision(), false, undefined, fourth.id);
    assert.deepEqual(t.store.board(t.roomId), two);
    // The game starts on the board the lobby holds, in Open Sea, with its target.
    t.store.action(t.host, 'start', t.revision(), { kind: 'start' });
    const g = game(t);
    assert.deepEqual(g.board, two);
    assert.equal(g.ruleset, OPEN_SEA.id);
    assert.equal(g.victoryPoints, 14);
    assert.equal(g.players.length, 3);
    assert.ok(third);
  } finally {
    t.store.close();
  }
  // Too few to start: the rules say so.
  const small = lobby(2);
  try {
    small.store.configureSettings(small.host, 'sea', small.revision(), {
      turnTimerSeconds: null,
      mode: OPEN_SEA.id,
    });
    small.store.lobby(small.seats[1]!, 'ready', small.revision(), true);
    assert.throws(
      () => small.store.action(small.host, 'start', small.revision(), { kind: 'start' }),
      (error: unknown) => error instanceof RuleError && error.message === 'Start with three to four players',
    );
  } finally {
    small.store.close();
  }
});

test('§9.5 and §15.3 without a turn timer a gold pick still has 20 seconds, and the clock then picks', () => {
  const t = table(3);
  try {
    const roller = activePlayer(game(t)).id;
    const picker = game(t).players.find((p) => p.id !== roller)!.id;
    goldRoll(t, [picker]);
    assert.equal(t.store.clock(t.roomId), undefined, 'no clock in a room without a timer');
    play(t, { player: roller, action: { kind: 'roll' } });
    assert.equal(game(t).phase, 'goldPick');
    const now = t.clock.now;
    assert.deepEqual(t.store.clock(t.roomId), {
      playerId: roller,
      turn: game(t).turn,
      startedAt: now,
      pausedAt: now,
      goldDeadlines: { [picker]: now + 20_000 },
    });
    t.clock.now += 19_999;
    assert.ok(!t.store.dueRooms().includes(t.roomId));
    assert.equal(t.store.expireRoom(t.roomId), false);
    t.clock.now += 1;
    assert.ok(t.store.dueRooms().includes(t.roomId));
    assert.equal(t.store.expireRoom(t.roomId), true);
    const name = seatOf(t, picker).name;
    assert.deepEqual(lines(t, / timer expired; /), [
      `${name}'s timer expired; gold picks made automatically.`,
    ]);
    assert.equal(game(t).phase, 'actions');
    assert.equal(t.store.clock(t.roomId), undefined, 'the clock goes with the last pick');
    assert.deepEqual(accountedFor(game(t)), []);
  } finally {
    t.store.close();
  }
});

test('§9.2 with a turn timer the player on turn waits while the picks are made, and their time resumes after', () => {
  const t = table(3, 90);
  try {
    const roller = activePlayer(game(t)).id;
    const [first, second] = game(t)
      .players.map((p) => p.id)
      .filter((id) => id !== roller);
    const turnClock = t.store.clock(t.roomId)!;
    t.clock.now += 10_000;
    goldRoll(t, [first!, second!]);
    play(t, { player: roller, action: { kind: 'roll' } });
    const rolledAt = t.clock.now;
    // The pickers go in turn order from the player on turn, each with 20 seconds of their own.
    const order = game(t).goldOwed!.map((owed) => owed.player);
    assert.deepEqual(order.sort(), [first, second].sort());
    assert.deepEqual(t.store.clock(t.roomId), {
      ...turnClock,
      pausedAt: rolledAt,
      goldDeadlines: { [game(t).goldOwed![0]!.player]: rolledAt + 20_000 },
    });
    // The first picks after 5 seconds; the second's 20 seconds start then.
    t.clock.now += 5_000;
    const [a, b] = game(t).goldOwed!.map((owed) => owed.player);
    play(t, { player: a!, action: timeoutAction(game(t), a!, () => 0.5)! });
    assert.deepEqual(t.store.clock(t.roomId)!.goldDeadlines, { [b!]: t.clock.now + 20_000 });
    assert.equal(t.store.clock(t.roomId)!.pausedAt, rolledAt);
    t.clock.now += 3_000;
    play(t, { player: b!, action: timeoutAction(game(t), b!, () => 0.5)! });
    // Picks took 8 seconds; the player on turn gets them back.
    assert.deepEqual(t.store.clock(t.roomId), { ...turnClock, deadlineAt: turnClock.deadlineAt! + 8_000 });
    assert.equal(game(t).phase, 'actions');
    // In the admin's analytics the 8 seconds are the pickers', not the turn's: a 20-second turn counts 12.
    t.clock.now += 2_000;
    play(t, { player: roller, action: { kind: 'endTurn' } });
    const analytics = computeGameAnalytics(t.store.db, {
      roomId: t.roomId,
      archiveId: null,
      toRevision: t.store.snapshot(t.roomId).historyRevision,
    });
    assert.deepEqual(analytics.players.find((player) => player.id === roller)!.turnTime, {
      turns: 1,
      meanSeconds: 12,
      medianSeconds: 12,
      botTurns: 0,
    });
  } finally {
    t.store.close();
  }
});

test('§15.3 a turn that runs out rolls, lets each owed player pick on their own clock, then ends', () => {
  const t = table(3, 40);
  try {
    const roller = activePlayer(game(t)).id;
    const picker = game(t).players.find((p) => p.id !== roller)!.id;
    goldRoll(t, [picker]);
    t.clock.now = t.store.clock(t.roomId)!.deadlineAt!;
    t.store.expireRoom(t.roomId);
    assert.equal(game(t).phase, 'goldPick', 'the clock rolled, and the picks wait for the picker');
    assert.equal(activePlayer(game(t)).id, roller);
    t.clock.now += 20_000;
    t.store.expireRoom(t.roomId);
    const [rollerName, pickerName] = [seatOf(t, roller).name, seatOf(t, picker).name];
    assert.deepEqual(lines(t, / timer expired; /), [
      `${rollerName}'s timer expired; dice rolled automatically.`,
      `${pickerName}'s timer expired; gold picks made automatically.`,
      `${rollerName}'s timer expired; turn ended automatically.`,
    ]);
    assert.notEqual(activePlayer(game(t)).id, roller);
  } finally {
    t.store.close();
  }
});

test('§15.5 a player offline for 2 minutes has their gold picks made at once; one who leaves loses theirs', () => {
  const t = table(4);
  try {
    const g = game(t);
    const roller = activePlayer(g).id;
    const [away, leaving, staying] = [1, 2, 3].map((i) => g.players[(g.active + i) % 4]!.id) as [
      string,
      string,
      string,
    ];
    t.store.setConnected(seatOf(t, away), false);
    t.clock.now += ABSENCE_AFTER_MS;
    goldRoll(t, [away, leaving, staying]);
    play(t, { player: roller, action: { kind: 'roll' } });
    assert.deepEqual(
      game(t).goldOwed!.map((owed) => owed.player),
      [away, leaving, staying],
    );
    // The room is due at once: the away player's picks are the clock's.
    assert.ok(t.store.dueRooms().includes(t.roomId));
    t.store.expireRoom(t.roomId);
    assert.deepEqual(lines(t, / is away; /), [
      `${seatOf(t, away).name} is away; gold picks made automatically.`,
    ]);
    assert.equal(game(t).goldOwed![0]!.player, leaving);
    // The next picker leaves the table: their picks lapse, and the last picks from the bank as it now stands.
    t.store.leave(seatOf(t, leaving), 'leave', t.revision());
    assert.deepEqual(game(t).goldOwed, [{ player: staying, picks: 1 }]);
    play(t, { player: staying, action: timeoutAction(game(t), staying, () => 0.5)! });
    assert.equal(game(t).phase, 'actions');
    assert.equal(activePlayer(game(t)).id, roller);
    assert.deepEqual(accountedFor(game(t)), []);
    assert.deepEqual(gameInvariantProblems(game(t)), []);
  } finally {
    t.store.close();
  }
});

test('§9.2 and §12.3 a player leaving during gold picks can hand the player on turn the win: the picks end with it', () => {
  const t = table(4, 90);
  try {
    const g0 = game(t);
    const [onTurn, picker, , holder] = [0, 1, 2, 3].map((i) => g0.players[(g0.active + i) % 4]!.id) as [
      string,
      string,
      string,
      string,
    ];
    let goldNumber = 0;
    rig(t, (g) => {
      // The player on turn: two cities and four hidden Victory Point cards, 8 of a target of 10, and three
      // Knights, as many as the holder of Largest Army. The next player is owed a pick from a gold field.
      g.victoryPoints = 10;
      for (const [v, building] of Object.entries(g.buildings))
        if (building.player === onTurn) g.buildings[Number(v)] = { player: onTurn, kind: 'city' };
      dealCards(g, onTurn, 'victoryPoint', 4);
      dealCards(g, onTurn, 'knight', 3, true);
      dealCards(g, holder, 'knight', 3, true);
      g.largestArmy = holder;
      goldNumber = rigGold(g, [picker]).gold.number;
    });
    const first = Math.max(1, goldNumber - 6);
    t.queue.push(die(first), die(goldNumber - first));
    play(t, { player: onTurn, action: { kind: 'roll' } });
    assert.deepEqual(game(t).goldOwed, [{ player: picker, picks: 1 }]);
    assert.ok(t.store.clock(t.roomId)!.goldDeadlines![picker]);
    // The holder leaves while the picker picks: the award passes to the player on turn, who wins at once.
    t.store.leave(seatOf(t, holder), 'leave-holder', t.revision());
    const done = game(t);
    assert.deepEqual([done.phase, done.winner, done.largestArmy], ['finished', onTurn, onTurn]);
    assert.deepEqual(done.goldOwed, []);
    assert.equal(t.store.clock(t.roomId), undefined, 'no clock is left running');
    const room = verifyStore(t.store).details.find((detail) => detail.roomId === t.roomId)!;
    assert.equal(room.status, 'verified', room.problems.join('; '));
  } finally {
    t.store.close();
  }
});

test('a whole game with an absent player replays from its journal, passes the verifier and reads in analytics', () => {
  const t = table(4, 65, { goldOnMain: true });
  try {
    const random = seededRandom(69);
    // The player who settled by the gold field drops out early and never returns: after 2 minutes the clock
    // makes their forced moves, their gold picks among them.
    const gold = game(t).board.hexes.find((h) => h.terrain === 'gold' && h.island === 'main')!;
    const absent = gold.vertices.map((v) => game(t).buildings[v]?.player).find((player) => player)!;
    assert.ok(absent, 'somebody settled by the gold field in setup');
    let turnActions = 0,
      turn = 0,
      gone = false;
    for (let step = 0; step < 4000 && game(t).phase !== 'finished'; step++) {
      if (game(t).turn === 3 && !gone) {
        t.store.setConnected(seatOf(t, absent), false);
        // Two minutes pass, which also runs out the turn of whoever is on turn.
        t.clock.now += ABSENCE_AFTER_MS;
        gone = true;
      }
      // The server's scheduler: whatever is due is played first, the absent player's forced moves included.
      if (t.store.dueRooms().includes(t.roomId)) t.store.expireRoom(t.roomId);
      const g = game(t);
      if (g.phase === 'finished') break;
      assert.ok(!owedMoves(g).some((move) => move.player === absent) || !gone, 'the clock moved for them');
      if (g.turn !== turn) [turn, turnActions] = [g.turn, 0];
      const move = scriptedMove(g, random)!;
      const action =
        g.phase === 'actions' && ++turnActions > 14 ? ({ kind: 'endTurn' } as const) : move.action;
      t.store.action(seatOf(t, move.player), `game-${step}`, t.revision(), action);
      assert.deepEqual(accountedFor(game(t)), [], `step ${step}`);
    }
    const final = game(t);
    assert.equal(final.phase, 'finished');
    assert.ok(final.winner && final.winner !== absent);
    // The clock played their forced moves, each logged as the player being away.
    const awayLines = (
      t.store.db
        .prepare(
          "SELECT public_entry FROM game_events WHERE room_id = ? AND json_extract(public_entry, '$.automatic') = 1",
        )
        .all(t.roomId) as { public_entry: string }[]
    ).flatMap((row) => (JSON.parse(row.public_entry) as { lines: string[] }).lines);
    const name = seatOf(t, absent).name;
    for (const what of ['dice rolled', 'gold picks made', 'turn ended'])
      assert.ok(awayLines.includes(`${name} is away; ${what} automatically.`), what);

    // Replay: every row follows from the one before by its recorded action, dice and thefts as recorded.
    const rows = t.store.db
      .prepare(
        'SELECT revision, actor, action, public_entry FROM game_events WHERE room_id = ? ORDER BY revision',
      )
      .all(t.roomId) as { revision: number; actor: string; action: string; public_entry: string }[];
    let previous: Game | undefined,
      replayed = 0;
    const kinds = new Set<string>();
    for (const row of rows) {
      const state = t.store.journalState(t.roomId, row.revision)!;
      assert.deepEqual(gameInvariantProblems(state), [], `revision ${row.revision}`);
      assert.deepEqual(accountedFor(state), [], `revision ${row.revision}`);
      const action = JSON.parse(row.action) as GameAction;
      const entry = JSON.parse(row.public_entry) as { kind: string; automatic?: boolean };
      if (previous && entry.kind !== 'start') {
        const next = applyAction(previous, row.actor, action, oracle(previous, state, action, row.actor));
        // A move the clock made carries the line saying so, which the store adds after the rules.
        if (entry.automatic) {
          assert.match(state.log.at(-1)!.text, /'s timer expired; | is away; /);
          next.log.push({ id: next.nextLog++, text: state.log.at(-1)!.text });
          if (next.log.length > 80) next.log.shift();
        }
        assert.deepEqual(next, state, `revision ${row.revision}: ${action.kind}`);
        kinds.add(action.kind);
        replayed++;
      }
      previous = state;
    }
    assert.equal(replayed, rows.length - 1);
    for (const kind of ['ship', 'moveShip', 'pirate', 'robber', 'goldPick', 'roll', 'settlement', 'endTurn'])
      assert.ok(kinds.has(kind), `the game had a ${kind}`);
    assert.deepEqual(t.store.verifyJournal(t.roomId).problems, []);

    // The restore verifier checks it against Open Sea's own seats, bank, deck, pieces and ships.
    const report = verifyStore(t.store);
    const room = report.details.find((detail) => detail.roomId === t.roomId)!;
    assert.equal(room.status, 'verified', room.problems.join('; '));
    assert.equal(room.ruleset, OPEN_SEA.id);
    assert.equal(room.players, 4);

    // The admin's game analytics: every resource gained, spent or lost adds up to each hand, ships and gold
    // included; the pirate's moves are listed; turn times leave out other players' gold picks.
    const analytics = computeGameAnalytics(t.store.db, {
      roomId: t.roomId,
      archiveId: null,
      toRevision: rows.at(-1)!.revision,
    });
    assert.equal(analytics.victoryPoints, 14);
    for (const stats of analytics.players) {
      const player = final.players.find((p) => p.id === stats.id)!;
      if (player.resigned) continue;
      const { gained, spent, lost, produced } = stats.resources;
      const sum = (counts: Record<string, number | undefined>) =>
        Object.values(counts).reduce<number>((n, value) => n + (value ?? 0), 0);
      assert.equal(sum(gained) - sum(spent) - sum(lost), total(player.hand), stats.name);
      assert.equal(sum(produced), gained.production);
      assert.equal(stats.pieces.ships, Object.values(final.ships!).filter((id) => id === stats.id).length);
      assert.ok(stats.turnTime.turns > 0 && stats.turnTime.meanSeconds! >= 0);
    }
    assert.ok(analytics.players.some((stats) => (stats.resources.spent.ships ?? 0) > 0));
    assert.ok(analytics.robberMoves.some((move) => move.piece === 'pirate' && move.terrain === 'sea'));
    assert.ok(analytics.robberMoves.some((move) => !move.piece && isLand({ terrain: move.terrain })));
  } finally {
    t.store.close();
  }
});

/**
 * A random source that reproduces a recorded move: the dice the row shows, and for a theft by the robber or the
 * pirate the card that moved. Nothing else in a move draws randomness.
 */
function oracle(before: Game, after: Game, action: GameAction, actor: string): () => number {
  const values: number[] = [];
  if (action.kind === 'roll') values.push(die(after.dice![0]), die(after.dice![1]));
  if ((action.kind === 'robber' || action.kind === 'pirate') && action.victim) {
    const victim = before.players.find((p) => p.id === action.victim)!;
    const cards = RESOURCES.flatMap((r) => Array<string>(victim.hand[r]).fill(r));
    const gained = RESOURCES.find(
      (r) =>
        after.players.find((p) => p.id === actor)!.hand[r] >
        before.players.find((p) => p.id === actor)!.hand[r],
    );
    if (cards.length) values.push((cards.indexOf(gained!) + 0.5) / cards.length);
  }
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error(`${action.kind} drew randomness the journal cannot account for`);
    return value;
  };
}
