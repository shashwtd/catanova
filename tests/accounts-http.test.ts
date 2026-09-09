import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import { newSession } from '../apps/client/src/connection.js';
import { PROTOCOL_VERSION } from '../packages/protocol/src/index.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const id = '00000000-0000-4000-8000-000000000001';
  const token = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`;
  const profile = { ...defaultProfile('Captain'), username: 'Captain', avatarSource: 'generated' as const };
  const account = {
    id,
    username: 'Captain' as string | null,
    isGuest: false,
    registered: true,
    profile: profile as typeof profile | null,
    googleAvatarUrl: 'https://lh3.googleusercontent.com/a/verified',
    lastActiveAt: new Date().toISOString(),
    expiresAt: null as string | null,
  };
  const state = { error: '', lastRpc: '', lastArgs: {} as Record<string, unknown> };
  const supabase = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    assert.equal(req.headers.apikey, 'sb_publishable_fixture');
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end(JSON.stringify({ code: 'bad_jwt', message: 'Invalid JWT' }));
      return;
    }
    if (req.url === '/auth/v1/user') {
      res.end(
        JSON.stringify({
          id,
          is_anonymous: account.isGuest,
          app_metadata: { providers: ['google'] },
          user_metadata: { picture: 'https://evil.example' },
        }),
      );
      return;
    }
    state.lastRpc = req.url!;
    let body = '';
    for await (const chunk of req) body += String(chunk);
    state.lastArgs = JSON.parse(body);
    if (state.error) {
      res
        .writeHead(state.error === 'PGRST202' ? 404 : 400)
        .end(
          JSON.stringify({ code: state.error === 'PGRST202' ? 'PGRST202' : 'P0001', message: state.error }),
        );
      return;
    }
    if (req.url === '/rest/v1/rpc/catanova_profile_save') {
      account.username = String(state.lastArgs.p_username);
      account.registered = true;
      account.profile = {
        ...profile,
        name: account.username,
        username: account.username,
        avatar: Number(state.lastArgs.p_avatar),
        avatarSource: state.lastArgs.p_avatar_source as 'generated',
      };
      if (state.lastArgs.p_avatar_source === 'google')
        Object.assign(account.profile, { avatarUrl: account.googleAvatarUrl });
    }
    res.end(JSON.stringify(account));
  });
  supabase.listen(0, '127.0.0.1');
  await once(supabase, 'listening');
  const address = supabase.address();
  assert.ok(address && typeof address !== 'string');
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    auth: { url: `http://127.0.0.1:${address.port}`, publishableKey: 'sb_publishable_fixture' },
  });
  t.after(async () => {
    await server.close();
    await new Promise<void>((resolve) => supabase.close(() => resolve()));
  });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function handshake() {
    const ws = new WebSocket(server.url);
    await once(ws, 'open');
    const message = once(ws, 'message');
    ws.send(
      JSON.stringify({
        type: 'create',
        version: PROTOCOL_VERSION,
        ...newSession('Untrusted'),
        accessToken: token,
      }),
    );
    const [raw] = await message;
    ws.close();
    return JSON.parse(String(raw));
  }
  return { server, state, account, headers, request, handshake };
}
test('account HTTP API reports missing account schema and denies unregistered/expired admission without creating fallback seats', async (t) => {
  const f = await fixture(t);
  f.state.error = 'PGRST202';
  const unavailable = await f.request('/api/account');
  assert.equal(unavailable.status, 503);
  const failure = await unavailable.json();
  assert.equal(failure.code, 'ACCOUNT_SETUP_REQUIRED');
  assert.ok(!JSON.stringify(failure).includes('schema.sql'));
  assert.equal((await f.handshake()).code, 'ACCOUNT_SETUP_REQUIRED');
  f.state.error = '';
  f.account.registered = false;
  f.account.username = null;
  f.account.profile = null;
  const onboarding = await f.request('/api/account');
  assert.equal(onboarding.status, 200);
  assert.equal((await onboarding.json()).registered, false);
  assert.equal((await f.handshake()).code, 'ONBOARDING_REQUIRED');
  f.state.error = 'GUEST_EXPIRED';
  const expired = await f.request('/api/account');
  assert.equal(expired.status, 410);
  assert.equal((await expired.json()).code, 'GUEST_EXPIRED');
  assert.equal((await f.handshake()).code, 'GUEST_EXPIRED');
  assert.equal(f.server.store.db.prepare('select count(*) as n from seats').get()!.n, 0);
  assert.equal(f.server.store.db.prepare('select count(*) as n from rooms').get()!.n, 0);
});
test('profile endpoint sends only canonical input to scoped RPC, ignores forged photo URLs and reports unique-name conflicts', async (t) => {
  const f = await fixture(t);
  const updated = await f.request('/api/account/profile', 'PUT', {
    ...defaultProfile('Explorer'),
    username: 'Explorer',
    avatar: 7,
    avatarSource: 'google',
    avatarUrl: 'https://evil.example/collect',
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(f.state.lastArgs, { p_username: 'Explorer', p_avatar: 7, p_avatar_source: 'google' });
  const account = await updated.json();
  assert.equal(account.profile.avatarUrl, 'https://lh3.googleusercontent.com/a/verified');
  assert.equal(account.profile.name, 'Explorer');
  f.state.error = 'USERNAME_TAKEN';
  const conflict = await f.request('/api/account/profile', 'PUT', {
    ...defaultProfile('Captain'),
    username: 'Captain',
  });
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).error, /username is taken/i);
  assert.equal(f.account.username, 'Explorer', 'failed update preserves previous account');
  f.state.error = 'GOOGLE_REQUIRED';
  const friends = await f.request('/api/friends');
  assert.equal(friends.status, 403);
  assert.equal((await friends.json()).code, 'GOOGLE_REQUIRED');
  const unauthorized = await fetch(`http://127.0.0.1:${f.server.port}/api/account`);
  assert.equal(unauthorized.status, 401);
});
