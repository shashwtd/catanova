import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { newSession } from '../apps/client/src/connection.js';
import { PROTOCOL_VERSION } from '../packages/protocol/src/index.js';
import { REACTION_BURST, REACTION_WINDOW_MS } from '../packages/protocol/src/reactions.js';
import type { ClientMessage, ServerMessage, RoomState } from '../packages/protocol/src/index.js';

async function until(check: () => boolean) {
  const limit = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > limit) throw new Error('Reaction delivery timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('accepted reactions reach each player and spectator once, without revisions or unlimited spam', async (t) => {
  let now = Date.now();
  const server = await startServer({ port: 0, databasePath: ':memory:', auth: null, now: () => now });
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
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    send({ type, ...newSession(type, roomId), version: PROTOCOL_VERSION });
    await until(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;
    const state = () =>
      (messages.findLast((m) => m.type === 'welcome' || m.type === 'state') as { state: RoomState }).state;
    const reactions = () => messages.filter((m) => m.type === 'reaction');
    return { send, messages, welcome, state, reactions };
  }
  const a = await connect('create'),
    room = a.state().roomId;
  const b = await connect('join', room);
  server.store.lobby(
    { id: b.welcome.playerId, name: 'join', room_id: room },
    'ready-reaction',
    server.store.snapshot(room).revision,
    true,
  );
  a.send({
    type: 'action',
    action: { kind: 'start' },
    commandId: 'start-reaction',
    expectedRevision: server.store.snapshot(room).revision,
  });
  await until(() => !!a.state().game);
  const watcher = await connect('spectate', room);
  const revision = server.store.snapshot(room).revision;
  a.send({ type: 'react', reaction: 'laugh' });
  await until(() => [a, b, watcher].every((c) => c.reactions().length === 1));
  assert.equal(a.reactions()[0]!.playerId, a.welcome.playerId);
  // A run sent as fast as it can be all arrives, up to the burst.
  for (let i = 1; i < REACTION_BURST; i++) a.send({ type: 'react', reaction: 'nice' });
  await until(() => watcher.reactions().length === REACTION_BURST);
  // One more is refused until the cooldown ends. A sequential ping is a barrier after it.
  a.send({ type: 'react', reaction: 'shock' });
  a.send({ type: 'ping', nonce: 'burst-limit' });
  await until(() => a.messages.some((m) => m.type === 'pong' && m.nonce === 'burst-limit'));
  assert.equal(a.reactions().length, REACTION_BURST);
  watcher.send({ type: 'react', reaction: 'evil' });
  await until(() => watcher.messages.some((m) => m.type === 'error' && m.code === 'SPECTATOR_READ_ONLY'));
  now += REACTION_WINDOW_MS;
  a.send({ type: 'react', reaction: 'pleading' });
  await until(() => [a, b, watcher].every((c) => c.reactions().length === REACTION_BURST + 1));
  assert.equal(server.store.snapshot(room).revision, revision);
});
