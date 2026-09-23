import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, gameView } from '../packages/rules/src/game.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { createJevClient, decide, initialPlan, JevUnavailable, choice } from '../packages/bot/src/index.js';

/** A client pointed at a local stub, so nothing here ever leaves the machine. */
const stubClient = (reply: unknown, extra: Parameters<typeof createJevClient>[0] = {}) =>
  createJevClient({
    route: { url: 'https://stub.invalid', model: 'stub', key: 'stub' },
    fetchImpl: (async () => new Response(JSON.stringify(reply), { status: 200 })) as typeof fetch,
    ...extra,
  })!;

test('a malformed reply from the decision service counts as the service being unavailable', async () => {
  const question = { move: choice('Which?', { a: 1, b: 2 }) };
  for (const reply of [
    { answers: { move: null } },
    { answers: null },
    { answers: { move: { type: 'choice' } } },
    { answers: { move: { type: 'choice', choice: null, probabilities: null } } },
    { answers: { move: { type: 'score', score: 'high' } } },
    { answers: { move: { type: 'noul', noul: null } } },
    { answers: { move: 'a' } },
    null,
  ])
    await assert.rejects(
      stubClient(reply).evaluate({}, question),
      JevUnavailable,
      `reply ${JSON.stringify(reply)} is no answer`,
    );

  // A well-formed reply still reads as it always has.
  const good = await stubClient({
    answers: { move: { type: 'choice', choice: 'b', probabilities: { a: 0.3, b: 0.7 } } },
  }).evaluate({}, question);
  assert.equal((good.answers.move as { choice: string }).choice, 'b');

  // And a bot handed a null answer plays on from its own judgement instead of
  // throwing, which is what used to leave its seat stuck.
  const game = createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    4,
    seededRandom(4),
  );
  const decision = await decide({
    view: gameView(game, 'a'),
    board: game.board,
    meId: 'a',
    plan: initialPlan(0),
    jev: stubClient({ answers: { site: null, plan_strategy: null, plan_focus: null } }),
  });
  assert.equal(decision.action.kind, 'settlement');
  assert.equal(decision.degraded, true);
});
