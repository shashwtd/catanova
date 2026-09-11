import { readyLobby } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import { startServer } from '../apps/server/src/server.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import {
  invitationCode,
  roomPath,
  shouldResume,
  safeEntryPath,
  visibleRoomCode,
} from '../apps/client/src/navigation.js';
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

test('short room entry and permanent links survive auth without exposing internal IDs as codes', () => {
  const id = '9bfec3ad-0a2c-47d1-bfe5-735a3e2dc25f';
  assert.equal(invitationCode('/room/ab2c', ''), 'AB2C');
  assert.equal(invitationCode('/', '?room=ab2c'), 'AB2C');
  assert.equal(invitationCode(roomPath(id.toUpperCase()), ''), id);
  for (const reference of ['AB2C', 'ABCD2345', id]) {
    assert.equal(safeEntryPath(`/room/${reference.toLowerCase()}?ignored=1`), roomPath(reference));
  }
  for (const invalid of [
    '//evil.test/room/AB2C',
    'https://evil.test/room/AB2C',
    '/room/AB2C/extra',
    '/room/A01O',
    '/room/..%2f..',
    '/room/AB2C#//evil.test',
  ]) {
    assert.equal(safeEntryPath(invalid), '/');
  }
  assert.equal(visibleRoomCode({ roomId: id, roomCode: 'AB2C' }), 'AB2C');
  assert.equal(visibleRoomCode(null, id), null);
  assert.equal(visibleRoomCode({ roomId: id }), null);
  assert.equal(visibleRoomCode({ roomId: 'ABCD2345' }), 'ABCD2345');
  const saved = { ...newSession('Player', id), joined: true };
  assert.equal(shouldResume(saved, id.toUpperCase()), true);
  assert.equal(
    shouldResume(saved, 'AB2C'),
    false,
    'a reusable alias cannot silently resume an unrelated permanent seat',
  );
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
  assert.deepEqual(Object.keys(before).sort(), [
    'board',
    'players',
    'roomCode',
    'roomId',
    'settings',
    'started',
  ]);
  assert.deepEqual(Object.keys(before.players[0]!).sort(), ['id', 'name', 'profile', 'ready']);
  assert.ok(!JSON.stringify(before).includes(s.token));
  await server.close();
  server = await startServer({ port: 0, databasePath: path });
  assert.deepEqual(await preview(), before);
  server.store.action(host, 'start-from-preview', readyLobby(server.store, host.room_id), { kind: 'start' });
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
  assert.throws(() => store.enter('resume', session.token, session.name, host.room_id), /permanently left/);
  assert.deepEqual(store.leave(host, 'leave-this-lobby', 1), { ...receipt, duplicate: true });
  assert.throws(() => store.leave(host, 'leave-this-lobby', 2), /different intent/);
  assert.throws(() => store.leave(host, 'earlier-accepted-command', 2), /already used/);
  const newSeat = newSession('Replacement');
  store.enter('join', newSeat.token, newSeat.name, host.room_id);
  assert.equal(store.snapshot(host.room_id).players.length, 4);
  store.action(seats[1]!, 'new-host-starts', readyLobby(store, host.room_id), { kind: 'start' });
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

test('intentional leave stops reconnecting and permanently resigns a live seat without removing its board pieces', async (t) => {
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
  for (const c of clients.filter((c) => c.session.roomId === host.session.roomId)) await c.lobby(true);
  await until(() => host.state!.players.every((p) => p.ready));
  await host.action({ kind: 'start' });
  await until(() => !!host.state?.game);
  const saved = structuredClone(server.store.loadGame(host.session.roomId!)!);
  const left = await host.leave();
  assert.equal(left.released, true);
  await until(() => host.status === 'closed');
  assert.equal(server.store.snapshot(host.session.roomId!).players.length, 3);
  const after = server.store.loadGame(host.session.roomId!)!;
  assert.equal(after.players.find((p) => p.id === host.playerId)!.resigned, true);
  assert.deepEqual(after.roads, saved.roads);
  assert.deepEqual(after.buildings, saved.buildings);
  assert.equal(after.winner, null, 'two remaining players continue');
  const resumed = new Connection(server.url, { ...host.session });
  clients.push(resumed);
  let resumeError = '';
  resumed.subscribe((message) => {
    if (message.type === 'error') resumeError = message.code;
  });
  resumed.start();
  await until(() => resumeError === 'SEAT_LEFT');
  assert.equal(resumed.status, 'closed');
  assert.deepEqual(server.store.loadGame(host.session.roomId!), after);
});
