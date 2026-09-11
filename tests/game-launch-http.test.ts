import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { newSession } from '../apps/client/src/connection.js';
import { PROTOCOL_VERSION } from '../packages/protocol/src/index.js';
import type { ClientMessage, RoomState, ServerMessage, Session } from '../packages/protocol/src/index.js';
import { activePlayer, gameView } from '../packages/rules/src/game.js';
import type { GameAction } from '../packages/rules/src/game.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const limit = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > limit) throw new Error('Launch test timed out');
    await pause(5);
  }
}
async function fixture(t: TestContext, guestPreload = true) {
  let now = Date.now(),
    sequence = 0;
  const server = await startServer({ port: 0, databasePath: ':memory:', auth: null, now: () => now });
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const ws of sockets) ws.close();
    await server.close();
  });
  async function connect(name: string, roomId?: string, saved?: Session, preloadGame = true) {
    const session = saved ?? newSession(name, roomId);
    const ws = new WebSocket(server.url);
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const send = (message: ClientMessage) => ws.send(JSON.stringify(message));
    send({
      type: saved ? 'resume' : roomId ? 'join' : 'create',
      version: PROTOCOL_VERSION,
      token: session.token,
      name,
      ...(roomId ? { roomId } : {}),
      ...(preloadGame ? { preloadGame: true } : {}),
    });
    await until(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;
    assert.equal(welcome.type, 'welcome');
    session.roomId = welcome.state.roomId;
    const state = () => {
      const last = messages.findLast((m) => m.type === 'welcome' || m.type === 'state');
      return (last as { state: RoomState }).state;
    };
    const command = async (
      operation:
        | { type: 'action'; action: GameAction }
        | { type: 'lobby'; ready: boolean }
        | { type: 'settings'; settings: { turnTimerSeconds: 90 } },
    ) => {
      const message = {
        ...operation,
        commandId: `launch-command-${++sequence}`,
        expectedRevision: server.store.snapshot(session.roomId!).revision,
      };
      send(message);
      await until(() =>
        messages.some((m) => (m.type === 'ack' || m.type === 'error') && m.commandId === message.commandId),
      );
      const result = messages.find(
        (m) => (m.type === 'ack' || m.type === 'error') && m.commandId === message.commandId,
      )!;
      assert.equal(result.type, 'ack', JSON.stringify(result));
      return result;
    };
    return { ws, session, messages, send, state, command, id: welcome.playerId };
  }
  const a = await connect('Host');
  const b = await connect('Friend', a.session.roomId, undefined, guestPreload);
  await b.command({ type: 'lobby', ready: true });
  const start = async (id = `launch-start-${++sequence}`) => {
    const message: Extract<ClientMessage, { type: 'action' }> = {
      type: 'action',
      commandId: id,
      expectedRevision: server.store.snapshot(a.session.roomId!).revision,
      action: { kind: 'start' },
    };
    a.send(message);
    await until(() => a.state().launch?.id === id && b.state().launch?.id === id);
    return message;
  };
  return {
    server,
    a,
    b,
    connect,
    start,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('preload-capable sockets wait for every player and two seconds, then persist and replay one original Start', async (t) => {
  const f = await fixture(t),
    roomId = f.a.session.roomId!;
  await f.a.command({ type: 'settings', settings: { turnTimerSeconds: 90 } });
  await f.b.command({ type: 'lobby', ready: true });
  const start = await f.start(),
    startedAt = f.a.state().launch!.startedAt;
  f.a.send({ type: 'launchReady', id: start.commandId, success: true });
  f.b.send({ type: 'launchReady', id: start.commandId, success: true });
  await until(() => f.a.state().launch?.readyPlayers.length === 2);
  f.advance(1999);
  await pause(140);
  assert.equal(f.server.store.loadGame(roomId), undefined);
  assert.equal(f.server.store.clock(roomId), undefined);
  assert.ok(!f.a.messages.some((m) => m.type === 'ack' && m.commandId === start.commandId));
  f.a.send(start);
  await pause(20);
  assert.equal(f.a.state().launch!.startedAt, startedAt, 'replay never restarts the loading deadline');
  f.advance(1);
  await until(() => !!f.a.state().game && !!f.b.state().game);
  const receipt = f.a.messages.find((m) => m.type === 'ack' && m.commandId === start.commandId)!;
  assert.equal(receipt.type, 'ack');
  assert.equal(receipt.duplicate, false);
  assert.equal(f.a.state().launch, undefined);
  assert.equal(f.server.store.history(roomId).entries.filter((e) => e.kind === 'start').length, 1);
  assert.equal(Date.parse(f.server.store.history(roomId).entries[0]!.at), f.now());
  assert.equal(f.server.store.clock(roomId), undefined, 'setup remains untimed after preparation commits');
  const revision = f.server.store.snapshot(roomId).revision;
  f.a.send(start);
  await until(() =>
    f.a.messages.some((m) => m.type === 'ack' && m.commandId === start.commandId && m.duplicate),
  );
  assert.equal(f.server.store.snapshot(roomId).revision, revision);
  f.advance(45000);
  for (let step = 0; step < 8 && !f.server.store.loadGame(roomId)!.turn; step++) {
    const game = f.server.store.loadGame(roomId)!,
      active = activePlayer(game);
    const peer = active.id === f.a.id ? f.a : f.b,
      legal = gameView(game, active.id).legal;
    await peer.command({
      type: 'action',
      action:
        game.phase === 'setupSettlement'
          ? { kind: 'settlement', vertex: legal.settlements[0]! }
          : { kind: 'road', edge: legal.roads[0]! },
    });
  }
  assert.equal(f.server.store.clock(roomId)!.startedAt, f.now());
  assert.equal(
    f.server.store.clock(roomId)!.deadlineAt,
    f.now() + 90000,
    'loading and setup never consume the first turn',
  );
});

test('a slow or failed client cancels preparation with no saved game, and late readiness cannot revive it', async (t) => {
  for (const cause of ['timeout', 'asset'] as const) {
    await t.test(cause, async (child) => {
      const f = await fixture(child),
        roomId = f.a.session.roomId!;
      const start = await f.start();
      f.a.send({ type: 'launchReady', id: start.commandId, success: true });
      if (cause === 'timeout') f.advance(10000);
      else f.b.send({ type: 'launchReady', id: start.commandId, success: false });
      await until(() =>
        f.a.messages.some(
          (m) => m.type === 'error' && m.code === 'LAUNCH_CANCELLED' && m.commandId === start.commandId,
        ),
      );
      await until(() => !f.a.state().launch);
      assert.equal(f.server.store.loadGame(roomId), undefined);
      assert.equal(f.server.store.clock(roomId), undefined);
      assert.equal(f.server.store.history(roomId).entries.length, 0);
      f.b.send({ type: 'launchReady', id: start.commandId, success: true });
      f.advance(2000);
      await pause(150);
      assert.equal(f.server.store.loadGame(roomId), undefined);
      const failures = () =>
        f.a.messages.filter((m) => m.type === 'error' && m.commandId === start.commandId).length;
      const beforeReplay = failures();
      f.a.send(start);
      await until(() => failures() > beforeReplay);
      assert.equal(f.a.state().launch, undefined, 'late cancelled Start retries cannot reopen loading');
      assert.equal(f.server.store.loadGame(roomId), undefined);
    });
  }
});

test('an active seat replacement during loading cancels its old document readiness', async (t) => {
  const f = await fixture(t),
    roomId = f.a.session.roomId!;
  const start = await f.start();
  f.a.send({ type: 'launchReady', id: start.commandId, success: true });
  f.b.send({ type: 'launchReady', id: start.commandId, success: true });
  await until(() => f.a.state().launch?.readyPlayers.length === 2);
  await f.connect('Friend', roomId, f.b.session);
  f.advance(2000);
  await until(() => f.a.messages.some((m) => m.type === 'error' && m.code === 'LAUNCH_CANCELLED'));
  assert.equal(f.server.store.loadGame(roomId), undefined);
  assert.equal(f.server.store.clock(roomId), undefined);
});

test('disconnecting during loading cancels without excluding the player or placing pieces', async (t) => {
  const f = await fixture(t),
    roomId = f.a.session.roomId!;
  const start = await f.start();
  f.a.send({ type: 'launchReady', id: start.commandId, success: true });
  f.b.ws.close();
  await until(() => f.a.messages.some((m) => m.type === 'error' && m.code === 'LAUNCH_CANCELLED'));
  f.advance(2000);
  await pause(150);
  assert.equal(f.server.store.loadGame(roomId), undefined);
  assert.equal(f.server.store.snapshot(roomId).players.length, 2);
  assert.equal(
    f.server.store.snapshot(roomId).players.some((p) => p.resignAt !== undefined),
    false,
  );
});

test('a mixed-capability room receives an explicit refresh error instead of waiting for an impossible readiness ack', async (t) => {
  const f = await fixture(t, false),
    roomId = f.a.session.roomId!;
  const commandId = 'mixed-client-start';
  f.a.send({
    type: 'action',
    commandId,
    expectedRevision: f.server.store.snapshot(roomId).revision,
    action: { kind: 'start' },
  });
  await until(() =>
    f.a.messages.some(
      (m) => m.type === 'error' && m.code === 'CLIENT_UPDATE_REQUIRED' && m.commandId === commandId,
    ),
  );
  assert.equal(f.a.state().launch, undefined);
  assert.equal(f.server.store.loadGame(roomId), undefined);
  assert.equal(f.server.store.clock(roomId), undefined);
});

test('a storage failure at the launch commit leaves no game, clock, or success receipt', async (t) => {
  const f = await fixture(t),
    roomId = f.a.session.roomId!;
  const start = await f.start(),
    revision = f.server.store.snapshot(roomId).revision;
  f.server.store.db.exec(
    "CREATE TEMP TRIGGER fail_launch_receipt BEFORE INSERT ON game_receipts BEGIN SELECT RAISE(ABORT,'Simulated launch storage failure'); END",
  );
  f.a.send({ type: 'launchReady', id: start.commandId, success: true });
  f.b.send({ type: 'launchReady', id: start.commandId, success: true });
  f.advance(2000);
  await until(() =>
    f.a.messages.some(
      (m) => m.type === 'error' && m.code === 'LAUNCH_CANCELLED' && m.commandId === start.commandId,
    ),
  );
  assert.equal(f.server.store.loadGame(roomId), undefined);
  assert.equal(f.server.store.clock(roomId), undefined);
  assert.equal(f.server.store.snapshot(roomId).revision, revision);
  assert.equal(f.server.store.history(roomId).entries.length, 0);
  assert.ok(!f.a.messages.some((m) => m.type === 'ack' && m.commandId === start.commandId));
  assert.equal(f.a.state().launch, undefined);
});
