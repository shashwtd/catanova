import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../apps/server/src/store.js';
import { applyAction, createGame, gameView, resignPlayers } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { decide, initialPlan } from '../packages/bot/src/index.js';
import type { BotPlan } from '../packages/bot/src/index.js';
import {
  continueGame,
  gameInvariantProblems,
  main,
  seededRandom,
  UnusableInput,
  verifyRestoredDatabase,
  verifyStore,
} from '../scripts/verify-restored-games.js';
import { buildPlayedDatabase, makeStandalone } from './restore-fixture.js';

/** Until the compact journal lands, this release's Store has no verifyJournal to call. */
const hasJournalCheck = typeof (Store.prototype as { verifyJournal?: unknown }).verifyJournal === 'function';
const MISSING = /has no verifyJournal/;

/** Every state of a seeded offline bot game, with resignations injected where the rules allow. */
async function simulate(seed: number, seats: number, steps: number) {
  const random = seededRandom(`simulation-${seed}`);
  let game = createGame(
    Array.from({ length: seats }, (_, i) => ({ id: `seat-${i}`, name: `Seat ${i}` })),
    seed,
    random,
    { diceMode: seed % 2 ? 'balanced' : 'classic' },
  );
  const states: Game[] = [game];
  const plans = new Map<string, BotPlan>();
  let resignedDuringDiscard = false;
  for (let step = 0; step < steps && game.phase !== 'finished'; step++) {
    const remaining = game.players.filter((p) => !p.resigned);
    const active = game.players[game.active]!;
    // A departing active player while others still owe discards is the rules' least obvious state.
    if (
      seats > 2 &&
      remaining.length > 2 &&
      game.phase === 'discard' &&
      Object.keys(game.discards).some((id) => id !== active.id)
    ) {
      game = resignPlayers(game, [active.id], { reason: 'leave' });
      resignedDuringDiscard ||= game.phase === 'discard' && game.players[game.active]!.resigned === true;
      states.push(game);
      continue;
    }
    if (seats > 2 && step === 180 && remaining.length > 2) {
      game = resignPlayers(game, [remaining[remaining.length - 1]!.id], { reason: 'disconnect' });
      states.push(game);
      continue;
    }
    const actor = game.phase === 'discard' ? Object.keys(game.discards).sort()[0]! : active.id;
    const decision = await decide({
      view: gameView(game, actor),
      board: game.board,
      meId: actor,
      plan: plans.get(actor) ?? initialPlan(game.turn),
      jev: null,
    });
    plans.set(actor, decision.plan);
    try {
      game = applyAction(game, actor, decision.action, random);
    } catch {
      // As scripts/bot-game.ts does: a refused choice falls back to the mandatory move.
      const rescue = timeoutAction(game, actor, random);
      assert.ok(rescue, `no mandatory move at step ${step} during ${game.phase}`);
      game = applyAction(game, actor, rescue, random);
    }
    states.push(game);
  }
  return { states, resignedDuringDiscard };
}

test('every state of played bot games satisfies the invariants and can continue', async () => {
  let checked = 0,
    discardWithResignedActive = false;
  const phases = new Set<string>();
  for (const [seed, seats] of [
    [11, 2],
    [12, 3],
    [13, 4],
    [14, 4],
  ] as const) {
    const { states, resignedDuringDiscard } = await simulate(seed, seats, 320);
    discardWithResignedActive ||= resignedDuringDiscard;
    for (const [index, state] of states.entries()) {
      phases.add(state.phase);
      assert.deepEqual(gameInvariantProblems(state), [], `seed ${seed}, state ${index} (${state.phase})`);
      assert.deepEqual(continueGame(state, `room-${seed}`).problems, [], `seed ${seed}, state ${index}`);
      checked++;
    }
  }
  assert.ok(checked > 1000, `${checked} states checked`);
  for (const phase of ['setupSettlement', 'setupRoad', 'roll', 'actions', 'robber', 'discard'])
    assert.ok(phases.has(phase), `the simulations reached ${phase}`);
  assert.ok(discardWithResignedActive, 'the simulations covered discards owed after the active player left');
});

test('a lone survivor who may not win yet is a legal saved state, not a false alarm', () => {
  const random = seededRandom('lone');
  const game = createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    3,
    random,
  );
  // Leaving during setup while the survivor is offline: no winner yet, play resumes at a roll.
  const lone = resignPlayers(game, ['b'], { reason: 'leave', winnerEligibleIds: [] });
  assert.equal(lone.phase, 'roll');
  assert.equal(lone.turn, 0);
  assert.deepEqual(gameInvariantProblems(lone), []);
  assert.deepEqual(continueGame(lone, 'lone'), { move: 'roll', problems: [] });
});

async function midGame() {
  const { states } = await simulate(21, 3, 400);
  const state = states.find(
    (s) => s.phase === 'actions' && s.turn >= 8 && Object.keys(s.buildings).length >= 7,
  );
  assert.ok(state, 'the simulation reached a developed mid-game state');
  return state;
}

test('each rules invariant catches the corruption it exists for', async () => {
  const base = await midGame();
  assert.deepEqual(gameInvariantProblems(base), []);
  const [first, second] = base.players.map((p) => p.id) as [string, string];
  const freeVertex = (g: Game) =>
    g.board.vertices.find((v) => !g.buildings[v.id] && v.neighbors.every((n) => !g.buildings[n]))!.id;
  const buy = (g: Game, owner: number, id = `card-${g.nextCard}`) => {
    g.players[owner]!.cards.push({ id, kind: g.deck.pop()!, boughtTurn: g.turn });
    g.nextCard++;
  };
  const cases: [string, (g: Game) => void, RegExp][] = [
    ['a created resource', (g) => g.bank.wood++, /wood: bank \d+ \+ hands \d+ = 20, expected 19/],
    [
      'a negative hand',
      (g) => (g.players[0]!.hand.ore = -1),
      /ore: the bank or a hand holds an invalid count/,
    ],
    [
      'a card missing from the deck',
      (g) => g.deck.pop(),
      /development cards: \d+ in the deck \+ \d+ bought = 24, expected 25/,
    ],
    [
      'one card held twice',
      (g) => {
        buy(g, 0);
        g.players[1]!.cards.push({ ...g.players[0]!.cards.at(-1)! });
      },
      /is held twice/,
    ],
    [
      'a card never bought',
      (g) => g.players[0]!.cards.push({ id: 'card-99', kind: 'monopoly', boughtTurn: 1 }),
      /card-99 was never bought/,
    ],
    [
      'a card bought in the future',
      (g) => (buy(g, 0), (g.players[0]!.cards.at(-1)!.boughtTurn = g.turn + 1)),
      /invalid purchase turn/,
    ],
    [
      'fifteen knights',
      (g) => (g.players[0]!.knights = 15),
      /knight cards: \d+ accounted for, but only 14 exist/,
    ],
    [
      'a resigned player keeping cards',
      (g) => {
        g.players[1]!.resigned = true;
        g.players[1]!.hand.wood++;
        g.bank.wood--;
      },
      /a resigned player still holds cards/,
    ],
    [
      'sixteen roads',
      (g) => {
        let placed = Object.values(g.roads).filter((owner) => owner === first).length;
        for (const edge of g.board.edges)
          if (placed < 16 && !g.roads[edge.id]) ((g.roads[edge.id] = first), placed++);
      },
      /a player has 16 roads; the supply is 15/,
    ],
    [
      'six settlements',
      (g) => {
        for (const b of Object.values(g.buildings)) if (b.player === first) b.kind = 'settlement';
        while (Object.values(g.buildings).filter((b) => b.player === first).length < 6)
          g.buildings[freeVertex(g)] = { player: first, kind: 'settlement' };
      },
      /a player has 6 settlements; the supply is 5/,
    ],
    [
      'five cities',
      (g) => {
        while (Object.values(g.buildings).filter((b) => b.player === first).length < 5)
          g.buildings[freeVertex(g)] = { player: first, kind: 'city' };
        for (const b of Object.values(g.buildings)) if (b.player === first) b.kind = 'city';
      },
      /a player has 5 cities; the supply is 4/,
    ],
    [
      'a stranger building',
      (g) => (g.buildings[freeVertex(g)] = { player: 'stranger', kind: 'settlement' }),
      /belongs to no player/,
    ],
    [
      'a stranger road',
      (g) => (g.roads[g.board.edges.find((e) => !g.roads[e.id])!.id] = 'stranger'),
      /the road on edge \d+ belongs to no player/,
    ],
    [
      'adjacent buildings',
      (g) => {
        const [vertex] = Object.keys(g.buildings).map(Number);
        const neighbor = g.board.vertices[vertex!]!.neighbors.find((n) => !g.buildings[n])!;
        g.buildings[neighbor] = { player: second, kind: 'settlement' };
      },
      /break the distance rule/,
    ],
    ['a lost robber', (g) => (g.robber = 99), /the robber stands on missing tile 99/],
    ['an unknown phase', (g) => ((g as { phase: string }).phase = 'bogus'), /unknown phase bogus/],
    [
      'an active seat beyond the table',
      (g) => (g.active = 7),
      /the active seat 7 is not one of the 3 players/,
    ],
    [
      'a resigned player to roll',
      (g) => {
        g.phase = 'roll';
        g.players[g.active]!.resigned = true;
      },
      /the active player has resigned during roll/,
    ],
    ['an early winner', (g) => (g.winner = first), /a game in progress already has a winner/],
    ['a winnerless finish', (g) => ((g.phase = 'finished'), (g.winner = null)), /must have been abandoned/],
    [
      'a resigned winner',
      (g) => ((g.phase = 'finished'), (g.winner = second), (g.players[1]!.resigned = true)),
      /the recorded winner is not a remaining player/,
    ],
    [
      'an impossible discard',
      (g) => ((g.phase = 'discard'), (g.discards = { [first]: 50 })),
      /a discard of 50 is owed from a hand of \d+/,
    ],
    [
      'a discard nobody owes',
      (g) => ((g.phase = 'discard'), (g.discards = {})),
      /the discard phase has nobody left to discard/,
    ],
    ['a stray discard', (g) => (g.discards = { [first]: 1 }), /discards are pending during actions/],
    [
      'a stale free-road phase',
      (g) => ((g.phase = 'freeRoads'), (g.freeRoads = 0)),
      /the free-road phase has no free road left/,
    ],
    [
      'an out-of-turn trade',
      (g) => {
        g.phase = 'roll';
        g.trade = { id: 1, player: g.players[g.active]!.id, give: { ...g.bank }, want: { ...g.bank } };
      },
      /an open trade is not the active player's/,
    ],
    [
      'a setup road without its settlement',
      (g) => ((g.phase = 'setupRoad'), (g.turn = 0), (g.setupVertex = null)),
      /setup road is due/,
    ],
    [
      'setup after the first turn',
      (g) => (g.phase = 'setupSettlement'),
      /setup is still running on turn \d+/,
    ],
    ['a malformed save', (g) => ((g as { board: unknown }).board = null), /the saved game is malformed/],
  ];
  for (const [name, corrupt, expected] of cases) {
    const game = structuredClone(base);
    corrupt(game);
    const problems = gameInvariantProblems(game);
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      `${name}: ${JSON.stringify(problems)}`,
    );
  }
});

test('continuation forces a legal move or explains why the game is stuck', async () => {
  const base = await midGame();
  assert.deepEqual(continueGame(base, 'x'), { move: 'endTurn', problems: [] });
  assert.deepEqual(continueGame({ ...structuredClone(base), phase: 'finished' }, 'x'), {
    move: null,
    problems: [],
  });
  const stuck = structuredClone(base);
  stuck.phase = 'discard';
  const debtor = stuck.players.find((p) => Object.values(p.hand).some(Boolean))!;
  stuck.discards = { [debtor.id]: 30 };
  assert.match(
    continueGame(stuck, 'x').problems[0]!,
    /the mandatory move could not be chosen: Cannot resolve an invalid discard inventory/,
  );
  // The move is tried on a clone: the saved game itself is never changed.
  const before = JSON.stringify(base);
  continueGame(base, 'x');
  assert.equal(JSON.stringify(base), before);
});

async function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-verify-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'restored.sqlite');
  const { store, rooms } = await buildPlayedDatabase(path);
  store.close();
  makeStandalone(path);
  const variant = (name: string, sql: string, ...values: string[]) => {
    const copy = join(directory, `${name}.sqlite`);
    copyFileSync(path, copy);
    const db = new DatabaseSync(copy);
    db.prepare(sql).run(...values);
    db.close();
    return copy;
  };
  return { directory, path, rooms, variant };
}
const options = { requireJournalCheck: hasJournalCheck };

test('a restored database of played games verifies through a private copy that leaves the snapshot untouched', async (t) => {
  const { directory, path, rooms } = await fixture(t);
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  const { report } = verifyRestoredDatabase(path, { ...options, workDirectory: directory });
  assert.equal(report.result, 'pass', JSON.stringify(report.failures));
  assert.deepEqual(
    { rooms: report.rooms, games: report.games, verified: report.verified, withoutGame: report.withoutGame },
    { rooms: 6, games: 5, verified: 5, withoutGame: 1 },
  );
  const { actions, setupRoad, finished, robber = 0, discard = 0, ...other } = report.phases;
  assert.deepEqual(
    { actions, setupRoad, finished, sevenRolled: robber + discard, other },
    { actions: 2, setupRoad: 1, finished: 1, sevenRolled: 1, other: {} },
  );
  const byRoom = new Map(report.details.map((room) => [room.roomId, room]));
  assert.equal(byRoom.get(rooms.inProgress)!.continuedWith, 'endTurn');
  assert.equal(byRoom.get(rooms.setup)!.continuedWith, 'road');
  assert.equal(byRoom.get(rooms.finished)!.continuedWith, null);
  assert.equal(byRoom.get(rooms.lobby)!.status, 'no-game');
  // History covers only the rematch's second round, back to its own start.
  assert.ok(byRoom.get(rooms.rematch)!.historyEntries! < byRoom.get(rooms.rematch)!.revision!);
  assert.equal(report.journalChain, hasJournalCheck ? 'verified' : 'unavailable');
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), digest);
  // The private copy and its WAL lived in a temporary folder that is gone again.
  assert.deepEqual(readdirSync(directory), ['restored.sqlite']);
});

test('saved-state, journal-head and mid-journal corruption each fail loudly with the room id', async (t) => {
  const { rooms, variant } = await fixture(t);
  const cases = [
    {
      room: rooms.inProgress,
      path: variant(
        'game-row',
        "UPDATE games SET state = json_set(state, '$.bank.wood', json_extract(state, '$.bank.wood') + 1) WHERE room_id = ?",
        rooms.inProgress,
      ),
      expected: /loadGame: STATE_INTEGRITY/,
    },
    {
      room: rooms.robber,
      path: variant(
        'journal-head',
        'DELETE FROM game_events WHERE room_id = ?1 AND revision = (SELECT max(revision) FROM game_events WHERE room_id = ?1)',
        rooms.robber,
      ),
      expected: /STATE_INTEGRITY|newest journal entry/,
    },
    {
      room: rooms.finished,
      path: variant(
        'journal-middle',
        'DELETE FROM game_events WHERE room_id = ?1 AND revision = (SELECT min(revision) + 3 FROM game_events WHERE room_id = ?1)',
        rooms.finished,
      ),
      expected: /journal entries are missing|not linked/,
    },
  ];
  for (const { room, path, expected } of cases) {
    const { report } = verifyRestoredDatabase(path, options);
    assert.equal(report.result, 'fail');
    assert.deepEqual(
      report.failures.map((failure) => failure.roomId),
      [room],
    );
    assert.ok(
      report.failures[0]!.problems.some((problem) => expected.test(problem)),
      JSON.stringify(report.failures),
    );
  }
});

test('the journal hash-chain check is mandatory unless explicitly waived, and its problems fail the room', async (t) => {
  const { directory, path, rooms } = await fixture(t);
  const copy = join(directory, 'store.sqlite');
  copyFileSync(path, copy);
  const store = new Store(copy);
  t.after(() => store.close());
  // Absent (as in releases before the compact journal): every game room fails unless waived.
  Object.defineProperty(store, 'verifyJournal', { value: undefined, configurable: true });
  const absent = verifyStore(store);
  assert.equal(absent.failed, 5);
  assert.ok(absent.failures.every((failure) => failure.problems.some((problem) => MISSING.test(problem))));
  assert.equal(verifyStore(store, { requireJournalCheck: false }).result, 'pass');
  // Present: whatever it reports fails the room it belongs to.
  Object.defineProperty(store, 'verifyJournal', {
    value: (roomId: string) => ({
      events: 3,
      problems: roomId === rooms.setup ? ['revision 5: saved state does not match its hash'] : [],
    }),
  });
  const present = verifyStore(store);
  assert.equal(present.journalChain, 'verified');
  assert.deepEqual(present.failures, [
    { roomId: rooms.setup, problems: ['journal: revision 5: saved state does not match its hash'] },
  ]);
});

test('the verifier refuses anything that could be a live database', async (t) => {
  const { directory, path } = await fixture(t);
  const live = join(directory, 'live.sqlite');
  const store = new Store(live);
  store.enter('create', 'a'.repeat(64), 'Host');
  assert.throws(
    () => verifyRestoredDatabase(live),
    (error) => error instanceof UnusableInput && /-wal exists/.test(error.message),
  );
  store.close();
  // Closed but still in WAL mode, as the game leaves its database.
  assert.throws(() => verifyRestoredDatabase(live), /WAL mode like a live game database/);
  const text = join(directory, 'notes.sqlite');
  writeFileSync(text, 'x'.repeat(200));
  assert.throws(() => verifyRestoredDatabase(text), /not a SQLite database/);
  assert.throws(() => verifyRestoredDatabase(join(directory, 'absent.sqlite')), /cannot be read/);
  assert.equal(verifyRestoredDatabase(path, options).report.result, 'pass');
});

test('the command line reports each room, writes a private JSON report and exits by result', async (t) => {
  const { directory, path, rooms, variant } = await fixture(t);
  const output: string[] = [];
  t.mock.method(console, 'log', (line: string) => output.push(line));
  t.mock.method(console, 'error', (line: string) => output.push(line));
  const waiver = hasJournalCheck ? [] : ['--allow-missing-journal-check'];
  const report = join(directory, 'report.json');
  assert.equal(main([path, '--report', report, ...waiver]), 0);
  assert.match(output.join('\n'), new RegExp(`PASS ${rooms.inProgress}  3 players`));
  assert.match(output.join('\n'), /RESULT: PASS - 5 games in 6 rooms verified/);
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).result, 'pass');
  assert.equal(statSync(report).mode & 0o777, 0o600);
  output.length = 0;
  const broken = variant(
    'cli',
    "UPDATE games SET state = json_set(state, '$.robber', 0) WHERE room_id = ?",
    rooms.setup,
  );
  assert.equal(main([broken, ...waiver]), 1);
  assert.match(output.join('\n'), new RegExp(`FAIL ${rooms.setup}`));
  assert.match(output.join('\n'), new RegExp(`RESULT: FAIL - 1 of 6 rooms failed: ${rooms.setup}`));
  assert.equal(main([]), 2);
  assert.equal(main([path, '--bogus']), 2);
  assert.equal(main([join(directory, 'absent.sqlite')]), 2);
  if (!hasJournalCheck)
    assert.equal(main([path]), 1, 'without the waiver a release lacking verifyJournal fails');
});
