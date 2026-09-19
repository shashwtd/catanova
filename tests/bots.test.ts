import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store } from '../apps/server/src/store.js';
import { newSession } from '../apps/client/src/connection.js';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import { BOT_LEVELS, BOT_LEVEL_ODDS, randomBotLevel } from '../packages/protocol/src/bots.js';
import { Lobby } from '../apps/client/src/Lobby.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { createGame, gameView, applyAction } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import {
  decide,
  initialPlan,
  describe as describePlan,
  route,
  createJevClient,
} from '../packages/bot/src/index.js';
import type { BotPlan } from '../packages/bot/src/index.js';

test('a host can seat a bot; nobody else can, and the seat is ready and present', () => {
  const store = new Store(':memory:');
  try {
    const host = store.enter('create', newSession('A').token, 'A');
    const guest = store.enter('join', newSession('B').token, 'B', host.room_id);
    const revision = store.snapshot(host.room_id).revision;

    assert.throws(
      () => store.lobby(guest, 'guest-bot', revision, false, undefined, undefined, true),
      /Only the host/,
    );
    store.lobby(host, 'add-bot', revision, false, undefined, undefined, true);

    const players = store.snapshot(host.room_id).players;
    assert.equal(players.length, 3);
    const bot = players.find((p) => p.bot);
    assert.ok(bot, 'the bot appears in the roster');
    assert.equal(bot.ready, true, 'a bot is always ready');
    assert.ok(
      BOT_LEVELS.includes(bot.botLevel as (typeof BOT_LEVELS)[number]),
      `drawn level was ${bot.botLevel}`,
    );
    assert.notEqual(bot.name, 'A');
    assert.notEqual(bot.name, 'B');
  } finally {
    store.db.close();
  }
});

test('a bot fills the fourth seat and no more, and the host can remove it again', () => {
  const store = new Store(':memory:');
  try {
    const host = store.enter('create', newSession('A').token, 'A');
    store.enter('join', newSession('B').token, 'B', host.room_id);
    for (const id of ['bot-1', 'bot-2'])
      store.lobby(host, id, store.snapshot(host.room_id).revision, false, undefined, undefined, true);
    assert.equal(store.snapshot(host.room_id).players.length, 4);
    assert.throws(
      () =>
        store.lobby(host, 'bot-3', store.snapshot(host.room_id).revision, false, undefined, undefined, true),
      /four seats/,
    );

    // Removal reuses the ordinary kick path, so a bot needs no separate command.
    const seated = store.snapshot(host.room_id).players.find((p) => p.bot)!;
    store.lobby(host, 'drop-bot', store.snapshot(host.room_id).revision, false, undefined, seated.id);
    assert.equal(store.snapshot(host.room_id).players.length, 3);
    assert.equal(store.botSeatsIn(host.room_id).length, 1);
  } finally {
    store.db.close();
  }
});

test('a bot never counts as disconnected, and a room of only bots is paused', () => {
  const store = new Store(':memory:', { trackPresence: true });
  try {
    const host = store.enter('create', newSession('A').token, 'A');
    store.lobby(host, 'add-bot', store.snapshot(host.room_id).revision, false, undefined, undefined, true);
    store.setConnected(host, true);
    store.lobby(host, 'host-ready', store.snapshot(host.room_id).revision, true);
    store.action(host, 'start', store.snapshot(host.room_id).revision, { kind: 'start' });

    // With the only human present the room runs.
    assert.ok(!store.snapshot(host.room_id).paused, 'a watched room is not paused');
    const bot = store.snapshot(host.room_id).players.find((p) => p.bot)!;
    assert.equal(bot.resignAt, undefined, 'a bot is never given a resignation deadline');

    // When the human leaves, the bots do not play on alone: the room pauses and
    // the store refuses further moves, which is what stops the driver too.
    store.setConnected(host, false);
    assert.ok(store.snapshot(host.room_id).paused, 'a table nobody is sitting at pauses');
    assert.throws(
      () => store.action(host, 'roll-after-leave', store.snapshot(host.room_id).revision, { kind: 'roll' }),
      /paused/,
    );
  } finally {
    store.db.close();
  }
});

test('the add-bot command asks for a bot and cannot choose which one', () => {
  const base = { type: 'lobby', commandId: 'c'.repeat(10), expectedRevision: 1, ready: false };
  assert.equal(parseClientMessage(JSON.stringify({ ...base, addBot: true })).type, 'lobby');
  // Naming a level is refused: the draw belongs to the server, so a client
  // cannot ask for the easy one.
  for (const bad of ['steady', 'champ', 'godlike', 1])
    assert.throws(() => parseClientMessage(JSON.stringify({ ...base, addBot: bad })), /bot request/);
  assert.throws(
    () => parseClientMessage(JSON.stringify({ ...base, addBot: true, kickPlayerId: 'x' })),
    /bot request/,
  );
});

test('the draw favours the ordinary bots and keeps the champion rare', () => {
  assert.equal(
    Object.values(BOT_LEVEL_ODDS).reduce((a, b) => a + b, 0),
    1,
    'the odds are a distribution',
  );
  assert.ok(BOT_LEVEL_ODDS.champ < BOT_LEVEL_ODDS.steady, 'a champion is the rare one');

  // Each band of the random source lands in the level that owns it.
  assert.equal(
    randomBotLevel(() => 0),
    'steady',
  );
  assert.equal(
    randomBotLevel(() => 0.39),
    'steady',
  );
  assert.equal(
    randomBotLevel(() => 0.4),
    'sharp',
  );
  assert.equal(
    randomBotLevel(() => 0.79),
    'sharp',
  );
  assert.equal(
    randomBotLevel(() => 0.8),
    'champ',
  );
  assert.equal(
    randomBotLevel(() => 1),
    'champ',
    'never off the end',
  );

  const counts: Record<string, number> = { steady: 0, sharp: 0, champ: 0 };
  for (let i = 0; i < 20_000; i++) counts[randomBotLevel()]! += 1;
  for (const level of BOT_LEVELS)
    assert.ok(
      Math.abs(counts[level]! / 20_000 - BOT_LEVEL_ODDS[level]) < 0.02,
      `${level} came up ${((counts[level]! / 20_000) * 100).toFixed(1)}%`,
    );
});

test('only the host sees the control that seats a bot', () => {
  const room = (players: RoomState['players']): RoomState => ({
    roomId: 'r',
    revision: 1,
    counter: 0,
    players,
  });
  const players: RoomState['players'] = [
    { id: 'host', name: 'A', connected: true },
    { id: 'guest', name: 'B', connected: true, ready: true },
  ];
  const props = {
    room: room(players),
    busy: false,
    connected: true,
    onReady: () => {},
    onStart: () => {},
    onInvite: () => {},
    onLeave: () => {},
    onEdit: () => {},
    onSettings: () => {},
    onAddBot: () => {},
  };
  const asHost = renderToStaticMarkup(createElement(Lobby, { ...props, me: 'host' }));
  const asGuest = renderToStaticMarkup(createElement(Lobby, { ...props, me: 'guest' }));

  // Both see the open place and can invite from it.
  for (const html of [asHost, asGuest]) assert.ok(html.includes('Invite a friend'));
  // Only the host can seat one, and it is one action: which of the three
  // turns up is drawn, not chosen.
  assert.ok(asHost.includes('Add a bot'), 'the host seats a bot');
  for (const level of BOT_LEVELS) assert.ok(!asHost.includes(`Add a ${level}`), 'and cannot pick one');
  assert.ok(!asGuest.includes('Add a bot'), 'a guest just invites');
});

test('every move a bot makes is legal, through a whole offline game', async () => {
  // No decision service, so this exercises the deterministic fallbacks: the
  // path that has to hold when the model is unreachable.
  const seats = [
    { id: 'a', name: 'Anchor' },
    { id: 'b', name: 'Beacon' },
    { id: 'c', name: 'Compass' },
  ];
  let game = createGame(seats, 7, Math.random);
  const plans = new Map<string, BotPlan>(seats.map((s) => [s.id, initialPlan(0)]));
  let rejected = 0;

  for (let step = 0; step < 900 && !game.winner; step++) {
    const actor =
      game.phase === 'discard'
        ? (Object.keys(game.discards)[0] ?? game.players[game.active]!.id)
        : game.players[game.active]!.id;
    const decision = await decide({
      view: gameView(game, actor),
      board: game.board,
      meId: actor,
      plan: plans.get(actor)!,
      jev: null,
    });
    plans.set(actor, decision.plan);
    try {
      game = applyAction(game, actor, decision.action, Math.random);
    } catch {
      rejected++;
      const rescue = timeoutAction(game, actor, Math.random);
      if (!rescue) break;
      game = applyAction(game, actor, rescue, Math.random);
    }
  }

  assert.equal(rejected, 0, 'the rules never rejected a bot move');
  assert.ok(game.turn > 20, 'the game actually progressed');
  const best = Math.max(
    ...game.players.map((p) => gameView(game, p.id).players.find((x) => x.id === p.id)!.points),
  );
  assert.ok(best >= 5, `bots scored: best was ${best}`);
});

test('a plan reads as a sentence and never invents one', () => {
  const game = createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    11,
    Math.random,
  );
  const plan: BotPlan = { ...initialPlan(3), focus: 'city', targetSite: 0, needs: ['ore', 'wheat'] };
  const line = describePlan(plan, game.board);
  assert.match(line, /^Saving for a city/);
  assert.match(line, /Rock and Hay|rock and hay/i);
  assert.ok(line.endsWith('.'));
});

test('steady and sharp are the same rules with different attention on the leader', async () => {
  // A board where the leader sits on a modest tile and somebody else sits on
  // the busiest one. The two levels should want different tiles.
  const game = createGame(
    [
      { id: 'me', name: 'Me' },
      { id: 'leader', name: 'Leader' },
      { id: 'other', name: 'Other' },
    ],
    11,
    Math.random,
  );
  const pips = (n: number | null) => (n === null ? 0 : 6 - Math.abs(7 - n));
  const numbered = game.board.hexes.filter((h) => h.terrain !== 'desert' && h.number !== null);
  const busiest = numbered.reduce((a, b) => (pips(b.number) > pips(a.number) ? b : a));
  // A quieter tile that shares no corner with the busiest, so the two choices
  // can never be the same hex.
  const quiet = numbered.find(
    (h) => h.id !== busiest.id && !h.vertices.some((v) => busiest.vertices.includes(v)),
  )!;
  game.buildings[busiest.vertices[0]!] = { player: 'other', kind: 'settlement' };
  game.buildings[quiet.vertices[0]!] = { player: 'leader', kind: 'settlement' };
  game.players[1]!.hand.wood = 3;
  game.players[2]!.hand.wood = 3;
  game.phase = 'robber';
  game.active = 0;
  game.robber = game.board.hexes.find((h) => h.terrain === 'desert')!.id;

  const move = async (level: 'steady' | 'sharp') =>
    (
      await decide({
        view: gameView(game, 'me'),
        board: game.board,
        meId: 'me',
        plan: initialPlan(game.turn),
        jev: null,
        level,
      })
    ).action as { kind: string; hex: number; victim?: string };

  const steady = await move('steady'),
    sharp = await move('sharp');
  assert.equal(steady.kind, 'robber');
  assert.equal(sharp.kind, 'robber');
  // Steady blocks the most production on the board; sharp follows the leader.
  assert.equal(steady.hex, busiest.id, 'steady blocks the busiest tile, whoever owns it');
  assert.equal(sharp.hex, quiet.id, 'sharp gives up production to hit the leader');
  assert.equal(sharp.victim, 'leader');
  assert.notEqual(steady.hex, sharp.hex, 'the two levels are not the same bot');
});

test('a bot plays the cards it holds, and is told what it is holding', async () => {
  const game = createGame(
    [
      { id: 'me', name: 'Me' },
      { id: 'b', name: 'B' },
    ],
    3,
    Math.random,
  );
  game.phase = 'actions';
  game.active = 0;
  game.players[0]!.cards = [
    { id: 'c1', kind: 'monopoly', boughtTurn: 0 },
    { id: 'c2', kind: 'knight', boughtTurn: 0 },
  ];
  game.turn = 4;
  assert.equal(gameView(game, 'me').legal.playableCards.length, 2);

  // With nothing to ask, the bot used to end the turn and keep the cards for a
  // game that was over before it played them.
  const offline = await decide({
    view: gameView(game, 'me'),
    board: game.board,
    meId: 'me',
    plan: initialPlan(game.turn),
    jev: null,
    level: 'steady',
  });
  assert.equal(offline.action.kind, 'playCard');
  assert.equal(
    (offline.action as { cardId: string }).cardId,
    'c2',
    'the knight goes first: never wasted, and it counts toward largest army',
  );

  // And with a service to ask, it is told what is in its hand — without which
  // it was being asked whether to play a card it could not see.
  let seen: { me: { playable_cards: Record<string, number> } } | null = null;
  await decide({
    view: gameView(game, 'me'),
    board: game.board,
    meId: 'me',
    plan: initialPlan(game.turn),
    level: 'steady',
    jev: {
      model: 'test',
      async evaluate(state: unknown) {
        seen = state as typeof seen;
        return { answers: {}, inputTokens: 0, costUsd: 0 };
      },
    } as never,
  });
  assert.deepEqual(seen!.me.playable_cards, { monopoly: 1, knight: 1 });
});

test('a champion never passes on a useful turn, and reads the standings', async () => {
  const seats = [
    { id: 'me', name: 'Me' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];
  const game = createGame(seats, 5, Math.random);
  // A position with a road affordable and nothing that scores a point: one
  // settlement on the board to build from, and timber and clay in hand.
  game.phase = 'actions';
  game.active = 0;
  game.buildings[0] = { player: 'me', kind: 'settlement' };
  game.players[0]!.hand = { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 };
  const legal = gameView(game, 'me').legal;
  assert.ok(legal.roads.length, 'the position offers a road');

  const asked: Record<string, Record<string, unknown>> = {};
  const state: Record<string, unknown> = {};
  const spy = (level: 'sharp' | 'champ') => ({
    model: 'test',
    async evaluate(seen: unknown, questions: Record<string, unknown>) {
      asked[level] = questions as Record<string, unknown>;
      state[level] = seen;
      return { answers: {}, inputTokens: 0, costUsd: 0 };
    },
  });
  const run = (level: 'sharp' | 'champ') =>
    decide({
      view: gameView(game, 'me'),
      board: game.board,
      meId: 'me',
      plan: { ...initialPlan(game.turn), targetSite: 0 },
      jev: spy(level) as never,
      level,
    });
  await run('sharp');
  await run('champ');

  const moves = (level: 'sharp' | 'champ') =>
    Object.keys((asked[level]!.move as { criteria: Record<string, string> }).criteria);
  assert.ok(moves('sharp').includes('endTurn'), 'a sharp bot may sit on its resources');
  assert.ok(!moves('champ').includes('endTurn'), 'a champion spends a turn it can use');
  assert.ok(moves('champ').includes('road'));

  // A champion is told where the two awards stand and how far it is from the
  // target. Every number in that is on the portraits already.
  assert.ok(!('awards' in (state.sharp as object)), 'the others are not');
  const champState = state.champ as { awards: Record<string, string>; points_still_needed: number };
  assert.match(champState.awards.longest_road!, /longest run on the board/);
  assert.match(champState.awards.largest_army!, /knights played/);
  // One settlement on the board, so one point of the target is already in.
  const mine = gameView(game, 'me').players.find((p) => p.id === 'me')!;
  assert.equal(champState.points_still_needed, (game.victoryPoints ?? 10) - mine.points);
  assert.equal(mine.points, 1);
});

test('the decision service is TypeSafe only, and absent without a key', () => {
  assert.equal(route({} as NodeJS.ProcessEnv), null, 'no key means no decision service');
  assert.equal(
    route({ OPENROUTER_API_KEY: 'o', AI_GATEWAY_API_KEY: 'v' } as NodeJS.ProcessEnv),
    null,
    'a gateway key is not a substitute',
  );

  const resolved = route({ TYPESAFE_API_KEY: 'k' } as NodeJS.ProcessEnv);
  assert.equal(resolved?.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(resolved?.model, 'jev-latest');
  assert.equal(
    route({ TYPESAFE_API_KEY: 'k', CATANOVA_BOT_MODEL: 'jev-1.13.0' } as NodeJS.ProcessEnv)?.model,
    'jev-1.13.0',
    'a build can be pinned',
  );
});

test('a request matches the TypeSafe wire shape and its answers are normalised', async () => {
  let sent: { url: string; body: any; headers: Record<string, string> } | null = null;
  const client = createJevClient({
    route: route({ TYPESAFE_API_KEY: 'k' } as NodeJS.ProcessEnv),
    fetchImpl: (async (url: string, init: any) => {
      sent = { url, body: JSON.parse(init.body), headers: init.headers };
      return {
        ok: true,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: {
            pick: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 } },
            sure: { type: 'noul', noul: 0.9 },
          },
          usage: { input_tokens: 1_000_000, output_tokens: 40 },
        }),
      } as Response;
    }) as unknown as typeof fetch,
  })!;

  const result = await client.evaluate('a board', {
    pick: { type: 'choice', instructions: 'which?', criteria: { a: null, b: null } },
    sure: { type: 'noul', instructions: 'certain?' },
  });

  assert.equal(sent!.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(sent!.headers.Authorization, 'Bearer k');
  assert.equal(sent!.body.model, 'jev-latest', 'the model rides in the body');
  assert.equal(sent!.body.questions.sure.type, 'noul', "sent in TypeSafe's own dialect");
  assert.equal(sent!.body.state, 'a board');

  assert.equal(client.model, 'jev-latest');
  assert.equal((result.answers.pick as { choice: string }).choice, 'b');
  assert.ok(Math.abs((result.answers.pick as { confidence: number }).confidence - 0.6) < 1e-9);
  assert.equal((result.answers.sure as { probability: number }).probability, 0.9);
  assert.ok(Math.abs(result.costUsd - 0.042) < 1e-9, 'cost is computed from input tokens');
});

test('a bot pauses before each move, longer over the decisions that matter', async () => {
  // Think time is what stops a bot reading as a machine, so it is asserted
  // rather than left to feel. A fixed random makes the ranges deterministic.
  const { BotDriver } = await import('../apps/server/src/bots.js');
  const store = new Store(':memory:', { trackPresence: true });
  try {
    const host = store.enter('create', newSession('A').token, 'A');
    store.lobby(host, 'bot', store.snapshot(host.room_id).revision, false, undefined, undefined, true);
    store.setConnected(host, true);
    store.lobby(host, 'ready', store.snapshot(host.room_id).revision, true);
    store.action(host, 'start', store.snapshot(host.room_id).revision, { kind: 'start' });

    let clock = 0;
    const driver = new BotDriver({
      store,
      changed: () => {},
      jev: null,
      now: () => clock,
      random: () => 0.5,
    });

    // Midpoint of every range, with no time already spent deciding.
    const think = (phase: string, kind: string) =>
      (driver as unknown as { thinkTime(p: string, k: string, s: number): number }).thinkTime(phase, kind, 0);

    assert.ok(think('actions', 'roll') >= 400, 'even a roll is not instant');
    assert.ok(
      think('actions', 'settlement') > think('actions', 'roll'),
      'building is considered for longer than rolling',
    );
    assert.ok(
      think('setupSettlement', 'settlement') > think('actions', 'settlement'),
      'the opening is the longest decision in the game',
    );

    // Time already spent deciding counts towards the pause, so a slow model
    // call is absorbed rather than added on top.
    const spent2s = (driver as unknown as { thinkTime(p: string, k: string, s: number): number }).thinkTime(
      'actions',
      'settlement',
      -2000,
    );
    assert.ok(spent2s < think('actions', 'settlement'), 'a slow decision shortens the remaining pause');
    assert.ok(spent2s >= 120, 'but never to nothing');
  } finally {
    store.db.close();
  }
});

test('the driver holds its first move, cancels stale plans and commits one action per think period', async () => {
  const { BotDriver } = await import('../apps/server/src/bots.js');
  const store = new Store(':memory:', { trackPresence: true });
  try {
    const host = store.enter('create', newSession('A').token, 'A');
    store.lobby(host, 'bot', store.snapshot(host.room_id).revision, false, undefined, undefined, true);
    store.setConnected(host, true);
    store.action(host, 'start', store.snapshot(host.room_id).revision, { kind: 'start' });
    // Advance any human opening moves until a bot must place its first house.
    for (let i = 0; i < 2; i++) {
      const g = store.loadGame(host.room_id)!;
      if (g.players[g.active]!.id !== host.id) break;
      store.action(
        host,
        `human-${i}`,
        store.snapshot(host.room_id).revision,
        g.phase === 'setupSettlement'
          ? { kind: 'settlement', vertex: gameView(g, host.id).legal.settlements[0]! }
          : { kind: 'road', edge: gameView(g, host.id).legal.roads[0]! },
      );
    }
    let clock = 0,
      broadcasts = 0;
    const driver = new BotDriver({
      store,
      changed: () => {
        broadcasts++;
      },
      jev: null,
      now: () => clock,
      random: () => 0.5,
    });
    const revision = () => store.snapshot(host.room_id).revision;
    const initial = revision();
    await driver.tick();
    assert.equal(revision(), initial, 'the first move must not commit instantly');
    clock = 2700;
    await driver.tick();
    assert.equal(revision(), initial);
    // The only human disconnecting invalidates the queued move.
    store.setConnected(host, false);
    clock = 6000;
    await driver.tick();
    assert.equal(broadcasts, 0);
    store.setConnected(host, true);
    const resumed = revision();
    await driver.tick();
    assert.equal(revision(), resumed, 'resuming schedules a fresh decision');
    clock += 2750;
    await driver.tick();
    assert.equal(revision(), resumed + 1);
    assert.equal(broadcasts, 1);
    await driver.tick();
    assert.equal(revision(), resumed + 1, 'the next action also waits');
  } finally {
    store.db.close();
  }
});
