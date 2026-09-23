import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { startServer } from '../apps/server/src/server.js';
import { ProtocolError } from '../apps/server/src/store.js';
import { createVerifier } from '../apps/server/src/auth.js';
import type { Identity } from '../apps/server/src/auth.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import { Connection, newSession } from '../apps/client/src/connection.js';
import type { ServerMessage } from '../packages/protocol/src/index.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 6000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await pause(5);
  }
}
const jwt = (subject: string) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`;

test('a sign-in service outage is "try again", never "sign in again", and a verified token keeps working through it', async (t) => {
  let mode: 'up' | 'down' | 'refusing' = 'up';
  const known = jwt('known'),
    fresh = jwt('fresh');
  const api = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'down') return void res.writeHead(503).end('Service Unavailable');
    if (mode === 'refusing') return void res.writeHead(401).end('{"message":"Invalid JWT","code":"bad_jwt"}');
    if (req.url === '/rest/v1/rpc/catanova_account_get')
      return void res.end(
        JSON.stringify({
          id: 'verified-id',
          isGuest: false,
          registered: true,
          username: 'Verified',
          profile: { ...defaultProfile('Verified'), username: 'Verified' },
          lastActiveAt: new Date().toISOString(),
          expiresAt: null,
        }),
      );
    res.end(
      JSON.stringify({ id: 'verified-id', is_anonymous: false, app_metadata: { providers: ['google'] } }),
    );
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => new Promise<void>((resolve) => api.close(() => resolve())));
  const port = (api.address() as { port: number }).port;
  const verify = createVerifier({ url: `http://127.0.0.1:${port}`, publishableKey: 'sb_publishable_test' });
  const code = async (token: string) => {
    try {
      await verify(token);
      return 'ok';
    } catch (error) {
      return (error as ProtocolError).code;
    }
  };

  assert.equal((await verify(known)).id, 'verified-id');
  mode = 'down';
  // The token this server already verified still identifies its player...
  assert.equal((await verify(known)).id, 'verified-id');
  // ...but nothing new gets in on the strength of an outage.
  assert.equal(await code(fresh), 'AUTH_UNAVAILABLE');
  // A definite refusal is still a refusal, remembered or not.
  mode = 'refusing';
  assert.equal(await code(known), 'AUTH_REQUIRED');
  const unreachable = createVerifier({ url: 'http://127.0.0.1:9', publishableKey: 'sb_publishable_test' });
  await assert.rejects(unreachable(fresh), (error: ProtocolError) => error.code === 'AUTH_UNAVAILABLE');
});

test('a browser resuming its seat reconnects through a sign-in outage without ever showing an error', async (t) => {
  let failures = 0;
  const verifyIdentity = async (token: string | undefined): Promise<Identity> => {
    if (failures > 0) {
      failures--;
      throw new ProtocolError('AUTH_UNAVAILABLE', 'Sign-in service unavailable; try again');
    }
    if (token !== 'alice') throw new ProtocolError('AUTH_REQUIRED', 'Please sign in again');
    return { id: 'alice', name: 'Alice', expiresAt: Date.now() + 3600000 };
  };
  const server = await startServer({ port: 0, databasePath: ':memory:', verifyIdentity });
  const clients: Connection[] = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
  });
  const options = { accessToken: async () => 'alice', minRetryMs: 10, maxRetryMs: 40 };
  const first = new Connection(server.url, newSession('Alice'), options);
  clients.push(first);
  first.start();
  await until(() => first.status === 'connected');
  const saved = { ...first.session };
  first.stop();

  failures = 3;
  const messages: ServerMessage[] = [];
  const again = new Connection(server.url, saved, options);
  clients.push(again);
  again.subscribe((m) => messages.push(m));
  again.start();
  await until(() => again.status === 'connected');
  assert.equal(failures, 0, 'three refusals were retried through');
  assert.ok(again.metrics.reconnects >= 3);
  assert.deepEqual(
    messages.filter((m) => m.type === 'error'),
    [],
    'the player never saw "please sign in again"',
  );

  // A brand-new join during an outage still says so, and waits for the player.
  failures = 1;
  const joiner = new Connection(server.url, newSession('Alice'), options);
  clients.push(joiner);
  const joinMessages: ServerMessage[] = [];
  joiner.subscribe((m) => joinMessages.push(m));
  joiner.start();
  await until(() => joiner.status === 'closed');
  assert.ok(joinMessages.some((m) => m.type === 'error' && m.code === 'AUTH_UNAVAILABLE'));
});

test('a refreshed token keeps the socket open past the old one, instead of an hourly reconnect', async (t) => {
  // Tokens name their own expiry so the test can make them short-lived.
  const unavailable = new Set<string>();
  const verifyIdentity = async (token: string | undefined): Promise<Identity> => {
    if (token && unavailable.has(token))
      throw new ProtocolError('AUTH_UNAVAILABLE', 'Sign-in service unavailable');
    const [who, expiry] = (token ?? '').split(':');
    if (who !== 'alice' || !expiry) throw new ProtocolError('AUTH_REQUIRED', 'Please sign in again');
    return { id: 'alice', name: 'Alice', expiresAt: Number(expiry) };
  };
  const server = await startServer({ port: 0, databasePath: ':memory:', verifyIdentity });
  let current = `alice:${Date.now() + 700}`;
  const messages: ServerMessage[] = [];
  const client = new Connection(server.url, newSession('Alice'), {
    accessToken: async () => current,
    authRefreshMs: 40,
    minRetryMs: 10,
  });
  client.subscribe((m) => messages.push(m));
  t.after(async () => {
    client.stop();
    await server.close();
  });
  client.start();
  await until(() => client.status === 'connected');
  // The sign-in library renews its token; while the service is down the offer
  // is declined, harmlessly, and offered again once it answers.
  const renewed = `alice:${Date.now() + 3600000}`;
  unavailable.add(renewed);
  current = renewed;
  await pause(200);
  assert.equal(client.status, 'connected');
  unavailable.delete(renewed);
  await pause(900);
  // Well past the first token's expiry: still the same socket, no reconnect.
  assert.equal(client.status, 'connected');
  assert.equal(client.metrics.reconnects, 0);
  assert.deepEqual(
    messages.filter((m) => m.type === 'error'),
    [],
  );
});
