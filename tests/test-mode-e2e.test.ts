/**
 * The mode system end to end, with the test mode (docs/GAME-MODES.md, step 1: "Done when a hidden test mode can
 * be picked, started, played and replayed end to end"): a room picks it, starts, plays rounds through a seven
 * with discards and the robber, and its journal replays move by move, passes the restore verifier and reads in
 * the admin's game analytics, with every card accounted for on every row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import type { ModeSwitches } from '../apps/server/src/modes.js';
import { computeGameAnalytics } from '../apps/server/src/admin/game-analytics.js';
import { gameInvariantProblems, verifyStore } from '../scripts/verify-restored-games.js';
import { newSession } from '../apps/client/src/connection.js';
import { activePlayer, applyAction, emptyHand, gameView, score, total } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { owedMoves } from '../packages/rules/src/owed.js';
import { BIG_TABLE, CLASSIC } from '../packages/rules/src/rulesets.js';
import { TEST_DECK_SIZE, TEST_TABLE, useTestTable } from './test-ruleset.js';

useTestTable();
const OPEN: ModeSwitches = { open: [CLASSIC.id], testers: new Set(['tester']) };
const die = (face: number) => (face - 0.5) / 6;

/** Every card in the bank or a hand, and every development card in the deck or bought: the test mode's own counts. */
function accounted(game: Game) {
  for (const r of RESOURCES)
    assert.equal(game.bank[r] + game.players.reduce((n, p) => n + p.hand[r], 0), TEST_TABLE.supply.bank, r);
  assert.equal(game.deck.length + game.nextCard, TEST_DECK_SIZE);
}

/**
 * A random source that reproduces a recorded move: the dice the row shows, and for a steal the card that moved.
 * Nothing else in a move draws randomness, so anything else calling it is a mistake the replay should hear of.
 */
function oracle(before: Game, after: Game, action: GameAction, actor: string): () => number {
  const values: number[] = [];
  if (action.kind === 'roll') values.push(die(after.dice![0]), die(after.dice![1]));
  if (action.kind === 'robber' && action.victim) {
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

test('the test mode is picked, started, played through a seven, replayed, verified and analysed', () => {
  // Dice are the store's private randomness: a queue lets the test roll a seven when it wants one.
  const queue: number[] = [];
  const seeded = seededRandom(20260926);
  const store = new Store(':memory:', {
    modes: OPEN,
    trackPresence: true,
    random: () => (queue.length ? queue.shift()! : seeded()),
  });
  try {
    // A tester's room: only testers may pick a mode no host has been opened to. Five sit down, which Classic
    // cannot seat, so everything that counted seats has to read the mode's own limits.
    const sessions = ['Host', 'Second', 'Third', 'Fourth', 'Fifth'].map((name) => newSession(name));
    const host = store.enter('create', sessions[0]!.token, 'Host', undefined, {
      id: 'tester',
      name: 'Host',
      expiresAt: Date.now() + 3_600_000,
    });
    const roomId = host.room_id;
    const revision = () => store.snapshot(roomId).revision;
    // The host picks the mode alone: too few players never blocks a mode, and a Classic room seats four.
    assert.deepEqual(store.snapshot(roomId, host.id).modes, [CLASSIC.id, BIG_TABLE.id, TEST_TABLE.id]);
    store.configureSettings(host, 'pick-test-mode', revision(), {
      turnTimerSeconds: null,
      diceMode: 'classic',
      mode: TEST_TABLE.id,
    });
    const seats: Seat[] = [
      host,
      ...sessions.slice(1).map((s) => store.enter('join', s.token, s.name, roomId)),
    ];
    for (const seat of seats) store.setConnected(seat, true);
    for (const seat of seats.slice(1)) store.lobby(seat, `ready-${seat.id}`, revision(), true);
    store.action(host, 'start', revision(), { kind: 'start' });
    const game = () => store.loadGame(roomId)!;
    assert.equal(game().ruleset, TEST_TABLE.id);
    assert.equal(game().victoryPoints, 11);
    accounted(game());

    let step = 0;
    const seatOf = (id: string) => seats.find((seat) => seat.id === id)!;
    const move = (actor: string, action: GameAction) => {
      store.action(seatOf(actor), `move-${step++}`, revision(), action);
      accounted(game());
    };
    // Setup, snake order, on the first legal sites.
    while (game().turn === 0) {
      const actor = activePlayer(game()).id,
        legal = gameView(game(), actor).legal;
      move(
        actor,
        game().phase === 'setupSettlement'
          ? { kind: 'settlement', vertex: legal.settlements[0]! }
          : { kind: 'road', edge: legal.roads[0]! },
      );
    }
    /** Settle whatever the game waits for, the way a careful table would. */
    const settle = () => {
      for (let guard = 0; guard < 20; guard++) {
        const g = game(),
          [owed] = owedMoves(g);
        if (!owed || owed.kind === 'roll' || owed.kind === 'actions') return;
        if (owed.kind === 'discard') {
          const hand = { ...g.players.find((p) => p.id === owed.player)!.hand };
          let left = g.discards[owed.player]!;
          const resources = emptyHand();
          for (const r of RESOURCES) {
            resources[r] = Math.min(left, hand[r]);
            left -= resources[r];
          }
          move(owed.player, { kind: 'discard', resources });
        } else if (owed.kind === 'robber') {
          // A tile touching someone else, and steal from them.
          const hex = g.board.hexes.find(
            (h) =>
              h.id !== g.robber &&
              h.vertices.some((v) => g.buildings[v] && g.buildings[v]!.player !== owed.player),
          )!;
          const victim = hex.vertices
            .map((v) => g.buildings[v]?.player)
            .find((p) => p && p !== owed.player && total(g.players.find((q) => q.id === p)!.hand) > 0);
          move(owed.player, { kind: 'robber', hex: hex.id, ...(victim ? { victim } : {}) });
        } else throw new Error(`nothing settles ${owed.kind}`);
      }
    };
    // Rounds of rolling and saving up, until one hand is big enough for a seven to bite.
    let sevens = 0;
    for (let turn = 0; turn < 60 && sevens < 1; turn++) {
      const actor = activePlayer(game()).id;
      if (game().players.some((p) => total(p.hand) > 7)) {
        queue.push(die(3), die(4));
        sevens++;
      }
      move(actor, { kind: 'roll' });
      settle();
      move(actor, { kind: 'endTurn' });
    }
    assert.equal(sevens, 1, 'a hand grew past seven cards');
    const log = game().log.map((line) => line.text);
    assert.ok(log.some((text) => / rolled \d \+ \d = 7\./.test(text)));
    assert.ok(log.some((text) => / discarded /.test(text)));
    assert.ok(log.some((text) => / moved the robber/.test(text)));
    // A few more rounds that spend: roads, settlements and cards at the test mode's prices and supply.
    for (let turn = 0; turn < 15; turn++) {
      const actor = activePlayer(game()).id;
      move(actor, { kind: 'roll' });
      settle();
      for (let build = 0; build < 4; build++) {
        const legal = gameView(game(), actor).legal;
        const action: GameAction | undefined = legal.settlements.length
          ? { kind: 'settlement', vertex: legal.settlements[0]! }
          : legal.canBuyCard
            ? { kind: 'buyCard' }
            : legal.roads.length
              ? { kind: 'road', edge: legal.roads[0]! }
              : undefined;
        if (!action || game().phase !== 'actions') break;
        move(actor, action);
      }
      if (game().phase === 'actions') move(actor, { kind: 'endTurn' });
      if (game().phase === 'finished') break;
    }
    // At least four rounds of the five seats, one of them with the seven.
    assert.ok(game().turn >= 20, `several rounds were played (turn ${game().turn})`);

    // Replay the journal: every row reads back, satisfies the test mode's invariants, and follows from the one
    // before by its recorded action.
    const rows = store.db
      .prepare(
        'SELECT revision, actor, action, public_entry FROM game_events WHERE room_id = ? ORDER BY revision',
      )
      .all(roomId) as { revision: number; actor: string; action: string; public_entry: string }[];
    let previous: Game | undefined,
      replayed = 0;
    for (const row of rows) {
      const state = store.journalState(roomId, row.revision)!;
      assert.equal(state.ruleset, TEST_TABLE.id);
      assert.deepEqual(gameInvariantProblems(state), [], `revision ${row.revision}`);
      accounted(state);
      const kind = (JSON.parse(row.public_entry) as { kind: string }).kind;
      if (previous && kind !== 'start') {
        const action = JSON.parse(row.action) as GameAction;
        assert.deepEqual(
          applyAction(previous, row.actor, action, oracle(previous, state, action, row.actor)),
          state,
          `revision ${row.revision}: ${action.kind}`,
        );
        replayed++;
      }
      previous = state;
    }
    assert.equal(replayed, rows.length - 1);
    assert.deepEqual(store.verifyJournal(roomId).problems, []);

    // The restore verifier checks it against the test mode's own seats, bank, deck and pieces.
    const report = verifyStore(store);
    const room = report.details.find((detail) => detail.roomId === roomId)!;
    assert.equal(room.status, 'verified', room.problems.join('; '));
    assert.equal(room.ruleset, TEST_TABLE.id);
    assert.equal(room.players, 5);

    // The admin's game analytics reads it back, the seven and the robber included.
    const head = rows.at(-1)!.revision;
    const analytics = computeGameAnalytics(store.db, { roomId, archiveId: null, toRevision: head });
    assert.equal(analytics.players.length, 5);
    assert.equal(analytics.victoryPoints, 11);
    assert.ok(analytics.dice.sevens >= 1);
    assert.equal(analytics.dice.sevens, store.statistics(roomId).diceCounts[7 - 2]);
    assert.ok(analytics.robberMoves.some((robbery) => robbery.cause === 'seven'));
    assert.ok(analytics.players.some((player) => player.resources.spent.discarded > 0));
    const final = game();
    for (const [index, id] of final.players.map((p) => p.id).entries())
      assert.equal(
        analytics.points.byPlayer[analytics.players.findIndex((player) => player.id === id)]!.at(-1),
        score(final, final.players[index]!, !!final.winner),
      );
  } finally {
    store.close();
  }
});
