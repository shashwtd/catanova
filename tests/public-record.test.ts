import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createGame, emptyHand } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';

const seats = [
  { id: 'a', name: 'Ann' },
  { id: 'b', name: 'Ben' },
];
const lines = (before: Game, after: Game) =>
  after.log.filter((e) => e.id >= before.nextLog).map((e) => e.text);

test('the public record names discarded cards and what Year of Plenty took from the bank', () => {
  const game = createGame(seats, 7, () => 0.5);
  // A mid-game position: Ann to discard four, then later to play Year of Plenty.
  game.phase = 'discard';
  game.turn = 5;
  game.discards = { a: 4 };
  game.players[0]!.hand = { ...emptyHand(), wood: 3, wheat: 3, ore: 2 };
  game.bank = { wood: 16, brick: 19, sheep: 19, wheat: 16, ore: 17 };
  const discarded = applyAction(
    game,
    'a',
    { kind: 'discard', resources: { ...emptyHand(), wood: 2, wheat: 2 } },
    () => 0,
  );
  assert.deepEqual(lines(game, discarded), ['Ann discarded 2 Timber, 2 Hay.']);

  const ready = structuredClone(discarded);
  ready.phase = 'actions';
  ready.players[0]!.cards = [{ id: 'yop', kind: 'yearOfPlenty', boughtTurn: 1 }];
  const played = applyAction(
    ready,
    'a',
    { kind: 'playCard', cardId: 'yop', resources: { ...emptyHand(), brick: 1, sheep: 1 } },
    () => 0,
  );
  assert.deepEqual(lines(ready, played), [
    'Ann took 1 Clay, 1 Sheep from the bank with Year of Plenty.',
    'Ann played Year of Plenty.',
  ]);
});
