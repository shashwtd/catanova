import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { newSession, Connection } from '../apps/client/src/connection.js';
import { PROTOCOL_VERSION, parseClientMessage } from '../packages/protocol/src/index.js';
import type { ClientMessage, ServerMessage, RoomState } from '../packages/protocol/src/index.js';
import { createGame, gameView, emptyHand } from '../packages/rules/src/game.js';

async function until(check: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for spectator message');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('public game views contain no hands, development cards, deck order or available moves', () => {
  const game = createGame(
    [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    42,
    () => 0.5,
  );
  game.players[0]!.hand = { ...emptyHand(), ore: 4 };
  game.players[0]!.cards.push({ id: 'private-vp', kind: 'victoryPoint', boughtTurn: 0 });
  const publicView = gameView(game, '@spectator');
  assert.equal(publicView.players[0]!.resourceCount, 4);
  assert.equal(publicView.players[0]!.cardCount, 1);
  assert.equal(publicView.players[0]!.points, gameView(game, 'a').players[0]!.points - 1);
  for (const player of publicView.players) {
    assert.equal(player.hand, undefined);
    assert.equal(player.cards, undefined);
  }
  assert.ok(!JSON.stringify(publicView).includes('private-vp'));
  assert.ok(!('deck' in publicView) && !('balancedDice' in publicView));
  assert.deepEqual(publicView.legal.roads, []);
  assert.deepEqual(publicView.legal.settlements, []);
  assert.deepEqual(publicView.legal.cities, []);
  assert.deepEqual(publicView.legal.playableCards, []);
  assert.equal(publicView.legal.canBuyCard, false);
});

test('spectating validates room references and the client cannot queue mutations', async () => {
  const session = { ...newSession('Watcher', 'AB2C'), spectating: true };
  assert.equal(
    parseClientMessage(JSON.stringify({ ...session, version: PROTOCOL_VERSION, type: 'spectate' })).type,
    'spectate',
  );
  assert.throws(() =>
    parseClientMessage(
      JSON.stringify({ ...session, roomId: '../bad', version: PROTOCOL_VERSION, type: 'spectate' }),
    ),
  );
  const client = new Connection('ws://unused', session);
  await assert.rejects(client.action({ kind: 'roll' }), /Spectators cannot/);
  await assert.rejects(client.kick('a'), /Spectators cannot/);
});

test('spectators receive live public state, history and statistics without seats or game authority', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:', auth: null });
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const ws of sockets) ws.close();
    await server.close();
  });
  async function connect(type: 'create' | 'join' | 'spectate', roomId?: string) {
    const ws = new WebSocket(server.url);
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const send = (message: ClientMessage) => ws.send(JSON.stringify(message));
    send({ type, version: PROTOCOL_VERSION, ...newSession(type, roomId) });
    await until(() => messages.some((m) => m.type === 'welcome' || m.type === 'error'));
    const welcome = messages.find((m) => m.type === 'welcome');
    const state = () =>
      (messages.findLast((m) => m.type === 'welcome' || m.type === 'state') as { state: RoomState }).state;
    return { ws, send, messages, welcome, state };
  }
  const host = await connect('create');
  const roomId = host.state().roomId;
  const refused = await connect('spectate', roomId);
  assert.ok(refused.messages.some((m) => m.type === 'error' && m.code === 'NOT_STARTED'));
  refused.ws.close();
  const guest = await connect('join', roomId);
  assert.equal(host.welcome?.type, 'welcome');
  assert.equal(guest.welcome?.type, 'welcome');
  if (host.welcome?.type !== 'welcome' || guest.welcome?.type !== 'welcome') throw new Error('Missing seats');
  const hostId = host.welcome.playerId;
  const guestId = guest.welcome.playerId;
  server.store.lobby(
    { id: guestId, name: 'join', room_id: roomId },
    'guest-ready',
    server.store.snapshot(roomId).revision,
    true,
  );
  host.send({
    type: 'action',
    commandId: 'start-spectate-test',
    expectedRevision: server.store.snapshot(roomId).revision,
    action: { kind: 'start' },
  });
  await until(() => !!host.state().game);
  const revision = host.state().revision;
  const watcher = await connect('spectate', host.state().roomCode);
  assert.equal(watcher.state().spectating, true);
  assert.equal(watcher.state().players.length, 2);
  assert.equal(server.store.snapshot(roomId).revision, revision);
  assert.equal(watcher.state().game!.players[0]!.hand, undefined);
  for (const [index, operation] of [
    { type: 'action', action: { kind: 'roll' } },
    { type: 'lobby', ready: true, kickPlayerId: hostId },
    { type: 'leave' },
    { type: 'increment' },
    { type: 'settings', settings: { turnTimerSeconds: null, diceMode: 'balanced', victoryPoints: 10 } },
  ].entries()) {
    watcher.send({
      ...operation,
      commandId: `forbidden-${index}`,
      expectedRevision: revision,
    } as ClientMessage);
    await until(() =>
      watcher.messages.some(
        (m) => m.type === 'error' && m.commandId === `forbidden-${index}` && m.code === 'SPECTATOR_READ_ONLY',
      ),
    );
  }
  assert.equal(server.store.snapshot(roomId).revision, revision);
  watcher.send({ type: 'statistics' });
  watcher.send({ type: 'history' });
  watcher.send({ type: 'ping', nonce: 'watch-ping' });
  await until(() =>
    ['history', 'statistics', 'pong'].every((type) => watcher.messages.some((m) => m.type === type)),
  );
  const game = server.store.loadGame(roomId)!;
  const activeId = game.players[game.active]!.id;
  const player = activeId === hostId ? host : guest;
  player.send({
    type: 'action',
    commandId: 'build-after-watch',
    expectedRevision: revision,
    action: { kind: 'settlement', vertex: gameView(game, activeId).legal.settlements[0]! },
  });
  await until(() => watcher.state().revision > revision);
  assert.ok(Object.keys(watcher.state().game!.buildings).length === 1);
  assert.equal(server.store.snapshot(roomId).players.length, 2);
  // Watchers cannot keep a table alive when all actual players disconnect.
  host.ws.close();
  guest.ws.close();
  await until(() => !!watcher.state().paused);
  assert.equal(watcher.state().players.filter((p) => p.connected).length, 0);
  const beforeReconnect = server.store.snapshot(roomId).revision;
  watcher.ws.close();
  const returning = await connect('spectate', roomId);
  assert.equal(returning.state().revision, beforeReconnect);
  assert.equal(returning.state().paused, true);
  assert.equal(returning.state().game!.players[0]!.cards, undefined);
});
