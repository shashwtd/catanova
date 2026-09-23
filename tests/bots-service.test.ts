import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import { seededRandom } from '../packages/rules/src/board.js';
import { createJevClient, decide, initialPlan, JevUnavailable, choice } from '../packages/bot/src/index.js';
import type { BotPlan, JevClient } from '../packages/bot/src/index.js';

/** A decision service that is down: every request fails, however it is asked. */
const down = (): JevClient & { requests: number } => ({
  model: 'down',
  requests: 0,
  async evaluate() {
    this.requests++;
    throw new JevUnavailable('simulated outage');
  },
});

/** Four bots play one seeded game to the end, or to turn 600, through the same
 *  decide-then-apply path the server uses. */
async function playOut(jev: JevClient | null, seed: number) {
  const random = seededRandom(seed);
  const seats = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
  let game = createGame(seats, seed, random, { diceMode: 'balanced' });
  const plans = new Map<string, BotPlan>();
  const moves: string[] = [];
  while (!game.winner && game.turn < 600) {
    const actor = game.phase === 'discard' ? Object.keys(game.discards)[0]! : game.players[game.active]!.id;
    const decision = await decide({
      view: gameView(game, actor),
      board: game.board,
      meId: actor,
      plan: plans.get(actor) ?? initialPlan(game.turn),
      jev,
    });
    plans.set(actor, decision.plan);
    moves.push(JSON.stringify(decision.action));
    game = applyAction(game, actor, decision.action, random);
  }
  return { game, moves };
}

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

test('a bot whose decision service is down plays exactly as a bot with no service', async () => {
  // The same seeded table twice: once with no key, once with a key and a
  // service that fails every request. The failing one used to fall back to a
  // move list of its own that never built a road, bought a card or traded, so
  // it stalled at about four points; it now makes every move the keyless bot
  // makes, and the table finishes.
  const service = down();
  const offline = await playOut(null, 3);
  const outage = await playOut(service, 3);
  assert.ok(offline.game.winner, 'the keyless table finishes');
  assert.ok(service.requests > 0, 'the failing service was asked');
  assert.deepEqual(outage.moves, offline.moves, 'every move matches the keyless bot');
  assert.equal(outage.game.winner, offline.game.winner);
});
