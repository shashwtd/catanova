import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import { seededRandom } from '../packages/rules/src/board.js';
import {
  createJevClient,
  decide,
  initialPlan,
  JevUnavailable,
  choice,
  profileStyle,
} from '../packages/bot/src/index.js';
import { adviseStrategy, adviseThreat, adviseTrade } from '../packages/bot/src/brain/advisor.js';
import type { BotPlan, JevClient, Mind } from '../packages/bot/src/index.js';

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
  const minds = new Map<string, Mind>();
  const moves: string[] = [];
  while (!game.winner && game.turn < 600) {
    const actor = game.phase === 'discard' ? Object.keys(game.discards)[0]! : game.players[game.active]!.id;
    const decision = await decide({
      view: gameView(game, actor),
      board: game.board,
      meId: actor,
      plan: plans.get(actor) ?? initialPlan(game.turn),
      jev,
      level: 'sharp',
      positions: 60,
      budgetMs: 60_000,
      mind: minds.get(actor),
      canOffer: false,
    });
    plans.set(actor, decision.plan);
    if (decision.mind) minds.set(actor, decision.mind);
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
  const nulls = stubClient({ answers: { plan: null, wise: null, threat: null } });
  const advice = await adviseStrategy(nulls, gameView(game, 'a'), 'a', {
    cities: 100,
    expansion: 102,
    development: 150,
    road: 160,
  });
  assert.equal(advice.value, 'cities', 'the engine’s own choice stands');
  const decision = await decide({
    view: gameView(game, 'a'),
    board: game.board,
    meId: 'a',
    plan: initialPlan(0),
    jev: nulls,
    level: 'champ',
  });
  assert.equal(decision.action.kind, 'settlement');
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

test('after three failures in a row the client stops asking, and tries again after a minute', async () => {
  const question = { move: choice('Which?', { a: 1, b: 2 }) };
  let clock = 0,
    requests = 0,
    answering = false;
  const client = createJevClient({
    route: { url: 'https://stub.invalid', model: 'stub', key: 'stub' },
    timeoutMs: 150,
    now: () => clock,
    // A hung service: nothing comes back until the client gives up waiting.
    fetchImpl: ((_url: string, init: RequestInit) => {
      requests++;
      if (answering)
        return Promise.resolve(
          new Response(JSON.stringify({ answers: { move: { type: 'choice', choice: 'a' } } })),
        );
      return new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      );
    }) as typeof fetch,
  })!;
  const ask = async () => {
    const started = performance.now();
    const ok = await client.evaluate({}, question).then(
      () => true,
      (error) => {
        assert.ok(error instanceof JevUnavailable, 'every failure is the service being unavailable');
        return false;
      },
    );
    return { ok, ms: performance.now() - started };
  };

  // The first three each wait out the whole timeout, as every request used to.
  for (let i = 0; i < 3; i++) {
    const asked = await ask();
    assert.equal(asked.ok, false);
    assert.ok(asked.ms >= 100, `a hung request waits for the timeout (${asked.ms.toFixed(0)} ms)`);
  }
  // Then the client stops asking: no request goes out and nothing waits.
  for (let i = 0; i < 50; i++) {
    const asked = await ask();
    assert.equal(asked.ok, false);
    assert.ok(asked.ms < 100, `a resting client answers at once (${asked.ms.toFixed(0)} ms)`);
  }
  assert.equal(requests, 3, 'nothing was sent while resting');

  // A minute later exactly one request goes out to see whether it is back,
  // and a decision that comes along meanwhile is not held up behind it.
  clock += 60_000;
  const [probe, meanwhile] = await Promise.all([ask(), ask()]);
  assert.equal(requests, 4, 'one probe');
  assert.equal(probe.ok, false);
  assert.ok(meanwhile.ms < 100, 'nobody waits behind the probe');
  assert.equal((await ask()).ok, false);
  assert.equal(requests, 4, 'a failed probe starts another rest');

  // Once the service answers again, so does the client, every time.
  answering = true;
  clock += 60_000;
  assert.equal((await ask()).ok, true);
  assert.equal((await ask()).ok, true);
  assert.equal(requests, 6);
});

test('the decision service is never told who is playing', async () => {
  const names = ['Zelda Quartz', 'Morgan Vale', 'Priya Okafor', 'Tomasz Lind'];
  const seats = names.map((name, i) => ({ id: `seat-${i}`, name }));
  const requests: { state: any; questions: any }[] = [];
  const spy: JevClient = {
    model: 'spy',
    async evaluate(state, questions) {
      requests.push({ state, questions });
      return { answers: {}, inputTokens: 0, costUsd: 0, latencyMs: 0, model: 'spy' };
    },
  };
  const game = createGame(seats, 9, seededRandom(9));
  const corners = game.board.vertices.filter((v) => v.id % 9 === 0).map((v) => v.id);
  corners.forEach((vertex, i) => {
    game.buildings[vertex] = { player: `seat-${i % 4}`, kind: i % 4 === 2 ? 'city' : 'settlement' };
  });
  game.longestRoad = 'seat-2';
  game.phase = 'actions';
  game.turn = 12;
  const view = gameView(game, 'seat-0');

  // The long plan, when two are close.
  await adviseStrategy(spy, view, 'seat-0', { cities: 80, expansion: 82, development: 120, road: 130 });
  // A close trade with a person.
  await adviseTrade(
    spy,
    view,
    'seat-0',
    'seat-2',
    { mine: 0.01, theirs: 0.008, speedsThem: 1, threat: false, ok: true, marginal: true },
    { offersSeen: 2, accepted: 1, declined: 1, robbedMe: 0 },
  );
  // Two robber targets the engine cannot separate.
  await adviseThreat(spy, view, 'seat-0', ['seat-1', 'seat-2']);
  // And a stand-in reading how the player whose seat it takes was playing.
  await profileStyle({ view: gameView(game, 'seat-1'), board: game.board, playerId: 'seat-1', jev: spy });

  assert.equal(requests.length, 4, 'every kind of request was made');
  for (const request of requests)
    for (const name of names) assert.ok(!JSON.stringify(request).includes(name), `${name} was sent`);

  // The same facts still reach it, under the same labels in every request.
  const labels = (state: { table: { who: string }[] }) => state.table.map((row) => row.who);
  assert.deepEqual(labels(requests[0]!.state), ['me', 'opponent 1', 'opponent 2', 'opponent 3']);
  assert.equal(requests[1]!.state.partner, 'opponent 2');
  assert.deepEqual(Object.keys(requests[2]!.questions.threat.criteria), ['opponent 1', 'opponent 2']);
  assert.deepEqual(
    requests[3]!.state.others.map((o: { name: string }) => o.name),
    ['opponent 1', 'opponent 2', 'opponent 3'],
  );
});
