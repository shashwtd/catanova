import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { newSession } from '../apps/client/src/connection.js';
import { PROTOCOL_VERSION } from '../packages/protocol/src/index.js';
import type { ServerMessage } from '../packages/protocol/src/index.js';
import { readyLobby } from './helpers.js';

test('updates are compressed on the wire and a game update carries its board once', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  const ws = new WebSocket(server.url);
  t.after(async () => {
    ws.terminate();
    await server.close();
  });
  await once(ws, 'open');
  assert.match(ws.extensions, /permessage-deflate/);
  const messages: ServerMessage[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(String(data))));
  const session = newSession('Host');
  ws.send(JSON.stringify({ type: 'create', version: PROTOCOL_VERSION, token: session.token, name: 'Host' }));
  while (!messages.some((m) => m.type === 'welcome')) await new Promise((r) => setTimeout(r, 5));
  const welcome = messages.find((m) => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
  assert.ok(welcome.state.board, 'a lobby still describes its island');

  const roomId = welcome.state.roomId;
  const host = server.store.snapshot(roomId).players[0]!;
  server.store.enter('join', newSession('Guest').token, 'Guest', roomId);
  server.store.action({ ...host, room_id: roomId }, 'start-wire', readyLobby(server.store, roomId), {
    kind: 'start',
  });
  messages.length = 0;
  ws.send(JSON.stringify({ type: 'sync' }));
  // The lobby's own broadcast after joining can still be arriving; wait for the game's update.
  const gameUpdate = (m: ServerMessage) => m.type === 'state' && !!m.state.game;
  while (!messages.some(gameUpdate)) await new Promise((r) => setTimeout(r, 5));
  const update = messages.find(gameUpdate) as Extract<ServerMessage, { type: 'state' }>;
  assert.ok(update.state.game!.board.hexes.length === 19);
  assert.equal(update.state.board, undefined, 'the board is not sent a second time beside the game');
});
