import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCES } from '../packages/rules/src/index.js';
import { createGame, gameView, score, scoreTerms } from '../packages/rules/src/game.js';

const seats = ['Alice', 'Bob', 'Cara'].map((name, i) => ({ id: `p${i}`, name }));
function playing() {
  const game = createGame(seats, 481, () => 0.34);
  game.phase = 'actions';
  game.turn = 1;
  game.players[0]!.hand = { wood: 9, brick: 9, sheep: 9, wheat: 9, ore: 9 };
  for (const r of RESOURCES) game.bank[r] -= 9;
  return game;
}

test('score is the sum of named terms, in the order results list them, with hidden cards kept hidden', () => {
  const game = playing();
  game.buildings[0] = { player: 'p0', kind: 'settlement' };
  game.buildings[8] = { player: 'p0', kind: 'settlement' };
  game.buildings[13] = { player: 'p0', kind: 'city' };
  game.longestRoad = 'p0';
  game.largestArmy = 'p1';
  game.players[0]!.cards = [
    { id: 'vp1', kind: 'victoryPoint', boughtTurn: 0 },
    { id: 'vp2', kind: 'victoryPoint', boughtTurn: 0 },
    { id: 'k', kind: 'knight', boughtTurn: 0 },
  ];
  const me = game.players[0]!;
  assert.deepEqual(scoreTerms(game, me), [
    { id: 'settlements', points: 2, count: 2 },
    { id: 'cities', points: 2, count: 1 },
    { id: 'longestRoad', points: 2, count: 1 },
    { id: 'cards', points: 2, count: 2 },
  ]);
  assert.equal(score(game, me), 8);
  assert.equal(score(game, me, false), 6);
  assert.deepEqual(
    scoreTerms(game, me, false).map((term) => term.id),
    ['settlements', 'cities', 'longestRoad'],
  );
  assert.deepEqual(scoreTerms(game, game.players[1]!), [{ id: 'largestArmy', points: 2, count: 1 }]);
  assert.deepEqual(scoreTerms(game, game.players[2]!), []);
  // The view sends each player the terms they may see: their own cards, nobody else's until someone wins.
  const mine = gameView(game, 'p0').players[0]!,
    theirs = gameView(game, 'p1').players[0]!;
  assert.equal(mine.points, 8);
  assert.equal(
    mine.terms.reduce((n, term) => n + term.points, 0),
    8,
  );
  assert.equal(theirs.points, 6);
  assert.ok(!theirs.terms.some((term) => term.id === 'cards'));
  for (const player of gameView(game, 'p2').players)
    assert.equal(
      player.terms.reduce((n, term) => n + term.points, 0),
      player.points,
    );
});
