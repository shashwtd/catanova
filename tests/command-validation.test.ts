import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import type { ServerMessage } from '../packages/protocol/src/index.js';
import type { RoomSettings } from '../packages/protocol/src/settings.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for validation response');
    await pause(5);
  }
}

test('invalid commands return their bounded identifier without applying state or acknowledging success', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  const socket = new WebSocket(server.url),
    messages: ServerMessage[] = [];
  t.after(async () => {
    socket.terminate();
    await server.close();
  });
  socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
  await once(socket, 'open');
  const session = newSession('Validation');
  socket.send(JSON.stringify({ type: 'create', version: 1, ...session }));
  await until(() => messages.some((m) => m.type === 'welcome'));
  const welcome = messages.find((m) => m.type === 'welcome')!;
  assert.equal(welcome.type, 'welcome');
  const invalid = [
    { type: 'settings', settings: { turnTimerSeconds: 41 } },
    { type: 'action', action: { kind: 'road', edge: 72 } },
    { type: 'lobby', ready: 'yes' },
    { type: 'increment', expectedRevision: -1 },
    { type: 'future-command' },
  ];
  for (const [i, operation] of invalid.entries()) {
    const commandId = `invalid-command-${i}`;
    socket.send(JSON.stringify({ expectedRevision: 0, ...operation, commandId }));
    await until(() => messages.some((m) => m.type === 'error' && m.commandId === commandId));
    assert.ok(!messages.some((m) => m.type === 'ack' && m.commandId === commandId));
    assert.equal(server.store.snapshot(welcome.state.roomId).revision, 0);
  }
  assert.equal(socket.readyState, WebSocket.OPEN);
  socket.send(JSON.stringify({ type: 'increment', commandId: 'valid-after-invalid', expectedRevision: 0 }));
  await until(() => messages.some((m) => m.type === 'ack' && m.commandId === 'valid-after-invalid'));
  assert.equal(server.store.snapshot(welcome.state.roomId).counter, 1);
});

test('invalid IDs and broken JSON are never reflected as error identifiers', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  const socket = new WebSocket(server.url),
    errors: Extract<ServerMessage, { type: 'error' }>[] = [];
  t.after(async () => {
    socket.terminate();
    await server.close();
  });
  socket.on('message', (data) => {
    const m = JSON.parse(String(data)) as ServerMessage;
    if (m.type === 'error') errors.push(m);
  });
  await once(socket, 'open');
  const inputs = [
    'not-json',
    JSON.stringify({ type: 'action', commandId: 'x'.repeat(81), action: null }),
    JSON.stringify({ type: 'settings', commandId: '<script>unsafe</script>', settings: null }),
    JSON.stringify({ type: 'action', commandId: { nested: 'private-data' }, action: null }),
    JSON.stringify([{ commandId: 'array-identifier', type: 'action' }]),
  ];
  for (const [i, input] of inputs.entries()) {
    socket.send(input);
    await until(() => errors.length > i);
    assert.equal(errors[i]!.commandId, undefined);
    assert.ok(!JSON.stringify(errors[i]).includes('private-data'));
    assert.ok(!JSON.stringify(errors[i]).includes('<script>'));
  }
  assert.equal(server.store.db.prepare('SELECT COUNT(*) AS n FROM rooms').get()!.n, 0);
});

test('client clears its pending outbox after a payload validation error and can immediately submit a valid action', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  let persisted: unknown;
  const client = new Connection(server.url, newSession('Pending'), {
    onPending: (value) => {
      persisted = value;
    },
  });
  t.after(async () => {
    client.stop();
    await server.close();
  });
  client.start();
  await until(() => client.status === 'connected');
  const request = client.settings({ turnTimerSeconds: 41 } as unknown as RoomSettings);
  let deadline: ReturnType<typeof setTimeout>;
  try {
    await assert.rejects(
      Promise.race([
        request,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('A malformed command stayed pending')), 2500);
        }),
      ]),
      /INVALID_MESSAGE/,
    );
  } finally {
    clearTimeout(deadline!);
  }
  assert.equal(client.awaitingConfirmation, false);
  assert.equal(persisted, null);
  assert.equal(client.status, 'connected');
  assert.equal(client.state!.revision, 0);
  await assert.rejects(client.action({ kind: 'road', edge: 72 }), /ILLEGAL_ACTION/);
  assert.equal(client.awaitingConfirmation, false);
  const accepted = await client.settings({ turnTimerSeconds: 65 });
  assert.equal(accepted.revision, 1);
  assert.equal(client.state!.settings!.turnTimerSeconds, 65);
  assert.equal(server.store.db.prepare('SELECT COUNT(*) AS n FROM settings_receipts').get()!.n, 1);
  assert.equal(server.store.db.prepare('SELECT COUNT(*) AS n FROM game_receipts').get()!.n, 0);
});
