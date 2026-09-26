import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createGame, gameView, resignPlayers } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { owedBy, owedMoves } from '../packages/rules/src/owed.js';
import { timeoutAction, timeoutDescription } from '../packages/rules/src/timeout.js';
import { pips, seededRandom } from '../packages/rules/src/board.js';
import { requiredAction } from '../apps/client/src/game-attention.js';
import { BIG_TABLE, OPEN_SEA } from '../packages/rules/src/rulesets.js';
import { scriptedMove } from './open-sea-play.js';

const seats = ['Alice', 'Bob', 'Cara'].map((name, i) => ({ id: `p${i}`, name }));
const production = (game: Game, vertex: number) =>
  game.board.vertices[vertex]!.hexes.reduce((n, hex) => n + pips(game.board.hexes[hex]!.number), 0);

test('the game owes one move to the player on turn, in every Classic phase but discards', () => {
  const game = createGame(seats, 481, () => 0.34);
  assert.deepEqual(owedMoves(game), [{ player: 'p0', kind: 'setupSettlement' }]);
  for (const phase of ['setupRoad', 'roll', 'actions', 'robber', 'freeRoads'] as const)
    assert.deepEqual(owedMoves({ ...game, phase, active: 1 }), [{ player: 'p1', kind: phase }]);
  assert.deepEqual(owedMoves({ ...game, phase: 'finished' }), []);
  assert.equal(owedBy(game, 'p0')?.kind, 'setupSettlement');
  assert.equal(owedBy(game, 'p1'), undefined);
});

test('after a seven each player who must discard is owed a discard, together, and the roller waits', () => {
  const game = createGame(seats, 481, () => 0.34);
  const discarding = { ...game, phase: 'discard' as const, active: 0, discards: { p2: 4, p1: 5 } };
  assert.deepEqual(owedMoves(discarding), [
    { player: 'p2', kind: 'discard' },
    { player: 'p1', kind: 'discard' },
  ]);
  assert.equal(owedBy(discarding, 'p0'), undefined);
  // The roller resigning does not end anyone else's discard; nobody is owed a move for a resigned seat.
  const players = game.players.map((p) => (p.id === 'p0' || p.id === 'p1' ? { ...p, resigned: true } : p));
  assert.deepEqual(owedMoves({ ...discarding, players }), [{ player: 'p2', kind: 'discard' }]);
  assert.deepEqual(owedMoves({ ...game, phase: 'roll', players }), []);
});

test('a player’s view says whose move it is the same way, so the client’s “your move” agrees', () => {
  let game = createGame(seats, 481, () => 0.34);
  assert.equal(requiredAction(gameView(game, 'p0'), 'p0'), 'setupSettlement');
  assert.equal(requiredAction(gameView(game, 'p1'), 'p1'), null);
  assert.deepEqual(owedMoves(gameView(game, 'p1')), owedMoves(game));
  game = { ...game, phase: 'discard', discards: { p1: 4 } };
  assert.equal(requiredAction(gameView(game, 'p1'), 'p1'), 'discard');
  assert.equal(requiredAction(gameView(game, 'p0'), 'p0'), null);
  // The open-ended actions of a turn are owed, but are not a move the attention cue asks for.
  assert.equal(requiredAction(gameView({ ...game, phase: 'actions', discards: {} }, 'p0'), 'p0'), null);
});

test('the clock places for an absent player in setup: the richest corner, ties at random, then a road by it', () => {
  const game = createGame(seats, 481, () => 0.34);
  const sites = gameView(game, 'p0').legal.settlements;
  const most = Math.max(...sites.map((v) => production(game, v)));
  const tied = sites.filter((v) => production(game, v) === most);
  const chosen = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) {
    const action = timeoutAction(game, 'p0', seededRandom(seed));
    assert.equal(action?.kind, 'settlement');
    if (action?.kind !== 'settlement') continue;
    assert.equal(production(game, action.vertex), most);
    chosen.add(action.vertex);
  }
  // Every tied corner can be chosen, and nothing else is.
  assert.deepEqual([...chosen].sort(), [...tied].sort());
  const placed = applyAction(
    game,
    'p0',
    timeoutAction(game, 'p0', () => 0.5)!,
    () => 0.5,
  );
  assert.equal(placed.phase, 'setupRoad');
  const road = timeoutAction(placed, 'p0', () => 0.99);
  assert.equal(road?.kind, 'road');
  if (road?.kind === 'road') {
    const edge = placed.board.edges[road.edge]!;
    assert.ok(edge.a === placed.setupVertex || edge.b === placed.setupVertex);
  }
  assert.equal(timeoutDescription(road!, placed.phase), 'starting road placed automatically');
  assert.equal(timeoutDescription(road!, 'freeRoads'), 'remaining free road placed automatically');
  assert.equal(
    timeoutDescription({ kind: 'settlement', vertex: 0 }, 'setupSettlement'),
    'starting settlement placed automatically',
  );
  // Nobody but the player placing is owed a placement.
  assert.equal(
    timeoutAction(game, 'p1', () => 0.5),
    undefined,
  );
});

test('every move the game can owe has a timeout move the rules accept, through a whole game', () => {
  const random = seededRandom(2026);
  let game = createGame(seats, 2026, random);
  const kinds = new Set<string>();
  for (let step = 0; step < 4000 && game.phase !== 'finished'; step++) {
    const owed = owedMoves(game);
    assert.ok(owed.length, `the game waits on nobody during ${game.phase}`);
    for (const move of owed) {
      kinds.add(move.kind);
      const action = timeoutAction(game, move.player, random);
      assert.ok(action, `no timeout move for ${move.kind}`);
      assert.doesNotThrow(
        () => applyAction(game, move.player, action, random),
        `${move.kind}: ${action.kind}`,
      );
    }
    // Play on with the clock's moves, occasionally building so the game ends.
    const [first] = owed;
    const legal = gameView(game, first!.player).legal;
    const action =
      first!.kind === 'actions' && legal.settlements.length
        ? { kind: 'settlement' as const, vertex: legal.settlements[0]! }
        : first!.kind === 'actions' && legal.cities.length
          ? { kind: 'city' as const, vertex: legal.cities[0]! }
          : first!.kind === 'actions' && legal.roads.length && step % 3 === 0
            ? { kind: 'road' as const, edge: legal.roads[0]! }
            : timeoutAction(game, first!.player, random)!;
    game = applyAction(game, first!.player, action, random);
  }
  for (const kind of ['setupSettlement', 'setupRoad', 'roll', 'actions', 'robber', 'discard'])
    assert.ok(kinds.has(kind), `the game never owed ${kind}`);
});

test('a resigned player owes nothing, and the next player owes the robber they left behind', () => {
  let game = createGame(seats, 481, () => 0.34);
  game = { ...game, phase: 'robber', turn: 3, active: 0 };
  const resigned = resignPlayers(game, ['p0']);
  assert.deepEqual(owedMoves(resigned), [{ player: 'p1', kind: 'robber' }]);
  assert.equal(
    timeoutAction(resigned, 'p0', () => 0.5),
    undefined,
  );
  assert.equal(timeoutAction(resigned, 'p1', () => 0.5)?.kind, 'robber');
});

test('Big Table: the Partner and each build window are owed by the player acting, and the clock can finish both', () => {
  for (const turns of ['paired', 'betweenTurnsBuild'] as const)
    for (const n of [5, 6]) {
      const random = seededRandom(n * 13 + turns.length);
      const players = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay']
        .slice(0, n)
        .map((name, i) => ({ id: `p${i}`, name }));
      let game = createGame(players, 2026 + n, random, { ruleset: BIG_TABLE.id, turns, victoryPoints: 8 });
      const kinds = new Set<string>();
      for (let step = 0; step < 8000 && game.phase !== 'finished'; step++) {
        const owed = owedMoves(game);
        assert.ok(owed.length, `the game waits on nobody during ${game.phase}`);
        for (const move of owed) {
          kinds.add(move.kind);
          // Only the player acting is owed: the Lead during the Partner's phase, and every player not in the
          // window, wait.
          if (move.kind === 'partner' || move.kind === 'buildWindow')
            assert.deepEqual(owed, [{ player: game.players[game.active]!.id, kind: move.kind }]);
          const action = timeoutAction(game, move.player, random);
          assert.ok(action, `no timeout move for ${move.kind}`);
          assert.doesNotThrow(
            () => applyAction(game, move.player, action, random),
            `${move.kind}: ${action.kind}`,
          );
        }
        const [first] = owed;
        const legal = gameView(game, first!.player).legal;
        const building = ['actions', 'partner', 'buildWindow'].includes(first!.kind);
        const action =
          building && legal.settlements.length
            ? { kind: 'settlement' as const, vertex: legal.settlements[0]! }
            : building && legal.cities.length
              ? { kind: 'city' as const, vertex: legal.cities[0]! }
              : building && legal.canBuyCard
                ? { kind: 'buyCard' as const }
                : building && legal.roads.length && step % 3 === 0
                  ? { kind: 'road' as const, edge: legal.roads[0]! }
                  : timeoutAction(game, first!.player, random)!;
        game = applyAction(game, first!.player, action, random);
      }
      assert.equal(game.phase, 'finished', `${turns}, ${n} players`);
      const own = turns === 'paired' ? 'partner' : 'buildWindow';
      for (const kind of ['setupSettlement', 'setupRoad', 'roll', 'actions', 'robber', own])
        assert.ok(kinds.has(kind), `${turns}, ${n} players: the game never owed ${kind}`);
    }
});

test('Open Sea owes gold picks to the player picking now only, and the clock can make every move it owes', () => {
  // A whole Open Sea game by the scripted players, who sail for the small islands and their gold: at every step,
  // every move the game owes has a timeout move the rules accept.
  const random = seededRandom(2 * 7919 + 3);
  let game = createGame(seats, 2, random, { ruleset: OPEN_SEA.id });
  const kinds = new Set<string>();
  for (let step = 0, turn = 0, actions = 0; step < 3000 && game.phase !== 'finished'; step++) {
    const owed = owedMoves(game);
    assert.ok(owed.length, `the game waits on nobody during ${game.phase}`);
    if (game.phase === 'goldPick') {
      assert.equal(owed.length, 1, 'gold picks are owed one player at a time');
      assert.equal(owed[0]!.player, game.goldOwed![0]!.player);
    }
    for (const move of owed) {
      kinds.add(move.kind);
      const action = timeoutAction(game, move.player, random);
      assert.ok(action, `no timeout move for ${move.kind}`);
      assert.doesNotThrow(
        () => applyAction(game, move.player, action, random),
        `${move.kind}: ${action.kind}`,
      );
    }
    if (game.turn !== turn) [turn, actions] = [game.turn, 0];
    const next = scriptedMove(game, random)!;
    const action = game.phase === 'actions' && ++actions > 14 ? { kind: 'endTurn' as const } : next.action;
    game = applyAction(game, next.player, action, random);
  }
  assert.equal(game.phase, 'finished');
  for (const kind of ['setupSettlement', 'setupRoad', 'roll', 'actions', 'robber', 'discard', 'goldPick'])
    assert.ok(kinds.has(kind), `the game never owed ${kind}`);
});
