import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { Store } from '../apps/server/src/store.js';
import type { Identity } from '../apps/server/src/auth.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { PROTOCOL_VERSION } from '../packages/protocol/src/index.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 6000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await pause(5);
  }
}
/** Resolves to 'open' or the HTTP status the upgrade was refused with. */
function dial(url: string): Promise<{ ws: WebSocket; outcome: 'open' | number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve({ ws, outcome: 'open' }));
    ws.once('unexpected-response', (_request, response) =>
      resolve({ ws, outcome: response.statusCode ?? 0 }),
    );
    ws.once('error', () => resolve({ ws, outcome: 0 }));
  });
}
const identity = (id: string): Identity => ({ id, name: id, expiresAt: Date.now() + 3_600_000 });

test('one address cannot hold the server with sockets that never join, while joined players are unaffected', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  const sockets: WebSocket[] = [];
  const clients: Connection[] = [];
  t.after(async () => {
    sockets.forEach((ws) => ws.terminate());
    clients.forEach((c) => c.stop());
    await server.close();
  });
  // Players who join do not count against their address.
  for (let i = 0; i < 14; i++) {
    const c = new Connection(server.url, newSession(`Player${i}`));
    clients.push(c);
    c.start();
    await until(() => c.status === 'connected');
  }
  // Idle sockets do, up to a small allowance.
  const outcomes: (number | 'open')[] = [];
  for (let i = 0; i < 14; i++) {
    const { ws, outcome } = await dial(server.url);
    sockets.push(ws);
    outcomes.push(outcome);
  }
  assert.equal(outcomes.filter((o) => o === 'open').length, 12);
  assert.deepEqual(outcomes.slice(12), [429, 429]);
  // Joining frees the allowance for the next socket.
  const first = sockets[0]!;
  first.send(
    JSON.stringify({
      type: 'create',
      version: PROTOCOL_VERSION,
      token: newSession('Late').token,
      name: 'Late',
    }),
  );
  await new Promise((resolve) => first.once('message', resolve));
  const { ws: next, outcome } = await dial(server.url);
  sockets.push(next);
  assert.equal(outcome, 'open');
});

test('saved-seat resumes are limited too, so a stream of them cannot hammer the sign-in service', async (t) => {
  let checks = 0;
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    verifyIdentity: async () => {
      checks++;
      return identity('someone');
    },
  });
  t.after(() => server.close());
  const refusals: string[] = [];
  for (let i = 0; i < 125; i++) {
    const { ws } = await dial(server.url);
    ws.send(
      JSON.stringify({
        type: 'resume',
        version: PROTOCOL_VERSION,
        token: newSession('x').token,
        name: 'x',
        roomId: '00000000-0000-4000-8000-000000000000',
        accessToken: 'token',
      }),
    );
    const reply = JSON.parse(String(await new Promise((resolve) => ws.once('message', resolve))));
    if (reply.code === 'ROOM_RATE_LIMIT') refusals.push(reply.code);
    ws.terminate();
  }
  assert.equal(checks, 120, 'no more than the allowance reached the sign-in check');
  assert.equal(refusals.length, 5);
});

test('creating a room leaves your previous empty lobby, which gives back its code and island', () => {
  const store = new Store(':memory:');
  try {
    const first = store.enter('create', newSession('A').token, 'A', undefined, identity('alice'));
    const code = store.roomCode(first.room_id)!;
    assert.ok(code);
    const second = store.enter('create', newSession('A').token, 'A', undefined, identity('alice'));
    assert.notEqual(second.room_id, first.room_id);
    assert.equal(store.roomCode(first.room_id), undefined, 'the abandoned lobby released its code');
    assert.equal(store.db.prepare('SELECT 1 FROM room_boards WHERE room_id=?').get(first.room_id), undefined);
    assert.deepEqual(store.snapshot(first.room_id).players, []);
    // A lobby somebody else has joined is not somebody's to abandon on their own.
    store.enter('join', newSession('B').token, 'B', second.room_id, identity('bob'));
    store.enter('create', newSession('A').token, 'A', undefined, identity('alice'));
    assert.ok(store.roomCode(second.room_id));
    assert.equal(store.snapshot(second.room_id).players.length, 2);
  } finally {
    store.close();
  }
});

test('the last person leaving a lobby that never started releases its code; a room that has played keeps it', () => {
  const store = new Store(':memory:');
  try {
    const a = newSession('A'),
      b = newSession('B');
    const host = store.enter('create', a.token, 'A', undefined, identity('alice'));
    const guest = store.enter('join', b.token, 'B', host.room_id, identity('bob'));
    store.lobby(
      host,
      'add-bot-one',
      store.snapshot(host.room_id).revision,
      false,
      undefined,
      undefined,
      true,
    );
    store.leave(guest, 'bob-leaves', store.snapshot(host.room_id).revision);
    assert.ok(store.roomCode(host.room_id), 'still somebody here');
    store.leave(host, 'alice-leaves', store.snapshot(host.room_id).revision);
    assert.equal(store.roomCode(host.room_id), undefined);
    assert.deepEqual(store.snapshot(host.room_id).players, [], 'the bot left with them');

    const c = newSession('C');
    const played = store.enter('create', c.token, 'C', undefined, identity('carol'));
    store.db.prepare('INSERT INTO room_rounds VALUES (?, 5)').run(played.room_id);
    store.leave(played, 'carol-leaves', store.snapshot(played.room_id).revision);
    assert.ok(store.roomCode(played.room_id), 'friends coming back to the link still find the room');
  } finally {
    store.close();
  }
});

test('someone the host removed cannot walk straight back in, until the room starts its next round', () => {
  const store = new Store(':memory:');
  try {
    const host = store.enter('create', newSession('A').token, 'A', undefined, identity('alice'));
    const griefer = store.enter('join', newSession('G').token, 'G', host.room_id, identity('griefer'));
    store.lobby(host, 'remove-griefer', store.snapshot(host.room_id).revision, false, undefined, griefer.id);
    assert.throws(
      () => store.enter('join', newSession('G').token, 'G', host.room_id, identity('griefer')),
      /host removed you/,
    );
    // Everyone else is still welcome.
    store.enter('join', newSession('B').token, 'B', host.room_id, identity('bob'));
    // A new round is a clean slate.
    store.db.prepare('INSERT INTO room_rounds VALUES (?, 99)').run(host.room_id);
    store.enter('join', newSession('G').token, 'G', host.room_id, identity('griefer'));
    assert.equal(store.snapshot(host.room_id).players.length, 3);
  } finally {
    store.close();
  }
});
