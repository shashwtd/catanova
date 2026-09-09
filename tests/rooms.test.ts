import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { invitationCode, roomPath, shouldResume } from '../apps/client/src/navigation.js';
import type { RoomPreview } from '../packages/protocol/src/index.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Room state timed out');
    await pause(10);
  }
}

test('an explicit invite wins over an unrelated saved seat and supports legacy links', () => {
  const saved = { ...newSession('Player', 'ABCD2345'), joined: true };
  assert.equal(invitationCode('/room/bcde3456/', ''), 'BCDE3456');
  assert.equal(invitationCode('/', '?room=bcde3456'), 'BCDE3456');
  assert.equal(invitationCode(roomPath('BCDE3456'), '?room=ABCD2345'), 'BCDE3456');
  assert.equal(invitationCode('/', ''), null);
  assert.equal(shouldResume(saved, 'BCDE3456'), false);
  assert.equal(shouldResume(saved, 'ABCD2345'), true);
  assert.equal(shouldResume(saved, null), true);
  assert.equal(shouldResume({ ...saved, token: 'broken' }, null), false);
});

test('invite previews expose the exact persisted board without private game state', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'catanova-invite-'));
  const path = join(dir, 'rooms.sqlite');
  let server = await startServer({ port: 0, databasePath: path });
  t.after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const s = newSession('Host');
  const host = server.store.enter('create', s.token, s.name);
  for (const name of ['Second', 'Third']) {
    const next = newSession(name);
    server.store.enter('join', next.token, name, host.room_id);
  }
  async function preview() {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/rooms/${host.room_id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return (await response.json()) as RoomPreview;
  }
  const before = await preview();
  assert.equal(before.started, false);
  assert.equal(before.players.length, 3);
  assert.deepEqual(Object.keys(before).sort(), ['board', 'players', 'roomId', 'started']);
  assert.deepEqual(Object.keys(before.players[0]!).sort(), ['id', 'name']);
  assert.ok(!JSON.stringify(before).includes(s.token));
  await server.close();
  server = await startServer({ port: 0, databasePath: path });
  assert.deepEqual(await preview(), before);
  server.store.action(host, 'start-from-preview', 0, { kind: 'start' });
  const game = server.store.loadGame(host.room_id)!;
  assert.deepEqual(game.board, before.board);
  const during = await preview();
  assert.equal(during.started, true);
  assert.deepEqual(during.board, before.board);
  assert.ok(!JSON.stringify(during).includes('"hand"'));
  assert.ok(!JSON.stringify(during).includes('"deck"'));
  const missing = await fetch(`http://127.0.0.1:${server.port}/api/rooms/ZZZZZZZZ`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Room not found' });
  await server.close();
  server = await startServer({ port: 0, databasePath: path });
  assert.deepEqual((await preview()).board, before.board);
  assert.deepEqual(server.store.loadGame(host.room_id), game);
});

test('lobby leave frees capacity, transfers hosting and revokes the old seat without erasing receipts', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const session = newSession('Host');
  const host = store.enter('create', session.token, session.name);
  const seats = [host];
  for (const name of ['Second', 'Third', 'Fourth']) {
    const next = newSession(name);
    seats.push(store.enter('join', next.token, name, host.room_id));
  }
  const board = store.preview(host.room_id).board;
  store.increment(host, 'earlier-accepted-command', 0);
  assert.throws(() => store.leave(host, 'leave-old-revision', 0), /room changed/);
  assert.equal(store.snapshot(host.room_id).players.length, 4);
  const receipt = store.leave(host, 'leave-this-lobby', 1);
  assert.equal(receipt.released, true);
  assert.equal(receipt.revision, 2);
  assert.equal(store.snapshot(host.room_id).players[0]!.id, seats[1]!.id);
  assert.equal(store.snapshot(host.room_id).players.length, 3);
  assert.throws(() => store.enter('resume', session.token, session.name, host.room_id), /left this lobby/);
  assert.deepEqual(store.leave(host, 'leave-this-lobby', 1), { ...receipt, duplicate: true });
  assert.throws(() => store.leave(host, 'leave-this-lobby', 2), /different intent/);
  assert.throws(() => store.leave(host, 'earlier-accepted-command', 2), /already used/);
  const newSeat = newSession('Replacement');
  store.enter('join', newSeat.token, newSeat.name, host.room_id);
  assert.equal(store.snapshot(host.room_id).players.length, 4);
  store.action(seats[1]!, 'new-host-starts', 2, { kind: 'start' });
  assert.deepEqual(store.loadGame(host.room_id)!.board, board);
  assert.equal(
    store.loadGame(host.room_id)!.players.some((p) => p.id === host.id),
    false,
  );
});

test('failed lobby leave is rolled back and can be retried with the same command', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const s = newSession('Host');
  const host = store.enter('create', s.token, s.name);
  store.db.exec(
    "CREATE TEMP TRIGGER fail_leave BEFORE INSERT ON leave_receipts BEGIN SELECT RAISE(ABORT, 'Simulated receipt failure'); END",
  );
  assert.throws(() => store.leave(host, 'durable-leave-command', 0));
  assert.equal(store.snapshot(host.room_id).players.length, 1);
  assert.equal(store.snapshot(host.room_id).revision, 0);
  store.db.exec('DROP TRIGGER fail_leave');
  assert.equal(store.leave(host, 'durable-leave-command', 0).released, true);
  assert.equal(store.snapshot(host.room_id).players.length, 0);
});

test('intentional leave stops reconnecting; active-game seats and state remain resumable', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
  });
  async function connect(name: string, roomId?: string) {
    const c = new Connection(server.url, newSession(name, roomId), { minRetryMs: 10, maxRetryMs: 20 });
    clients.push(c);
    c.start();
    await until(() => c.status === 'connected');
    return c;
  }
  const lobby = await connect('Lobby host');
  const lobbyId = lobby.session.roomId!;
  const acknowledgement = await lobby.leave();
  assert.equal(acknowledgement.released, true);
  await until(() => lobby.status === 'closed');
  await pause(100);
  assert.equal(lobby.status, 'closed');
  assert.equal(server.store.snapshot(lobbyId).players.length, 0);
  const host = await connect('Host');
  await connect('Second', host.session.roomId);
  await connect('Third', host.session.roomId);
  await until(() => host.state?.players.length === 3);
  await host.action({ kind: 'start' });
  await until(() => !!host.state?.game);
  const saved = structuredClone(server.store.loadGame(host.session.roomId!)!);
  const left = await host.leave();
  assert.equal(left.released, false);
  await until(() => host.status === 'closed');
  assert.equal(server.store.snapshot(host.session.roomId!).players.length, 3);
  assert.deepEqual(server.store.loadGame(host.session.roomId!), saved);
  const resumed = new Connection(server.url, { ...host.session });
  clients.push(resumed);
  resumed.start();
  await until(() => resumed.status === 'connected');
  assert.equal(resumed.playerId, host.playerId);
  assert.equal(resumed.state!.revision, left.revision);
  assert.deepEqual(server.store.loadGame(host.session.roomId!), saved);
});
