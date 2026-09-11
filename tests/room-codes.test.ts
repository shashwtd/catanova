import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { Store, ROOM_CODE_LEASE_MS } from '../apps/server/src/store.js';
import { startServer } from '../apps/server/src/server.js';
import { RoomAccessLimit, roomClientAddress } from '../apps/server/src/room-access.js';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import {
  isRoomReference,
  normalizeRoomReference,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../packages/protocol/src/room-reference.js';
import { readyLobby } from './helpers.js';

const token = () => randomBytes(32).toString('hex');
const create = (store: Store, name = 'Captain') => {
  const seatToken = token();
  return { seat: store.enter('create', seatToken, name), token: seatToken };
};
const expiry = (store: Store, id: string) =>
  store.db.prepare('SELECT expires_at FROM room_codes WHERE room_id=?').get(id)?.expires_at;

test('room references accept friendly aliases, old links and permanent IDs without ambiguous new-code characters', () => {
  assert.equal(ROOM_CODE_ALPHABET.length, 32);
  assert.equal(ROOM_CODE_LENGTH, 4);
  for (const [input, canonical] of [
    [' ab2z ', 'AB2Z'],
    ['abcd2345', 'ABCD2345'],
    ['A0123456-ABCD-4321-ABCD-0123456789AB', 'a0123456-abcd-4321-abcd-0123456789ab'],
  ]) {
    assert.equal(normalizeRoomReference(input!), canonical);
    assert.ok(isRoomReference(canonical));
    assert.equal(
      (
        parseClientMessage(
          JSON.stringify({ type: 'join', version: 1, token: token(), name: 'Player', roomId: input }),
        ) as { roomId: string }
      ).roomId,
      canonical,
    );
  }
  for (const bad of [
    'ABC',
    'ABCDE',
    'O123',
    'AB0D',
    'AB1D',
    'ABID',
    'ABOD',
    'AB D',
    '../../data',
    null,
    1234,
  ]) {
    assert.equal(isRoomReference(bad), false);
    assert.throws(() =>
      parseClientMessage(
        JSON.stringify({ type: 'join', version: 1, token: token(), name: 'Player', roomId: bad }),
      ),
    );
  }
  assert.ok(isRoomReference('IOAB2345'), 'ambiguous letters remain valid in legacy eight-character IDs');
});

test('new rooms use stable UUIDs with unique friendly aliases, bounded collisions and no lifetime 1000-room ceiling', (t) => {
  const draws: number[] = [];
  const store = new Store(':memory:', {
    codeRandom: (max) => {
      draws.push(max);
      return 0;
    },
  });
  t.after(() => store.close());
  store.db.exec('BEGIN');
  for (let i = 0; i < 1000; i++) store.db.prepare('INSERT INTO rooms(id) VALUES(?)').run(`saved-${i}`);
  store.db.exec('COMMIT');
  const first = create(store);
  const second = create(store, 'Builder');
  assert.match(first.seat.room_id, /^[a-f0-9-]{36}$/);
  assert.equal(store.roomCode(first.seat.room_id), 'AAAA');
  assert.equal(
    store.roomCode(second.seat.room_id),
    'AAAB',
    'fallback finds an available slot after bounded random collisions',
  );
  assert.equal(draws.length, 33);
  assert.ok(draws.every((max) => max === 32 ** 4));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM rooms').get()!.n, 1002);
  assert.equal(store.preview('aaaa').roomId, first.seat.room_id);
  const guest = store.enter('join', token(), 'Guest', 'aaaa');
  assert.equal(guest.room_id, first.seat.room_id);
});

test('inactive codes expire without deleting games; preview/failure cannot renew, and recycled codes never redirect saved sessions', (t) => {
  let now = 1000;
  const store = new Store(':memory:', { now: () => now, codeRandom: () => 0 });
  t.after(() => store.close());
  const first = create(store);
  const oldId = first.seat.room_id;
  const oldCode = store.roomCode(oldId)!;
  for (const name of ['Second', 'Third', 'Fourth']) store.enter('join', token(), name, oldId);
  store.increment(first.seat, 'accepted-before-expiry', 0);
  const lease = expiry(store, oldId);
  now += ROOM_CODE_LEASE_MS - 1;
  assert.equal(store.preview(oldCode).roomId, oldId);
  assert.equal(store.preview(oldId).roomCode, oldCode);
  assert.equal(expiry(store, oldId), lease);
  assert.throws(() => store.enter('join', token(), 'Fifth', oldCode), /four seats/);
  assert.equal(expiry(store, oldId), lease, 'failed admission never refreshes a lease');
  now++;
  assert.throws(() => store.preview(oldCode), /Room not found/);
  assert.equal(store.preview(oldId).roomCode, undefined);
  assert.equal(store.expireRoom(oldId), false);
  assert.equal(expiry(store, oldId), lease);
  const second = create(store, 'New host');
  assert.equal(store.roomCode(second.seat.room_id), oldCode);
  assert.equal(store.preview(oldCode).roomId, second.seat.room_id);
  assert.throws(() => store.enter('resume', first.token, 'Captain', oldCode), /another room/);
  assert.equal(store.snapshot(oldId).counter, 1);
  const resumed = store.enter('resume', first.token, 'Captain', oldId);
  assert.equal(resumed.id, first.seat.id);
  assert.equal(resumed.room_id, oldId);
  assert.equal(store.roomCode(oldId), 'AAAB');
  assert.equal(store.increment(resumed, 'accepted-before-expiry', 0).duplicate, true);
  assert.equal(store.snapshot(oldId).counter, 1);
  assert.equal(store.preview(oldCode).roomId, second.seat.room_id);
});

test('legacy eight-character games gain aliases lazily after restart without changing receipts, identities or history', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-legacy-code-'));
  const path = join(directory, 'game.sqlite');
  let store = new Store(path, { codeRandom: () => 0 });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const legacyId = 'ABCD2345';
  const seatToken = token();
  store.db.prepare('INSERT INTO rooms(id) VALUES(?)').run(legacyId);
  store.db
    .prepare('INSERT INTO seats(id,room_id,token_hash,name) VALUES(?,?,?,?)')
    .run('legacy-seat', legacyId, createHash('sha256').update(seatToken).digest('hex'), 'Captain');
  store.enter('join', token(), 'Builder', legacyId);
  const host = { id: 'legacy-seat', room_id: legacyId, name: 'Captain' };
  const revision = readyLobby(store, legacyId);
  const started = store.action(host, 'legacy-game-start', revision, { kind: 'start' });
  const saved = structuredClone(store.loadGame(legacyId));
  const history = store.history(legacyId);
  store.db.exec('DROP TABLE room_codes');
  store.close();
  store = new Store(path, { codeRandom: () => 0 });
  assert.equal(
    store.preview(legacyId).roomCode,
    undefined,
    'old-link preview does not allocate or renew a lease',
  );
  const resumed = store.enter('resume', seatToken, 'Captain', legacyId);
  assert.equal(resumed.id, host.id);
  assert.equal(resumed.room_id, legacyId);
  assert.equal(store.roomCode(legacyId), 'AAAA');
  assert.equal(store.preview('AAAA').roomId, legacyId);
  assert.deepEqual(store.loadGame(legacyId), saved);
  assert.deepEqual(store.history(legacyId), history);
  assert.deepEqual(store.action(host, 'legacy-game-start', revision, { kind: 'start' }), {
    ...started,
    duplicate: true,
  });
});

function requestFrom(peer: string, forwarded?: string) {
  return {
    socket: { remoteAddress: peer },
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  } as IncomingMessage;
}
test('room lookup limits trust forwarded addresses only from explicitly configured proxy peers, and stay bounded', () => {
  assert.equal(roomClientAddress()(requestFrom('::ffff:127.0.0.1', '198.51.100.1')), '127.0.0.1');
  const address = roomClientAddress(['172.18.0.0/16', '2001:db8:1::/64']);
  assert.equal(address(requestFrom('172.18.0.3', '203.0.113.99, 198.51.100.4')), '198.51.100.4');
  assert.equal(address(requestFrom('203.0.113.5', '198.51.100.4')), '203.0.113.5');
  assert.equal(address(requestFrom('172.18.0.3', '198.51.100.4, invalid')), '172.18.0.3');
  assert.equal(address(requestFrom('2001:db8:1::3', '2001:db8:2::8')), '2001:db8:2::8');
  for (const cidr of ['0.0.0.0/0', '172.18.0.0', '172.18.0.0/33', 'not-an-ip/24'])
    assert.throws(() => roomClientAddress([cidr]));
  const limit = new RoomAccessLimit(2, 1000, 2);
  assert.equal(limit.consume('a', 0).allowed, true);
  assert.equal(limit.consume('a', 0).allowed, true);
  assert.deepEqual(limit.consume('a', 0), { allowed: false, retryAfter: 1 });
  assert.equal(limit.consume('b', 0).allowed, true);
  assert.equal(
    limit.consume('c', 0).allowed,
    false,
    'a flood of unique addresses cannot grow the map without bound',
  );
  assert.equal(limit.consume('c', 1000).allowed, true);
});

test('public short-code lookups expose canonical IDs but cannot keep leases alive or bypass throttling with forged forwarding headers', async (t) => {
  let now = 1000;
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    auth: null,
    now: () => now,
    trustedProxyCidrs: [],
  });
  t.after(() => server.close());
  const host = create(server.store);
  const code = server.store.roomCode(host.seat.room_id)!;
  const lease = expiry(server.store, host.seat.room_id);
  now += 1000;
  const url = `http://127.0.0.1:${server.port}/api/rooms/${code.toLowerCase()}`;
  for (let i = 0; i < 60; i++) {
    const response = await fetch(url, { headers: { 'x-forwarded-for': `198.51.100.${i}` } });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.roomId, host.seat.room_id);
    assert.equal(preview.roomCode, code);
    assert.ok(!JSON.stringify(preview).includes('token'));
  }
  const limited = await fetch(url, { headers: { 'x-forwarded-for': '203.0.113.200' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(expiry(server.store, host.seat.room_id), lease);
  now += 60000;
  assert.equal((await fetch(url)).status, 200);
});

async function wire(url: string) {
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(String(data))));
  await once(ws, 'open');
  return {
    ws,
    async send(message: unknown, type: string) {
      ws.send(JSON.stringify(message));
      const deadline = Date.now() + 5000;
      while (!messages.some((value) => value.type === type)) {
        if (Date.now() > deadline) throw new Error(`Missing ${type}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return messages.splice(
        messages.findIndex((value) => value.type === type),
        1,
      )[0];
    },
  };
}
test('wire clients join by short code, retain permanent IDs, and admission throttling leaves accepted gameplay intact', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:', auth: null, trustedProxyCidrs: [] });
  t.after(() => server.close());
  const host = await wire(server.url);
  const hostToken = token();
  const welcome = await host.send(
    { type: 'create', version: 1, token: hostToken, name: 'Captain' },
    'welcome',
  );
  assert.match(welcome.state.roomId, /^[a-f0-9-]{36}$/);
  assert.match(welcome.state.roomCode, /^[A-HJ-NP-Z2-9]{4}$/);
  const guest = await wire(server.url);
  const joined = await guest.send(
    {
      type: 'join',
      version: 1,
      token: token(),
      name: 'Builder',
      roomId: welcome.state.roomCode.toLowerCase(),
    },
    'welcome',
  );
  assert.equal(joined.state.roomId, welcome.state.roomId);
  const missing = welcome.state.roomCode === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
  for (let i = 0; i < 29; i++) {
    const attempt = await wire(server.url);
    const result = await attempt.send(
      { type: 'join', version: 1, token: token(), name: 'Attempt', roomId: missing },
      'error',
    );
    assert.equal(result.code, i < 28 ? 'ROOM_NOT_FOUND' : 'ROOM_RATE_LIMIT');
    attempt.ws.close();
  }
  const ack = await host.send(
    { type: 'increment', commandId: 'accepted-after-limit', expectedRevision: 0 },
    'ack',
  );
  assert.equal(ack.counter, 1);
  assert.equal(server.store.snapshot(welcome.state.roomId).counter, 1);
  const reconnected = await wire(server.url);
  const resumed = await reconnected.send(
    { type: 'resume', version: 1, token: hostToken, name: 'Captain', roomId: welcome.state.roomId },
    'welcome',
  );
  assert.equal(resumed.playerId, welcome.playerId, 'exhausted guessing bucket must not strand a saved seat');
  assert.equal(resumed.state.counter, 1);
  const impostor = await wire(server.url);
  const rejected = await impostor.send(
    { type: 'resume', version: 1, token: token(), name: 'Impostor', roomId: welcome.state.roomId },
    'error',
  );
  assert.equal(rejected.code, 'INVALID_SESSION', 'resume exemption never skips owned-seat validation');
});
