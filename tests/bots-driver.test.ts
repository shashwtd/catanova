import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/src/store.js';
import { BotDriver } from '../apps/server/src/bots.js';
import { newSession } from '../apps/client/src/connection.js';
import { gameView } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';
import { createJevClient } from '../packages/bot/src/index.js';

/** A started game between one connected person and one bot. */
function table() {
  const store = new Store(':memory:', { trackPresence: true });
  const host = store.enter('create', newSession('A').token, 'A');
  store.lobby(host, 'add-bot', store.snapshot(host.room_id).revision, false, undefined, undefined, true);
  store.setConnected(host, true);
  store.action(host, 'start', store.snapshot(host.room_id).revision, { kind: 'start' });
  const bot = store.botSeatsIn(host.room_id)[0]!;
  return { store, host, roomId: host.room_id, bot };
}

let moves = 0;
/** Make whatever move is owed, by whoever owes it, until `done` holds: the
 *  first legal corner and road in the opening, the turn clock's mandatory
 *  move after it. */
function advance(store: Store, roomId: string, done: (game: Game) => boolean): Game {
  for (let step = 0; step < 60; step++) {
    const game = store.loadGame(roomId)!;
    if (done(game)) return game;
    const owing = game.phase === 'discard' ? Object.keys(game.discards)[0]! : game.players[game.active]!.id;
    const legal = gameView(game, owing).legal;
    const action: GameAction =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : game.phase === 'setupRoad'
          ? { kind: 'road', edge: legal.roads[0]! }
          : timeoutAction(game, owing, Math.random)!;
    store.action(
      { id: owing, room_id: roomId, name: 'someone' },
      `advance-${moves++}`,
      store.snapshot(roomId).revision,
      action,
    );
  }
  throw new Error('the table never reached the position the test needs');
}

/** Tick the driver a quarter second at a time until `done`, or two minutes. */
async function run(driver: BotDriver, clock: { now: number }, done: () => boolean) {
  while (!done() && clock.now < 120_000) {
    await driver.tick();
    clock.now += 250;
  }
}

test('a bot handed a null answer by its decision service still takes its turn', async () => {
  const { store, roomId, bot } = table();
  try {
    advance(store, roomId, (game) => game.players[game.active]!.id === bot.id);
    const before = store.snapshot(roomId).revision;
    let requests = 0;
    const clock = { now: 0 };
    const events: string[] = [];
    const driver = new BotDriver({
      store,
      changed: () => {},
      now: () => clock.now,
      random: () => 0.5,
      log: (event) => events.push(event),
      // A local stub standing in for the decision service, answering null.
      jev: createJevClient({
        route: { url: 'https://stub.invalid', model: 'stub', key: 'stub' },
        fetchImpl: (async () => {
          requests++;
          return new Response(
            JSON.stringify({ answers: { site: null, plan_strategy: null, plan_focus: null } }),
          );
        }) as typeof fetch,
      }),
    });
    await run(driver, clock, () => store.snapshot(roomId).revision > before);

    assert.ok(requests > 0, 'the service was asked');
    assert.equal(store.snapshot(roomId).revision, before + 1, 'the bot moved');
    const game = store.loadGame(roomId)!;
    assert.ok(Object.values(game.buildings).some((b) => b.player === bot.id));
    assert.deepEqual(events, ['bot_move'], 'nothing failed on the way');
  } finally {
    store.close();
  }
});

test('a bot whose thinking keeps failing backs off, then makes the required move', async () => {
  const { store, roomId, bot } = table();
  try {
    advance(store, roomId, (game) => game.players[game.active]!.id === bot.id);
    const before = store.snapshot(roomId).revision;
    const clock = { now: 0 };
    const attempts: number[] = [];
    const events: string[] = [];
    const driver = new BotDriver({
      store,
      changed: () => {},
      jev: null,
      now: () => clock.now,
      random: () => 0.5,
      log: (event) => events.push(event),
      decide: async () => {
        attempts.push(clock.now);
        throw new TypeError("Cannot read properties of null (reading 'probabilities')");
      },
    });
    await run(driver, clock, () => store.snapshot(roomId).revision > before);

    // It used to try again on every tick, forever, and the table never moved.
    assert.deepEqual(attempts, [0, 1000, 3000], 'three attempts, each waiting twice as long as the last');
    assert.equal(store.snapshot(roomId).revision, before + 1, 'then one move, and only one');
    const game = store.loadGame(roomId)!;
    assert.ok(
      Object.values(game.buildings).some((b) => b.player === bot.id),
      'the opening corner is taken for it',
    );
    assert.equal(game.phase, 'setupRoad');
    assert.deepEqual(events, [
      'bot_decision_failed',
      'bot_decision_failed',
      'bot_decision_failed',
      'bot_move_rescued',
      'bot_move',
    ]);
  } finally {
    store.close();
  }
});

test('a move the rules refuse is tried three times, then replaced by the required one', async () => {
  const { store, roomId, bot } = table();
  try {
    advance(store, roomId, (game) => game.phase === 'roll' && game.players[game.active]!.id === bot.id);
    const before = store.snapshot(roomId).revision;
    const clock = { now: 0 };
    const attempts: number[] = [];
    const log: { event: string; detail: Record<string, unknown> }[] = [];
    const driver = new BotDriver({
      store,
      changed: () => {},
      jev: null,
      now: () => clock.now,
      random: () => 0.5,
      log: (event, detail) => log.push({ event, detail }),
      // Ending the turn before rolling: refused by the rules every time, the
      // way a deterministic decision the rules disagree with would be.
      decide: async (context) => {
        attempts.push(clock.now);
        return {
          action: { kind: 'endTurn' },
          plan: context.plan,
          calls: 0,
          tokens: 0,
          costUsd: 0,
          explain: '',
        };
      },
    });
    await run(driver, clock, () => store.snapshot(roomId).revision > before);

    assert.equal(attempts.length, 3, 'the refused move is not retried forever');
    assert.ok(attempts[1]! - attempts[0]! < attempts[2]! - attempts[1]!, 'each retry waits longer');
    assert.equal(store.snapshot(roomId).revision, before + 1);
    const game = store.loadGame(roomId)!;
    assert.equal(game.players[game.active]!.id, bot.id);
    assert.notEqual(game.phase, 'roll', 'the bot rolled, which is all the rules require of it here');
    assert.deepEqual(
      log.map((entry) => entry.event),
      ['bot_move_rejected', 'bot_move_rejected', 'bot_move_rejected', 'bot_move_rescued', 'bot_move'],
    );
    assert.equal(log[3]!.detail.action, 'roll');
  } finally {
    store.close();
  }
});

/** The store as the driver sees it, counting every call the driver makes, and
 *  listing exactly the rooms given whatever the store's own query would say. */
function counted(store: Store, rooms: string[]) {
  const calls: Record<string, number> = {};
  const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);
  const proxy = new Proxy(store, {
    get(target, key) {
      if (key === 'botRooms')
        return () => {
          count('botRooms');
          return rooms;
        };
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        count(String(key));
        return value.apply(target, args);
      };
    },
  });
  return { store: proxy, calls };
}

test('a finished or paused room costs a read or two a tick, and nothing else', async () => {
  const decisions: string[] = [];
  const driverFor = (store: Store) =>
    new BotDriver({
      store,
      changed: () => {},
      jev: null,
      now: () => 0,
      decide: async () => {
        decisions.push('asked');
        throw new Error('a dead room is never thought about');
      },
    });

  // A finished game: the host left, so the bot won by resignation.
  const finished = new Store(':memory:');
  try {
    const host = finished.enter('create', newSession('A').token, 'A');
    finished.lobby(
      host,
      'add-bot',
      finished.snapshot(host.room_id).revision,
      false,
      undefined,
      undefined,
      true,
    );
    finished.action(host, 'start', finished.snapshot(host.room_id).revision, { kind: 'start' });
    finished.leave(host, 'leave', finished.snapshot(host.room_id).revision);
    assert.equal(finished.loadGame(host.room_id)!.phase, 'finished');
    const { store, calls } = counted(finished, [host.room_id]);
    const driver = driverFor(store);
    await driver.tick();
    await driver.tick();
    assert.deepEqual(calls, { botRooms: 2, loadGame: 2 }, 'the game alone shows it is over');
  } finally {
    finished.close();
  }

  // A paused table: the only person there disconnected.
  const paused = new Store(':memory:', { trackPresence: true });
  try {
    const host = paused.enter('create', newSession('A').token, 'A');
    paused.lobby(host, 'add-bot', paused.snapshot(host.room_id).revision, false, undefined, undefined, true);
    paused.setConnected(host, true);
    paused.action(host, 'start', paused.snapshot(host.room_id).revision, { kind: 'start' });
    paused.setConnected(host, false);
    assert.ok(paused.snapshot(host.room_id).paused);
    const { store, calls } = counted(paused, [host.room_id]);
    const driver = driverFor(store);
    await driver.tick();
    await driver.tick();
    assert.deepEqual(calls, { botRooms: 2, loadGame: 2, snapshot: 2 }, 'no seat lookup behind the pause');
  } finally {
    paused.close();
  }

  assert.deepEqual(decisions, [], 'and neither was ever thought about');
});
