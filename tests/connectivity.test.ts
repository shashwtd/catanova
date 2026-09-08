import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import type { ServerMessage } from '../packages/protocol/src/index.js';

const token = () => randomBytes(32).toString('hex');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label = 'condition') {
  const deadline = Date.now() + 8000;
  while (!check()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await delay(10); }
}
async function peer(url: string) {
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  ws.on('message', data => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await once(ws, 'open');
  return {
    ws, messages,
    send: (message: unknown) => ws.send(JSON.stringify(message)),
    async take(type: ServerMessage['type']) {
      await until(() => messages.some(m => m.type === type), `message ${type}`);
      const index = messages.findIndex(m => m.type === type);
      return messages.splice(index, 1)[0]!;
    },
    async enter(type: 'create' | 'join' | 'resume', seatToken = token(), roomId?: string) {
      ws.send(JSON.stringify({ type, version: 1, token: seatToken, name: 'Test player', roomId }));
      const result = await this.take('welcome');
      assert.equal(result.type, 'welcome');
      return { ...result, token: seatToken };
    },
  };
}

test('real WebSocket clients share committed state; rooms are isolated; retries apply once', async t => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  t.after(() => server.close());
  const a = await peer(server.url); const first = await a.enter('create');
  const b = await peer(server.url); await b.enter('join', token(), first.state.roomId);
  const other = await peer(server.url); await other.enter('create');
  a.messages.length = 0; b.messages.length = 0; other.messages.length = 0;
  a.send({ type: 'increment', commandId: 'command-0001', expectedRevision: 0 });
  const ack = await a.take('ack'); assert.equal(ack.type, 'ack'); assert.equal(ack.counter, 1);
  await until(() => b.messages.some(m => m.type === 'state' && m.state.counter === 1));
  assert.equal(other.messages.some(m => m.type === 'state' && m.state.counter !== 0), false);
  a.send({ type: 'increment', commandId: 'command-0001', expectedRevision: 0 });
  const duplicate = await a.take('ack'); assert.equal(duplicate.type, 'ack');
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.counter, 1);
  a.send({ type: 'increment', commandId: 'command-0001', expectedRevision: 1 });
  const reused = await a.take('error'); assert.equal(reused.type, 'error'); assert.equal(reused.code, 'COMMAND_REUSED');
  b.send({ type: 'increment', commandId: 'command-0002', expectedRevision: 0 });
  const stale = await b.take('error'); assert.equal(stale.type, 'error'); assert.equal(stale.code, 'STALE_STATE');
  assert.equal(server.store.snapshot(first.state.roomId).counter, 1);
  // Public snapshots never serialize authentication credentials.
  assert.equal(JSON.stringify(b.messages).includes(first.token), false);
  assert.equal(JSON.stringify(b.messages).includes('token_hash'), false);
});

test('malformed messages, unauthenticated moves, room capacity, invalid resumes and origins are rejected', async t => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  t.after(() => server.close());
  const a = await peer(server.url);
  a.ws.send('not-json'); const malformed = await a.take('error'); assert.equal(malformed.type, 'error'); assert.equal(malformed.code, 'INVALID_MESSAGE');
  a.send({ type: 'increment', commandId: 'command-0001', expectedRevision: 0 });
  const unauthenticated = await a.take('error'); assert.equal(unauthenticated.type, 'error'); assert.equal(unauthenticated.code, 'NOT_JOINED');
  const first = await a.enter('create');
  for (let i = 0; i < 3; i++) { const next = await peer(server.url); await next.enter('join', token(), first.state.roomId); }
  const fifth = await peer(server.url);
  fifth.send({ type: 'join', version: 1, name: 'Fifth', token: token(), roomId: first.state.roomId });
  const full = await fifth.take('error'); assert.equal(full.type, 'error'); assert.equal(full.code, 'ROOM_FULL');
  fifth.send({ type: 'resume', version: 1, name: 'Fake', token: token(), roomId: first.state.roomId });
  const invalid = await fifth.take('error'); assert.equal(invalid.type, 'error'); assert.equal(invalid.code, 'INVALID_SESSION');
  const forbidden = new WebSocket(server.url, { origin: 'https://untrusted.example' });
  const error = await new Promise<Error>(resolve => forbidden.once('error', resolve));
  assert.match(error.message, /403/);
});

test('reconnecting a seat immediately revokes the old socket and uses no extra seat', async t => {
  const server = await startServer({ port: 0, databasePath: ':memory:' }); t.after(() => server.close());
  const a = await peer(server.url); const first = await a.enter('create');
  const resumed = await peer(server.url);
  const welcome = await resumed.enter('resume', first.token, first.state.roomId);
  assert.equal(welcome.playerId, first.playerId); assert.equal(welcome.state.players.length, 1);
  await until(() => a.ws.readyState === WebSocket.CLOSED);
  resumed.send({ type: 'increment', commandId: 'command-0001', expectedRevision: 0 });
  const ack = await resumed.take('ack'); assert.equal(ack.type, 'ack'); assert.equal(ack.counter, 1);
});

test('failed database write is never acknowledged or applied', async t => {
  const server = await startServer({ port: 0, databasePath: ':memory:' }); t.after(() => server.close());
  const a = await peer(server.url); const first = await a.enter('create');
  server.store.db.exec('PRAGMA query_only = ON');
  a.send({ type: 'increment', commandId: 'command-0001', expectedRevision: 0 });
  const error = await a.take('error'); assert.equal(error.type, 'error'); assert.equal(error.code, 'STORAGE_ERROR');
  assert.equal(a.messages.some(m => m.type === 'ack'), false);
  assert.equal(server.store.snapshot(first.state.roomId).counter, 0);
});

test('browser-compatible client automatically reconnects and restores its seat after server restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-reconnect-'));
  const path = join(directory, 'probe.sqlite');
  let server = await startServer({ port: 0, databasePath: path });
  const port = server.port;
  const client = new Connection(server.url, newSession('Reconnecting'), { minRetryMs: 30, maxRetryMs: 100 });
  t.after(async () => { client.stop(); await server.close(); await rm(directory, { recursive: true, force: true }); });
  client.start(); await until(() => client.status === 'connected');
  await client.increment(); await until(() => client.state?.counter === 1);
  const playerId = client.playerId;
  await server.close(); await until(() => client.status === 'reconnecting');
  server = await startServer({ port, databasePath: path });
  await until(() => client.status === 'connected');
  assert.equal(client.playerId, playerId); assert.equal(client.state!.counter, 1); assert.equal(client.state!.players.length, 1);
  await client.increment(); await until(() => client.state?.counter === 2);
});

test('SIGKILL recovery preserves accepted state and durable duplicate receipts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-crash-'));
  const path = join(directory, 'probe.sqlite');
  const children: ReturnType<typeof spawn>[] = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  });
  async function boot() {
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATABASE_PATH: path }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = ''; let errors = '';
    child.stdout!.on('data', chunk => { output += String(chunk); }); child.stderr!.on('data', chunk => { errors += String(chunk); });
    await until(() => output.includes('"listening"') || child.exitCode !== null, 'child process starts');
    if (!output.includes('"listening"')) throw new Error(errors);
    const info = JSON.parse(output.trim().split('\n')[0]!) as { port: number };
    return { child, url: `ws://127.0.0.1:${info.port}/ws` };
  }
  const initial = await boot(); const a = await peer(initial.url); const first = await a.enter('create');
  a.send({ type: 'increment', commandId: 'durable-command-1', expectedRevision: 0 });
  await a.take('ack');
  initial.child.kill('SIGKILL'); await once(initial.child, 'exit');
  const replacement = await boot(); const b = await peer(replacement.url);
  const welcome = await b.enter('resume', first.token, first.state.roomId);
  assert.equal(welcome.playerId, first.playerId); assert.equal(welcome.state.counter, 1);
  b.send({ type: 'increment', commandId: 'durable-command-1', expectedRevision: 0 });
  const ack = await b.take('ack'); assert.equal(ack.type, 'ack'); assert.equal(ack.duplicate, true); assert.equal(ack.counter, 1);
  b.ws.terminate();
});

test('lost handshake and action replies can be retried without creating a seat or applying twice', async t => {
  const server = await startServer({ port: 0, databasePath: ':memory:' }); t.after(() => server.close());
  const seatToken = token();
  const a = await peer(server.url); const first = await a.enter('create', seatToken);
  a.ws.terminate();
  // Client retries CREATE because it did not retain the first welcome reply.
  const retry = await peer(server.url); const welcome = await retry.enter('create', seatToken);
  assert.equal(welcome.playerId, first.playerId); assert.equal(welcome.state.roomId, first.state.roomId);
  assert.equal(welcome.state.players.length, 1);
  // Discard all incoming replies at the client application, then lose the connection.
  retry.ws.removeAllListeners('message');
  retry.send({ type: 'increment', commandId: 'lost-reply-command', expectedRevision: 0 });
  await until(() => server.store.snapshot(first.state.roomId).counter === 1);
  retry.ws.terminate();
  const restored = await peer(server.url); await restored.enter('resume', seatToken, first.state.roomId);
  restored.send({ type: 'increment', commandId: 'lost-reply-command', expectedRevision: 0 });
  const ack = await restored.take('ack'); assert.equal(ack.type, 'ack'); assert.equal(ack.duplicate, true);
  assert.equal(ack.counter, 1); assert.equal(server.store.snapshot(first.state.roomId).revision, 1);
});

test('two simultaneous commands against one revision cannot both apply', async t => {
  const server = await startServer({ port: 0, databasePath: ':memory:' }); t.after(() => server.close());
  const a = await peer(server.url); const first = await a.enter('create');
  const b = await peer(server.url); await b.enter('join', token(), first.state.roomId);
  a.messages.length = 0; b.messages.length = 0;
  a.send({ type: 'increment', commandId: 'concurrent-one', expectedRevision: 0 });
  b.send({ type: 'increment', commandId: 'concurrent-two', expectedRevision: 0 });
  await until(() => [...a.messages, ...b.messages].filter(m => m.type === 'ack' || m.type === 'error').length === 2);
  const responses = [...a.messages, ...b.messages];
  assert.equal(responses.filter(m => m.type === 'ack').length, 1);
  assert.equal(responses.filter(m => m.type === 'error' && m.code === 'STALE_STATE').length, 1);
  assert.equal(server.store.snapshot(first.state.roomId).counter, 1);
});

test('heartbeat closes a half-open connection that no longer responds', async t => {
  const server = await startServer({ port: 0, databasePath: ':memory:', heartbeatMs: 25 }); t.after(() => server.close());
  const silent = new WebSocket(server.url, { autoPong: false });
  await once(silent, 'open');
  await until(() => silent.readyState === WebSocket.CLOSED, 'dead connection is detected');
});
