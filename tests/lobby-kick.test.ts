import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/src/store.js';
import { newSession, Connection } from '../apps/client/src/connection.js';
import { parseClientMessage, type ServerMessage } from '../packages/protocol/src/index.js';
import { startServer } from '../apps/server/src/server.js';
import { readyLobby } from './helpers.js';

const until = async (check: () => boolean) => {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
test('only the current host can remove another waiting player; receipts are idempotent and intent bound', () => {
  const store = new Store(':memory:');
  try {
    const a = store.enter('create', newSession('A').token, 'A');
    const session = newSession('B');
    const b = store.enter('join', session.token, 'B', a.room_id);
    const c = store.enter('join', newSession('C').token, 'C', a.room_id);
    const revision = store.snapshot(a.room_id).revision;
    assert.throws(() => store.lobby(b, 'guest-kick', revision, false, undefined, c.id), /Only the host/);
    assert.throws(() => store.lobby(a, 'self-kick', revision, false, undefined, a.id), /another player/);
    assert.throws(
      () => store.lobby(a, 'wrong-kick', revision, false, undefined, 'not-here'),
      /another player/,
    );
    const receipt = store.lobby(a, 'host-kick', revision, false, undefined, b.id);
    assert.equal(store.snapshot(a.room_id).players.length, 2);
    assert.equal(store.lobby(a, 'host-kick', revision, false, undefined, b.id).duplicate, true);
    assert.throws(() => store.lobby(a, 'host-kick', revision, false, undefined, c.id), /different intent/);
    assert.throws(() => store.lobby(a, 'stale-kick', revision, false, undefined, c.id), /lobby changed/);
    assert.equal(store.snapshot(a.room_id).revision, receipt.revision);
    assert.throws(() => store.enter('resume', session.token, 'B', a.room_id), /left this room/);
    store.action(a, 'start-game', readyLobby(store, a.room_id), { kind: 'start' });
    assert.throws(
      () => store.lobby(a, 'started-kick', store.snapshot(a.room_id).revision, false, undefined, c.id),
      /started/,
    );
  } finally {
    store.close();
  }
});
test('removal payload cannot smuggle an invalid identifier or profile edit', () => {
  for (const extra of [{ kickPlayerId: '' }, { kickPlayerId: 3 }, { kickPlayerId: 'p1', profile: {} }]) {
    assert.throws(
      () =>
        parseClientMessage(
          JSON.stringify({
            type: 'lobby',
            ready: false,
            commandId: 'kick-0001',
            expectedRevision: 0,
            ...extra,
          }),
        ),
      /removal/,
    );
  }
});
test('a removed device receives a terminal notice while the host gets committed state', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
  });
  async function enter(name: string, roomId?: string) {
    const c = new Connection(server.url, newSession(name, roomId));
    clients.push(c);
    c.start();
    await until(() => c.status === 'connected');
    return c;
  }
  const host = await enter('Host'),
    other = await enter('Other', host.state!.roomId);
  await until(() => host.state!.players.length === 2);
  const messages: ServerMessage[] = [];
  other.subscribe((m) => messages.push(m));
  await host.kick(other.playerId!);
  await until(() => other.status === 'closed');
  assert.equal(host.state!.players.length, 1);
  assert.ok(messages.some((m) => m.type === 'error' && m.code === 'LOBBY_REMOVED'));
});
