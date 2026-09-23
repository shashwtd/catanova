import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { startServer } from '../apps/server/src/server.js';
import { AccountPresence, ACCOUNT_PRESENCE_TTL_MS } from '../apps/server/src/account-presence.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import type { Account, PublicAccount } from '../packages/protocol/src/profile.js';
import { accountFailure } from '../apps/server/src/accounts.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import { PresenceSocket } from '../apps/client/src/presence-socket.js';
import type { FriendPresenceChange } from '../packages/protocol/src/player-hub.js';
import type { Identity } from '../apps/server/src/auth.js';

async function fixture(t: TestContext) {
  let now = Date.now();
  const accounts = new Map<string, Account>(
    ['Captain', 'Builder', 'Trader', 'Guest'].map((name, index) => [
      name,
      {
        id: `00000000-0000-4000-8000-00000000000${index + 1}`,
        username: name,
        isGuest: name === 'Guest',
        registered: true,
        profile: { ...defaultProfile(name), username: name },
        lastActiveAt: new Date(now).toISOString(),
        expiresAt: name === 'Guest' ? new Date(now + 7 * 86400_000).toISOString() : null,
      },
    ]),
  );
  const publicAccount = (name: string): PublicAccount => {
    const account = accounts.get(name)!;
    return {
      id: account.id,
      username: account.username!,
      isGuest: account.isGuest,
      profile: account.profile!,
    };
  };
  const calls: { path: string; token: string | undefined }[] = [];
  const supabase = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    assert.equal(req.headers.apikey, 'sb_publishable_fixture');
    const token = req.headers.authorization?.slice('Bearer '.length),
      account = accounts.get(token ?? '');
    calls.push({ path: req.url!, token });
    if (!account) {
      res.writeHead(401).end(JSON.stringify({ code: 'bad_jwt', message: 'Invalid JWT' }));
      return;
    }
    if (req.url?.includes('catanova_friend') && account.isGuest) {
      res.writeHead(403).end(JSON.stringify({ code: 'P0001', message: 'GOOGLE_REQUIRED' }));
      return;
    }
    if (req.url === '/rest/v1/rpc/catanova_friends' || req.url === '/rest/v1/rpc/catanova_friend_action') {
      res.end(
        JSON.stringify({
          friends: [publicAccount('Builder')],
          incoming: [publicAccount('Trader')],
          outgoing: [],
        }),
      );
      return;
    }
    if (req.url === '/rest/v1/rpc/catanova_friend_search') {
      res.end(JSON.stringify([publicAccount('Builder')]));
      return;
    }
    res.end(JSON.stringify(account));
  });
  supabase.listen(0, '127.0.0.1');
  await once(supabase, 'listening');
  const address = supabase.address();
  assert.ok(address && typeof address !== 'string');
  const verify = async (token: string | undefined): Promise<Identity> => {
    const account = accounts.get(token ?? '');
    if (!account) throw accountFailure('AUTH_REQUIRED');
    return {
      id: account.id,
      name: account.username!,
      profile: account.profile!,
      isGuest: account.isGuest,
      expiresAt: now + 3_600_000,
    };
  };
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    now: () => now,
    heartbeatMs: 100,
    presenceGraceMs: 500,
    auth: { url: `http://127.0.0.1:${address.port}`, publishableKey: 'sb_publishable_fixture' },
    verifyIdentity: verify,
  });
  t.after(async () => {
    await server.close();
    await new Promise<void>((resolve) => supabase.close(() => resolve()));
  });
  const request = (path: string, token?: string, method = 'GET', body?: unknown) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const room = async (names: string[]) => {
    const store = server.store,
      host = store.enter(
        'create',
        randomBytes(32).toString('hex'),
        'ignored',
        undefined,
        await verify(names[0]),
      );
    for (const name of names.slice(1)) {
      const seat = store.enter(
        'join',
        randomBytes(32).toString('hex'),
        'ignored',
        host.room_id,
        await verify(name),
      );
      store.lobby(seat, 'ready-match', store.snapshot(host.room_id).revision, true);
    }
    store.action(host, 'start-match', store.snapshot(host.room_id).revision, { kind: 'start' });
    return host.room_id;
  };
  return {
    server,
    accounts,
    calls,
    request,
    room,
    publicAccount,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Expected live socket');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('personal games require Supabase-verified ownership and never accept an arbitrary account ID', async (t) => {
  const f = await fixture(t);
  const own = await f.room(['Captain', 'Builder']),
    other = await f.room(['Trader', 'Guest']);
  assert.equal((await f.request('/api/account/games')).status, 401);
  assert.equal((await f.request('/api/account/games', 'forged-token')).status, 401);
  const response = await f.request(`/api/account/games?userId=${f.accounts.get('Trader')!.id}`, 'Captain');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  const data = await response.json();
  assert.deepEqual(
    data.games.map((g: { roomId: string }) => g.roomId),
    [own],
  );
  assert.ok(!JSON.stringify(data).includes(other));
  assert.equal((await f.request('/api/account/games?cursor=bad%3Bsql', 'Captain')).status, 400);
  assert.ok(
    f.calls.some((call) => call.path === '/rest/v1/rpc/catanova_account_get' && call.token === 'Captain'),
  );
  const guest = await (await f.request('/api/account/games', 'Guest')).json();
  assert.equal(guest.games[0].roomId, other, 'active guests may see their own saved matches');
  assert.equal(
    (await f.request('/api/friends', 'Guest')).status,
    403,
    'guests cannot use friendship presence',
  );
});

test('expired guests and unregistered identities cannot read records or post presence, even with a still-valid JWT', async (t) => {
  const f = await fixture(t),
    guest = f.accounts.get('Guest')!;
  guest.expiresAt = new Date(f.now() - 1).toISOString();
  for (const [path, method] of [
    ['/api/account/games', 'GET'],
    ['/api/account/presence', 'POST'],
  ]) {
    const response = await f.request(path!, 'Guest', method);
    assert.equal(response.status, 410);
    assert.equal((await response.json()).code, 'GUEST_EXPIRED');
  }
  const account = f.accounts.get('Captain')!;
  account.registered = false;
  account.username = null;
  account.profile = null;
  assert.equal((await f.request('/api/account/games', 'Captain')).status, 400);
  assert.equal((await f.request('/api/account/presence', 'Captain', 'POST')).status, 400);
});

test('online status uses confirmed friend heartbeats, expires, and is absent from pending or search results', async (t) => {
  const f = await fixture(t);
  const read = async () => (await f.request('/api/friends', 'Captain')).json();
  assert.equal((await read()).friends[0].online, false);
  assert.equal((await f.request('/api/account/presence', undefined, 'POST')).status, 401);
  await f.request('/api/account/presence', 'Captain', 'POST', { id: f.accounts.get('Builder')!.id });
  assert.equal((await read()).friends[0].online, false, 'cannot spoof a different user presence');
  await f.request('/api/account/presence', 'Builder', 'POST');
  await f.request('/api/account/presence', 'Trader', 'POST');
  const online = await read();
  assert.equal(online.friends[0].online, true);
  assert.ok(!('online' in online.incoming[0]));
  for (const field of ['lastSeen', 'lastActiveAt', 'expiresAt', 'roomId', 'token'])
    assert.ok(!JSON.stringify(online).includes(field), field);
  const search = await (await f.request('/api/friends/search?q=Bui', 'Captain')).json();
  assert.ok(!('online' in search[0]));
  const changed = await (
    await f.request('/api/friends', 'Captain', 'POST', {
      action: 'accept',
      other: f.accounts.get('Builder')!.id,
    })
  ).json();
  assert.equal(changed.friends[0].online, true, 'mutation results also preserve live status');
  f.advance(ACCOUNT_PRESENCE_TTL_MS);
  assert.equal((await read()).friends[0].online, false);
});

test('history and presence have per-account limits and unauthenticated floods are bounded before Supabase calls', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 12; i++)
    assert.equal((await f.request('/api/account/presence', 'Captain', 'POST')).status, 200);
  const blocked = await f.request('/api/account/presence', 'Captain', 'POST');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(
    (await f.request('/api/account/presence', 'Builder', 'POST')).status,
    200,
    'another account has its own bucket',
  );
  for (let i = 0; i < 30; i++) assert.equal((await f.request('/api/account/games', 'Captain')).status, 200);
  assert.equal((await f.request('/api/account/games', 'Captain')).status, 429);
  for (let i = 0; i < 120; i++) await f.request('/api/account/presence', 'bad-token', 'POST');
  const count = f.calls.length;
  assert.equal((await f.request('/api/account/presence', 'bad-token', 'POST')).status, 429);
  assert.equal(f.calls.length, count, 'the IP limit rejects before an external auth request');
  f.advance(60_001);
  assert.equal((await f.request('/api/account/presence', 'Captain', 'POST')).status, 200);
});

test('an open game socket keeps its owner online, and closing it takes them offline after the grace', async (t) => {
  const f = await fixture(t);
  const client = new Connection(f.server.url, newSession('Builder'), { accessToken: async () => 'Builder' });
  t.after(() => client.stop());
  client.start();
  await until(() => client.status === 'connected');
  const builder = async () => (await (await f.request('/api/friends', 'Captain')).json()).friends[0];
  assert.equal((await builder()).online, true);
  // No heartbeat is needed while the socket is open, however much time passes.
  f.advance(ACCOUNT_PRESENCE_TTL_MS * 10);
  assert.equal((await builder()).online, true, 'an open socket is presence enough');
  // Observe authoritative transport closure before looking again.
  const closed = new Promise<void>((resolve) => {
    const original = f.server.store.setConnected.bind(f.server.store);
    f.server.store.setConnected = (seat, connected) => {
      original(seat, connected);
      if (seat.id === client.playerId && !connected) resolve();
    };
  });
  client.stop();
  await closed;
  assert.equal((await builder()).online, true, 'a reload within the grace does not flicker offline');
  const deadline = Date.now() + 5000;
  while ((await builder()).online) {
    if (Date.now() > deadline) throw new Error('Still online after the grace');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(
    (await builder()).lastSeenAt,
    f.now(),
    'last seen is when they left, not their last heartbeat',
  );
});

test('friends hear each other arrive and leave over the presence socket, as it happens', async (t) => {
  const f = await fixture(t);
  const builderId = f.accounts.get('Builder')!.id;
  const heard: FriendPresenceChange[] = [];
  const captain = new PresenceSocket({
    url: f.server.url,
    accessToken: async () => 'Captain',
    onFriend: (change) => heard.push(change),
  });
  t.after(() => captain.stop());
  captain.start();
  // The snapshot follows the accepted socket once the friends list has loaded.
  await until(() => heard.length > 0);
  assert.deepEqual(heard, [{ id: builderId, online: false }], 'told where each friend is on joining');
  const builder = new PresenceSocket({
    url: f.server.url,
    accessToken: async () => 'Builder',
    onFriend: () => {},
  });
  t.after(() => builder.stop());
  builder.start();
  await until(() => heard.some((change) => change.id === builderId && change.online));
  assert.equal((await (await f.request('/api/friends', 'Captain')).json()).friends[0].online, true);
  assert.deepEqual(
    f.server.runtime.online().map(({ name, guest, tabs }) => ({ name, guest, tabs })),
    [
      { name: 'Captain', guest: false, tabs: 1 },
      { name: 'Builder', guest: false, tabs: 1 },
    ],
    'the admin console sees who is here',
  );
  f.advance(3_600_000 - 1);
  builder.stop();
  await until(() => heard.at(-1)?.online === false);
  assert.deepEqual(heard.at(-1), { id: builderId, online: false, lastSeenAt: f.now() });
  assert.equal((await (await f.request('/api/friends', 'Captain')).json()).friends[0].online, false);
});

test('a friend starting or finishing a game reaches friends as a watch link at once', async (t) => {
  const f = await fixture(t);
  const builderId = f.accounts.get('Builder')!.id;
  const heard: FriendPresenceChange[] = [];
  const captain = new PresenceSocket({
    url: f.server.url,
    accessToken: async () => 'Captain',
    onFriend: (change) => heard.push(change),
  });
  const builder = new PresenceSocket({
    url: f.server.url,
    accessToken: async () => 'Builder',
    onFriend: () => {},
  });
  t.after(() => {
    captain.stop();
    builder.stop();
  });
  captain.start();
  await until(() => captain.isConnected);
  builder.start();
  await until(() => heard.some((change) => change.id === builderId && change.online));
  const roomId = await f.room(['Builder', 'Trader']);
  f.server.runtime.broadcast(roomId);
  await until(() => heard.at(-1)?.watchable !== undefined);
  assert.deepEqual(heard.at(-1), {
    id: builderId,
    online: true,
    watchable: { roomId, roomCode: f.server.store.roomCode(roomId) },
  });
  const game = f.server.store.loadGame(roomId)!;
  game.phase = 'finished';
  f.server.store.db.prepare('UPDATE games SET state=? WHERE room_id=?').run(JSON.stringify(game), roomId);
  f.server.runtime.broadcast(roomId);
  await until(() => heard.at(-1)?.watchable === undefined);
  assert.deepEqual(heard.at(-1), { id: builderId, online: true });
});

test('a server without accounts turns presence sockets away once, without retrying', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:', auth: null });
  t.after(() => server.close());
  const socket = new PresenceSocket({
    url: server.url,
    accessToken: async () => 'anyone',
    onFriend: () => {},
  });
  t.after(() => socket.stop());
  socket.start();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(socket.isConnected, false);
  assert.deepEqual(server.runtime.online(), []);
});

test('presence entries are bounded and never outlive a verified identity deadline', () => {
  const presence = new AccountPresence(2),
    now = 100_000;
  presence.touch('first', now, now + 100);
  presence.touch('second', now);
  presence.touch('overflow', now);
  assert.equal(presence.online('overflow', now), false);
  assert.equal(presence.online('first', now + 100), false);
  presence.touch('overflow', now + 100);
  assert.equal(presence.online('overflow', now + 100), true, 'expired entries are reclaimed');
  presence.touch('expired', now, now - 1);
  assert.equal(presence.online('expired', now), false);
});

test('only online accepted friends expose watch links to unfinished matches', async (t) => {
  const f = await fixture(t);
  const roomId = await f.room(['Builder', 'Trader']);
  const list = async () => await (await f.request('/api/friends', 'Captain')).json();
  assert.equal((await list()).friends[0].watchable, undefined, 'offline rooms remain private');
  await f.request('/api/account/presence', 'Builder', 'POST');
  await f.request('/api/account/presence', 'Trader', 'POST');
  const friends = await list();
  assert.deepEqual(friends.friends[0].watchable, { roomId, roomCode: f.server.store.roomCode(roomId) });
  assert.equal(friends.incoming[0].watchable, undefined, 'pending requests cannot reveal rooms');
  const game = f.server.store.loadGame(roomId)!;
  game.phase = 'finished';
  f.server.store.db.prepare('UPDATE games SET state=? WHERE room_id=?').run(JSON.stringify(game), roomId);
  assert.equal((await list()).friends[0].watchable, undefined, 'finished games are not offered');
});

test('archived results authorize recorded participants and return only final public fields', async (t) => {
  const f = await fixture(t);
  const roomId = await f.room(['Captain', 'Builder']);
  const store = f.server.store;
  for (const player of store.snapshot(roomId).players)
    store.setConnected({ ...player, room_id: roomId }, true);
  const other = { ...store.snapshot(roomId).players[1]!, room_id: roomId };
  store.leave(other, 'leave-for-result', store.snapshot(roomId).revision);
  const game = store.loadGame(roomId)!;
  const host = { ...store.snapshot(roomId).players[0]!, room_id: roomId };
  store.action(host, 'back', store.snapshot(roomId).revision, { kind: 'returnToLobby' });
  const summary = store.accountGames(f.accounts.get('Captain')!.id).games[0]!;
  const archiveId = store.db.prepare('SELECT room_id FROM archived_matches').get()!.room_id;
  const path = `/api/account/matches/${archiveId}/results`;
  assert.equal((await f.request(path)).status, 401);
  assert.equal((await f.request(path, 'Trader')).status, 404);
  assert.equal((await f.request('/api/account/matches/not-an-id/results', 'Captain')).status, 404);
  for (const name of ['Captain', 'Builder']) {
    const response = await f.request(path, name);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control')!, /no-store/);
    const body = await response.json();
    assert.equal(body.game.winner, game.winner);
    assert.equal(body.id, archiveId);
    assert.ok(summary);
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      'hand',
      'resources',
      'development',
      'token',
      'user_id',
      f.accounts.get(name)!.id,
    ])
      assert.ok(!serialized.includes(forbidden), forbidden);
    assert.equal(body.game.players.length, game.players.length);
    for (const player of body.game.players) {
      const original = game.players.find((p) => p.id === player.id);
      assert.ok(original);
      assert.deepEqual(Object.keys(player).sort(), [
        'id',
        'knights',
        'name',
        'pieces',
        'points',
        ...(original.resigned ? ['resigned'] : []),
        'roadLength',
      ]);
      assert.equal(player.resigned, original.resigned || undefined);
    }
  }
});
