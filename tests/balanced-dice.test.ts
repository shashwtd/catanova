import test from 'node:test';
import assert from 'node:assert/strict';
import { balancedRoll, rollDice, type BalancedDiceState } from '../packages/rules/src/dice.js';
import { createGame, applyAction, gameView } from '../packages/rules/src/game.js';
import { parseRoomSettings } from '../packages/protocol/src/settings.js';

function rng(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
test('balanced deck draws unique pairs until its early refresh, and never emits invalid dice', () => {
  const state: BalancedDiceState = { remaining: [] };
  const random = rng(4),
    seen = new Set<string>();
  for (let i = 0; i < 24; i++) {
    const pair = balancedRoll(random, state);
    assert.ok(pair.every((n) => Number.isInteger(n) && n >= 1 && n <= 6));
    assert.ok(!seen.has(pair.join(',')));
    seen.add(pair.join(','));
  }
  assert.equal(state.remaining.length, 12);
  balancedRoll(random, state);
  assert.equal(state.remaining.length, 35);
});
test('balanced rolls persist in the game and the private deck never appears in player projections', () => {
  const game = createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    12,
    rng(4),
    { diceMode: 'balanced' },
  );
  game.phase = 'roll';
  game.turn = 1;
  const rolled = applyAction(game, 'a', { kind: 'roll' }, rng(8));
  assert.equal(game.balancedDice, undefined, 'input state stays unchanged');
  assert.equal(rolled.balancedDice?.remaining.length, 35);
  for (const id of ['a', 'b']) assert.equal('balancedDice' in gameView(rolled, id), false);
  const restored = JSON.parse(JSON.stringify(rolled));
  rolled.phase = restored.phase = 'roll';
  assert.deepEqual(
    applyAction(rolled, 'a', { kind: 'roll' }, rng(40)),
    applyAction(restored, 'a', { kind: 'roll' }, rng(40)),
  );
});
test('balanced dice improve short-game distributions and repeats across reproducible simulations', () => {
  let naturalError = 0,
    balancedError = 0,
    naturalRepeats = 0,
    balancedRepeats = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const natural = rng(seed),
      balanced = rng(seed),
      state: BalancedDiceState = { remaining: [] };
    const counts = [Array(13).fill(0), Array(13).fill(0)],
      last = [0, 0];
    for (let roll = 0; roll < 72; roll++) {
      const pairs = [rollDice('classic', natural), balancedRoll(balanced, state)];
      pairs.forEach(([a, b], mode) => {
        const sum = a! + b!;
        counts[mode]![sum]++;
        if (sum === last[mode]) {
          if (mode === 0) naturalRepeats++;
          else balancedRepeats++;
        }
        last[mode] = sum;
      });
    }
    for (let total = 2; total <= 12; total++) {
      const expected = (6 - Math.abs(7 - total)) * 2;
      naturalError += (counts[0]![total] - expected) ** 2;
      balancedError += (counts[1]![total] - expected) ** 2;
    }
  }
  assert.ok(balancedError < naturalError * 0.75);
  assert.ok(balancedRepeats < naturalRepeats * 0.9);
});
test('new rooms reject flat odds; balanced cannot silently roll without durable state', () => {
  assert.throws(() => parseRoomSettings({ turnTimerSeconds: null, diceMode: 'flat' }), /Natural or Balanced/);
  assert.throws(() => rollDice('balanced', () => 0.5), /persisted/);
  for (const value of [NaN, Infinity, -1, 1])
    assert.throws(() => balancedRoll(() => value, { remaining: [] }), /randomness/);
});
