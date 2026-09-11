import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { startServer } from '../apps/server/src/server.js';
import { ProtocolError } from '../apps/server/src/store.js';
import { defaultProfile, parseProfile } from '../packages/protocol/src/profile.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import type { ServerMessage } from '../packages/protocol/src/index.js';
import { createVerifier, readAuthConfig } from '../apps/server/src/auth.js';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean) {
  const end = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await pause(5);
  }
}

test('verified Google account owns its seat and cosmetics across devices; arbitrary identities and unauthenticated access fail', async (t) => {
  const verify = async (token: string | undefined) => {
    if (token !== 'alice-access' && token !== 'bob-access')
      throw new ProtocolError('AUTH_REQUIRED', 'Sign in');
    return {
      id: token.split('-')[0]!,
      name: token.startsWith('alice') ? 'Alice' : 'Bob',
      expiresAt: Date.now() + 3600000,
    };
  };
  const server = await startServer({ port: 0, databasePath: ':memory:', verifyIdentity: verify });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
  });
  async function enter(access: string | undefined, session = newSession('Untrusted name')) {
    const c = new Connection(server.url, session, { accessToken: async () => access });
    clients.push(c);
    const messages: ServerMessage[] = [];
    c.subscribe((m) => messages.push(m));
    c.start();
    await until(() => c.status === 'connected' || messages.some((m) => m.type === 'error'));
    return { c, messages };
  }
  const denied = await enter(undefined);
  assert.ok(denied.messages.some((m) => m.type === 'error' && m.code === 'AUTH_REQUIRED'));
  const { c: alice } = await enter('alice-access');
  assert.equal(alice.state!.players[0]!.name, 'Alice');
  const profile = {
    ...defaultProfile('Captain'),
    avatar: 8,
    accent: 'clay' as const,
    frame: 'brass' as const,
  };
  await alice.lobby(true, profile);
  assert.deepEqual(alice.state!.players[0]!.profile, profile);
  const origin = `http://127.0.0.1:${server.port}`;
  assert.equal((await fetch(origin + '/api/profile')).status, 401);
  const saved = await fetch(origin + '/api/profile', { headers: { Authorization: 'Bearer alice-access' } });
  assert.deepEqual(await saved.json(), profile);
  const preview = await fetch(origin + '/api/rooms/' + alice.session.roomId, {
    headers: { Authorization: 'Bearer alice-access' },
  });
  assert.equal((await preview.json()).canResume, true);
  const otherPreview = await fetch(origin + '/api/rooms/' + alice.session.roomId, {
    headers: { Authorization: 'Bearer bob-access' },
  });
  assert.equal((await otherPreview.json()).canResume, false);
  const { c: replacement } = await enter('alice-access', newSession('New device', alice.session.roomId));
  assert.equal(replacement.playerId, alice.playerId);
  assert.deepEqual(replacement.state!.players[0]!.profile, profile);
  assert.equal(replacement.state!.players.length, 1);
  await until(() => alice.status === 'closed');
  const stolen = await enter('bob-access', { ...replacement.session });
  assert.ok(stolen.messages.some((m) => m.type === 'error' && m.code === 'AUTH_MISMATCH'));
  const { c: bob } = await enter('bob-access', newSession('Trying Alice', alice.session.roomId));
  assert.notEqual(bob.playerId, alice.playerId);
  assert.equal(bob.state!.players.find((p) => p.id === bob.playerId)!.name, 'Bob');
  const updated = await fetch(origin + '/api/profile', {
    method: 'PUT',
    headers: { Authorization: 'Bearer bob-access', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...defaultProfile('Bob B'), user_id: 'alice' }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(server.store.profile('alice'), profile);
  assert.equal(server.store.profile('bob').name, 'Bob B');
});

test('lobby requires every ready player and connection before host starts, and stores cosmetic selections', async (t) => {
  const server = await startServer({ port: 0, databasePath: ':memory:' });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
  });
  for (let i = 0; i < 3; i++) {
    const c = new Connection(server.url, newSession(`Player ${i}`, clients[0]?.session.roomId));
    clients.push(c);
    c.start();
    await until(() => c.status === 'connected');
  }
  const host = clients[0]!;
  await until(() => clients.every((c) => c.state!.players.length === 3));
  await assert.rejects(host.action({ kind: 'start' }), /NOT_READY/);
  await Promise.all(clients.map((c) => c.lobby(true)));
  await until(() => clients.every((c) => c.state!.players.every((p) => p.ready)));
  await clients[1]!.lobby(false, { ...defaultProfile('Painter'), avatar: 6 });
  await until(() => host.state!.players.some((p) => p.name === 'Painter' && !p.ready));
  await assert.rejects(host.action({ kind: 'start' }), /NOT_READY/);
  await clients[1]!.lobby(true);
  await until(() => host.state!.players.every((p) => p.ready));
  const absent = clients[2]!;
  absent.stop();
  await until(() => host.state!.players.some((p) => p.id === absent.playerId && !p.connected));
  await assert.rejects(host.action({ kind: 'start' }), /NOT_CONNECTED/);
  absent.start();
  await until(
    () => clients.every((c) => c.status === 'connected') && host.state!.players.every((p) => p.connected),
  );
  const beforeStart = host.state!.revision;
  const started = await host.action({ kind: 'start' });
  assert.ok(host.state!.game);
  assert.equal(host.state!.players.find((p) => p.name === 'Painter')!.profile!.avatar, 6);
  await assert.rejects(host.lobby(false), /GAME_STARTED/);
  absent.stop();
  await until(() => host.state!.players.some((p) => !p.connected));
  const recovered = new Connection(
    server.url,
    { ...host.session },
    {
      pending: {
        type: 'action',
        commandId: started.commandId,
        expectedRevision: beforeStart,
        action: { kind: 'start' },
      },
    },
  );
  clients.push(recovered);
  recovered.start();
  await until(() => recovered.status === 'connected' && !recovered.awaitingConfirmation);
  assert.equal(recovered.state!.revision, started.revision);
  assert.equal(server.store.history(host.session.roomId!).entries.length, 1);
});

test('profile validation rejects unavailable cosmetic IDs and runtime config rejects secret keys', () => {
  assert.throws(() => parseProfile({ ...defaultProfile(), avatar: 12 }));
  assert.throws(() => parseProfile({ ...defaultProfile(), accent: '__proto__' }));
  assert.throws(() => parseProfile({ ...defaultProfile(), frame: '<script>' }));
  const chosen = { ...defaultProfile('Captain'), username: 'Captain', avatar: 5 };
  for (const avatarUrl of [
    'https://lh3.googleusercontent.com/a/old',
    'javascript:old-photo',
    { invalid: true },
  ])
    assert.deepEqual(
      parseProfile({ ...chosen, avatarSource: 'google', avatarUrl, full_name: 'Private Name' }),
      chosen,
    );

  const oldUrl = process.env.SUPABASE_URL,
    oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_test';
    assert.throws(readAuthConfig, /never a secret/);
    process.env.SUPABASE_PUBLISHABLE_KEY = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
    assert.throws(readAuthConfig, /publishable key/);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});

test('Supabase verifier requires verified Auth identity and a live registered account, including guests', async (t) => {
  let anonymous = false,
    provider = 'google',
    registered = true,
    guestExpired = false;
  const seen: string[] = [];
  const jwt = (exp: number) =>
    `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: 'forged-client-id', exp })).toString('base64url')}.test`;
  const valid = jwt(Math.floor(Date.now() / 1000) + 3600);
  const expired = jwt(1);
  const api = createServer((req, res) => {
    seen.push(req.url!);
    assert.equal(req.headers.apikey, 'sb_publishable_test');
    res.setHeader('Content-Type', 'application/json');
    if (![valid, expired].includes(req.headers.authorization?.slice(7) ?? '')) {
      res.writeHead(401).end(JSON.stringify({ message: 'Invalid JWT', code: 'bad_jwt' }));
      return;
    }
    if (req.url === '/rest/v1/rpc/catanova_account_get') {
      const profile = {
        ...defaultProfile('Verified_name'),
        username: 'Verified_name',
      };
      res.end(
        JSON.stringify({
          id: 'verified-auth-id',
          isGuest: anonymous,
          registered,
          username: registered ? 'Verified_name' : null,
          profile: registered ? profile : null,
          lastActiveAt: new Date().toISOString(),
          expiresAt: anonymous ? new Date(Date.now() + (guestExpired ? -1 : 86400000)).toISOString() : null,
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        id: 'verified-auth-id',
        is_anonymous: anonymous,
        app_metadata: { providers: [provider] },
        user_metadata: { full_name: 'Verified name' },
      }),
    );
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => new Promise<void>((resolve) => api.close(() => resolve())));
  const address = api.address();
  assert.ok(address && typeof address !== 'string');
  const verify = createVerifier({
    url: `http://127.0.0.1:${address.port}`,
    publishableKey: 'sb_publishable_test',
  });
  const identity = await verify(valid);
  assert.deepEqual(seen, ['/auth/v1/user', '/rest/v1/rpc/catanova_account_get']);
  assert.equal(identity.id, 'verified-auth-id');
  assert.equal(identity.name, 'Verified_name');
  await assert.rejects(verify('forged-token'), /sign in again/);
  await assert.rejects(verify(expired), /sign in again/);
  anonymous = true;
  const guest = await verify(valid);
  assert.equal(guest.isGuest, true);
  assert.ok(guest.guestExpiresAt! > Date.now());
  registered = false;
  await assert.rejects(verify(valid), /username before playing/);
  registered = true;
  guestExpired = true;
  await assert.rejects(verify(valid), /expired/);
  anonymous = false;
  provider = 'email';
  await assert.rejects(verify(valid), /Google/);
  await assert.rejects(verify(undefined), /Sign in/);
});

test('production never silently starts without authentication', () => {
  const names = [
    'NODE_ENV',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'REQUIRE_AUTH',
    'ALLOW_LOCAL_PLAYTEST',
  ] as const;
  const saved = names.map((name) => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    process.env.NODE_ENV = 'production';
    assert.throws(readAuthConfig, /requires SUPABASE/);
    process.env.ALLOW_LOCAL_PLAYTEST = 'true';
    assert.equal(readAuthConfig(), undefined);
    process.env.REQUIRE_AUTH = 'true';
    assert.throws(readAuthConfig, /requires SUPABASE/);
  } finally {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  }
});
