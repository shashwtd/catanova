import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store } from '../apps/server/src/store.js';
import { newSession } from '../apps/client/src/connection.js';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import { Lobby } from '../apps/client/src/Lobby.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { createGame, gameView, applyAction } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { decide, initialPlan, describe as describePlan } from '../packages/bot/src/index.js';
import type { BotPlan } from '../packages/bot/src/index.js';

test('a host can seat a bot; nobody else can, and the seat is ready and present', () => {
  const store = new Store(':memory:');
  try {
    const host = store.enter('create', newSession('A').token, 'A');
    const guest = store.enter('join', newSession('B').token, 'B', host.room_id);
    const revision = store.snapshot(host.room_id).revision;

    assert.throws(
      () => store.lobby(guest, 'guest-bot', revision, false, undefined, undefined, 'steady'),
      /Only the host/,
    );
    store.lobby(host, 'add-bot', revision, false, undefined, undefined, 'steady');

    const players = store.snapshot(host.room_id).players;
    assert.equal(players.length, 3);
    const bot = players.find((p) => p.bot);
    assert.ok(bot, 'the bot appears in the roster');
    assert.equal(bot.ready, true, 'a bot is always ready');
    assert.equal(bot.botLevel, 'steady');
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
      store.lobby(host, id, store.snapshot(host.room_id).revision, false, undefined, undefined, 'steady');
    assert.equal(store.snapshot(host.room_id).players.length, 4);
    assert.throws(
      () =>
        store.lobby(
          host,
          'bot-3',
          store.snapshot(host.room_id).revision,
          false,
          undefined,
          undefined,
          'steady',
        ),
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
    store.lobby(
      host,
      'add-bot',
      store.snapshot(host.room_id).revision,
      false,
      undefined,
      undefined,
      'steady',
    );
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

test('the add-bot command is validated like any other lobby command', () => {
  const base = { type: 'lobby', commandId: 'c'.repeat(10), expectedRevision: 1, ready: false };
  assert.equal(parseClientMessage(JSON.stringify({ ...base, addBot: 'steady' })).type, 'lobby');
  assert.throws(() => parseClientMessage(JSON.stringify({ ...base, addBot: 'godlike' })), /bot request/);
  assert.throws(() => parseClientMessage(JSON.stringify({ ...base, addBot: true })), /bot request/);
  assert.throws(
    () => parseClientMessage(JSON.stringify({ ...base, addBot: 'steady', kickPlayerId: 'x' })),
    /bot request/,
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
  assert.ok(asHost.includes('Add bot player'), 'the host is offered a bot');
  assert.ok(!asGuest.includes('Add bot player'), 'a guest is not');
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
