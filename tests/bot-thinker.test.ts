import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, gameView } from '../packages/rules/src/game.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { initialPlan, newMind } from '../packages/bot/src/index.js';
import { learn } from '../packages/bot/src/brain/belief.js';
import { mergeMind, workerThinker } from '../apps/server/src/bot-thinker.js';

test('a bot thinks in a worker thread without holding the main thread, and answers legally', async () => {
  const thinker = workerThinker();
  try {
    const game = createGame(
      ['a', 'b', 'c'].map((id) => ({ id, name: id })),
      3,
      seededRandom(3),
    );
    let ticks = 0;
    const clock = setInterval(() => ticks++, 5);
    const decision = await thinker.decide({
      view: gameView(game, 'a'),
      board: game.board,
      meId: 'a',
      plan: initialPlan(0),
      jev: null,
      level: 'champ',
      mind: newMind(),
    });
    clearInterval(clock);
    assert.equal(decision.action.kind, 'settlement');
    assert.ok(gameView(game, 'a').legal.settlements.includes((decision.action as { vertex: number }).vertex));
    assert.ok(decision.mind, 'its memory comes back');
    assert.ok(ticks > 0, 'the main thread kept running while it thought');
  } finally {
    thinker.close();
  }
});

test('memory from a decision made elsewhere never overwrites the card counting kept on the main thread', () => {
  const current = newMind();
  learn(current.belief, { kind: 'change', player: 'b', delta: { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 } }, () => ({
    count: 0,
    income: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
  }));
  const decided = newMind();
  decided.strategy = 'cities';
  decided.strategyTurn = 9;
  decided.trading = { made: 3, filled: 0 };
  const merged = mergeMind(current, decided);
  assert.equal(merged.strategy, 'cities');
  assert.equal(merged.trading.made, 3);
  assert.equal(merged.belief, current.belief, 'the counting stays the main thread’s');
});
