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

test('authenticated game sockets also keep their owner online while playing', async (t) => {
  const f = await fixture(t);
  const client = new Connection(f.server.url, newSession('Builder'), { accessToken: async () => 'Builder' });
  t.after(() => client.stop());
  client.start();
  await until(() => client.status === 'connected');
  let friends = await (await f.request('/api/friends', 'Captain')).json();
  assert.equal(friends.friends[0].online, true);
  f.advance(ACCOUNT_PRESENCE_TTL_MS - 1);
  await new Promise((resolve) => setTimeout(resolve, 180));
  f.advance(2);
  friends = await (await f.request('/api/friends', 'Captain')).json();
  assert.equal(friends.friends[0].online, true, 'transport pongs refresh authenticated presence');
  // Observe authoritative transport closure before advancing the simulated clock.
  const closed = new Promise<void>((resolve) => {
    const original = f.server.store.setConnected.bind(f.server.store);
    f.server.store.setConnected = (seat, connected) => {
      original(seat, connected);
      if (seat.id === client.playerId && !connected) resolve();
    };
  });
  client.stop();
  await closed;
  f.advance(ACCOUNT_PRESENCE_TTL_MS + 1);
  friends = await (await f.request('/api/friends', 'Captain')).json();
  assert.equal(friends.friends[0].online, false);
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
