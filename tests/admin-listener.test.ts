import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../apps/server/src/server.js';
import { ADMIN_CSP, ADMIN_WRITES_PER_MINUTE, startAdminServer } from '../apps/server/src/admin/listener.js';
import type { ApiRoute } from '../apps/server/src/admin/listener.js';
import { createAccessVerifier } from '../apps/server/src/admin/access.js';
import type { AdminConfig } from '../apps/server/src/admin/config.js';
import { ADMIN_ORIGIN, API, AUD, MUTATION, OWNER, TEAM, keyServer, raw } from './admin-fixture.js';
import type { RawResponse } from './admin-fixture.js';

const ADMIN_PAGE =
  '<!doctype html><title>Catanova admin</title><script type="module" src="/assets/admin-7f3a.js"></script>';

async function adminBuild(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'catanova-admin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'admin', 'assets'), { recursive: true });
  await writeFile(join(dir, 'admin', 'index.html'), ADMIN_PAGE);
  await writeFile(join(dir, 'admin', 'assets', 'admin-7f3a.js'), 'export const admin = "ADMIN-BUNDLE";');
  await writeFile(join(dir, 'admin', 'assets', 'admin-7f3a.js.map'), '{"sources":["secret.ts"]}');
  await mkdir(join(dir, 'client', 'assets'), { recursive: true });
  await writeFile(join(dir, 'client', 'index.html'), '<!doctype html><title>Catanova</title>');
  await writeFile(join(dir, 'client', 'app.html'), '<!doctype html><title>Catanova room</title>');
  return dir;
}

/** An echo route standing in for any change: it audits, and returns what it was sent. */
const echo: ApiRoute = {
  method: 'POST',
  path: /^\/api\/admin\/test\/echo$/,
  handle: ({ body, audit }) => ({
    body,
    audit: audit({ action: 'test.echo', target: 'echo', detail: { body } }),
  }),
};

async function fixture(t: TestContext, mode: 'cloudflare-access' | 'local-dev' = 'cloudflare-access') {
  const keys = await keyServer(t);
  const dir = await adminBuild(t);
  const game = await startServer({ port: 0, databasePath: ':memory:', auth: null, captcha: null });
  const config: AdminConfig = {
    port: 0,
    host: '127.0.0.1',
    auth:
      mode === 'local-dev' ? { mode } : { mode, teamDomain: TEAM, audience: AUD, emails: new Set([OWNER]) },
    origin: mode === 'local-dev' ? 'http://127.0.0.1:3100' : ADMIN_ORIGIN,
    statusDir: join(dir, 'status'),
    revision: 'abc1234',
  };
  const admin = await startAdminServer({
    config,
    store: game.store,
    runtime: game.runtime,
    databasePath: ':memory:',
    assetsDirectory: join(dir, 'admin'),
    verifier: createAccessVerifier({
      teamDomain: TEAM,
      audience: AUD,
      emails: new Set([OWNER]),
      certsUrl: keys.certsUrl,
    }),
    routes: () => [echo],
    log: () => {},
  });
  t.after(async () => {
    await admin.close();
    await game.close();
  });
  const request = (
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: string; token?: string | null } = {},
  ) =>
    raw(admin.port, path, {
      ...options,
      headers: {
        ...(options.token === null ? {} : { 'Cf-Access-Jwt-Assertion': options.token ?? keys.token() }),
        ...options.headers,
      },
    });
  return { keys, dir, game, admin, request };
}

function assertHardened(response: RawResponse) {
  assert.equal(response.headers['content-security-policy'], ADMIN_CSP);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(response.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  assert.match(response.headers['permissions-policy'] as string, /camera=\(\)/);
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.match(response.headers['x-request-id'] as string, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
}

test('every admin request, page, script or API, needs a verified Cloudflare Access token', async (t) => {
  const { request, keys } = await fixture(t);
  for (const path of ['/', '/assets/admin-7f3a.js', '/api/admin/session', '/api/admin/audit', '/missing']) {
    const anonymous = await request(path, { token: null, headers: API });
    assert.equal(anonymous.status, 401, path);
    assertHardened(anonymous);
    assert.ok(!anonymous.body.includes('ADMIN-BUNDLE') && !anonymous.body.includes('Catanova admin'));
    assert.equal(
      (await request(path, { token: keys.token({ email: 'friend@example.com' }), headers: API })).status,
      403,
    );
    assert.equal((await request(path, { token: keys.token({ aud: ['x'] }), headers: API })).status, 401);
  }
  const page = await request('/');
  assert.equal(page.status, 200);
  assertHardened(page);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(page.body, ADMIN_PAGE);
  assert.equal(page.headers['strict-transport-security'], 'max-age=31536000');
  const script = await request('/assets/admin-7f3a.js');
  assert.equal(script.status, 200);
  assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8');
  assertHardened(script);
  // Source maps and unknown files are never served, and paths never reach the filesystem.
  for (const path of [
    '/assets/admin-7f3a.js.map',
    '/index.html',
    '/../client/index.html',
    '/%2e%2e/client/index.html',
    '/assets/../../client/index.html',
    '/assets/%2F..%2F..%2Fclient%2Findex.html',
  ])
    assert.equal((await request(path)).status, 404, path);
  assert.equal((await request('http://evil.example/')).status, 400, 'absolute-form target');
  const session = await request('/api/admin/session', { headers: API });
  assert.equal(session.status, 200);
  assertHardened(session);
  assert.deepEqual(JSON.parse(session.body), {
    actor: OWNER,
    mode: 'cloudflare-access',
    revision: 'abc1234',
  });
});

test('when the signing keys cannot be fetched, every admin request gets 503', async (t) => {
  const { request, keys } = await fixture(t);
  keys.fail(true);
  for (const path of ['/', '/assets/admin-7f3a.js', '/api/admin/session']) {
    const unavailable = await request(path, { headers: API });
    assert.equal(unavailable.status, 503, path);
    assertHardened(unavailable);
    assert.ok(!unavailable.body.includes('ADMIN-BUNDLE') && !unavailable.body.includes(OWNER));
  }
});

test('admin API calls need the admin header, a same-origin fetch, and for changes POST, JSON and the exact Origin', async (t) => {
  const { request, game } = await fixture(t);
  // Reads.
  assert.equal((await request('/api/admin/session')).status, 403, 'no custom header');
  assert.equal(
    (await request('/api/admin/session', { headers: { 'X-Catanova-Admin': 'true' } })).status,
    403,
  );
  assert.equal(
    (await request('/api/admin/session', { headers: { ...API, 'Sec-Fetch-Site': 'cross-site' } })).status,
    403,
  );
  assert.equal(
    (await request('/api/admin/session', { headers: { ...API, 'Sec-Fetch-Site': 'same-site' } })).status,
    403,
  );
  assert.equal(
    (await request('/api/admin/session', { headers: { ...API, Origin: 'https://evil.example' } })).status,
    403,
  );
  assert.equal(
    (await request('/api/admin/session', { headers: { 'X-Catanova-Admin': '1' } })).status,
    200,
    'no fetch metadata',
  );
  // Methods.
  for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    assert.equal(
      (await request('/api/admin/session', { method, headers: MUTATION, body: '{}' })).status,
      405,
      method,
    );
    assert.equal((await request('/', { method })).status, 405, method);
  }
  assert.equal((await request('/api/admin/test/echo', { headers: API })).status, 405, 'GET on a change');
  assert.equal(
    (await request('/api/admin/session', { method: 'POST', headers: MUTATION, body: '{}' })).status,
    405,
  );
  const head = await request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal((await request('/api/admin/nothing', { headers: API })).status, 404);

  // Changes.
  const post = (headers: Record<string, string>, body = '{"note":"hello"}') =>
    request('/api/admin/test/echo', { method: 'POST', headers, body });
  const { 'X-Catanova-Admin': _header, ...withoutHeader } = MUTATION;
  const { Origin: _origin, ...withoutOrigin } = MUTATION;
  assert.equal((await post(withoutHeader)).status, 403, 'missing X-Catanova-Admin');
  assert.equal((await post(withoutOrigin)).status, 403, 'missing Origin');
  assert.equal((await post({ ...MUTATION, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ ...MUTATION, Origin: 'null' })).status, 403);
  assert.equal((await post({ ...MUTATION, Origin: ADMIN_ORIGIN + ':443' })).status, 403);
  assert.equal((await post({ ...MUTATION, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post({ ...MUTATION, 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(
    (await post({ ...MUTATION, 'Content-Type': 'application/x-www-form-urlencoded' }, 'a=1')).status,
    415,
  );
  assert.equal((await post({ ...MUTATION, 'Content-Type': 'multipart/form-data; boundary=x' })).status, 415);
  assert.equal((await post(MUTATION, 'not json')).status, 400);
  assert.equal((await post(MUTATION, '[1,2]')).status, 400);
  assert.equal((await post(MUTATION, 'null')).status, 400);
  assert.equal((await post(MUTATION, '')).status, 400);
  const large = JSON.stringify({ note: 'x'.repeat(17_000) });
  assert.equal((await post(MUTATION, large)).status, 413, 'declared length');
  assert.equal(
    (await post({ ...MUTATION, 'Transfer-Encoding': 'chunked' }, large)).status,
    413,
    'streamed without a length',
  );
  const accepted = await post({ ...MUTATION, 'Content-Type': 'application/json; charset=utf-8' });
  assert.equal(accepted.status, 200);
  const result = JSON.parse(accepted.body) as { body: unknown; audit: number };
  assert.deepEqual(result.body, { note: 'hello' });
  const row = game.store.db.prepare('SELECT * FROM admin_audit WHERE id = ?').get(result.audit)!;
  assert.equal(row.actor, OWNER);
  assert.equal(row.action, 'test.echo');
  assert.equal(row.request_id, accepted.headers['x-request-id']);
  assert.equal(row.ip, '127.0.0.1');
  // Refused requests never reach the handler.
  assert.equal(game.store.db.prepare('SELECT count(*) AS n FROM admin_audit').get()!.n, 1);
  // The audit log is append-only.
  assert.throws(() => game.store.db.exec("UPDATE admin_audit SET actor = 'someone-else'"), /append-only/);
  assert.throws(() => game.store.db.exec('DELETE FROM admin_audit'), /append-only/);
  const audit = await request('/api/admin/audit', { headers: API });
  assert.equal(JSON.parse(audit.body).entries[0].actor, OWNER);
});

test('changes are rate limited per actor', async (t) => {
  const { request } = await fixture(t);
  const post = () => request('/api/admin/test/echo', { method: 'POST', headers: MUTATION, body: '{}' });
  for (let i = 0; i < ADMIN_WRITES_PER_MINUTE; i++) assert.equal((await post()).status, 200);
  const limited = await post();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
});

test('local development mode names its actor and refuses a Host that is not loopback', async (t) => {
  const { request } = await fixture(t, 'local-dev');
  const session = await request('/api/admin/session', { token: null, headers: API });
  assert.equal(session.status, 200);
  assert.equal(JSON.parse(session.body).actor, 'local-dev');
  assert.equal(session.headers['strict-transport-security'], undefined);
  for (const host of [
    'evil.example',
    'evil.example:3100',
    '127.0.0.1.evil.example',
    'localhost.evil.example',
  ])
    assert.equal((await request('/', { token: null, headers: { Host: host } })).status, 403, host);
  assert.equal((await request('/', { token: null, headers: { Host: 'localhost:3100' } })).status, 200);
  // The Origin check still applies: a page on another origin cannot post.
  const post = (origin: string) =>
    request('/api/admin/test/echo', {
      token: null,
      method: 'POST',
      headers: { ...MUTATION, Origin: origin },
      body: '{}',
    });
  assert.equal((await post('http://evil.example')).status, 403);
  assert.equal((await post('http://127.0.0.1:3100')).status, 200);
});

test('the public game server never serves admin routes or the admin build', async (t) => {
  const dir = await adminBuild(t);
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    clientDirectory: join(dir, 'client'),
    auth: null,
    captcha: null,
  });
  t.after(() => server.close());
  for (const path of [
    '/api/admin',
    '/api/admin/session',
    '/api/admin/overview',
    '/api/admin/metrics',
    '/api/admin/games',
    '/api/admin/audit',
    '/admin',
    '/admin/',
    '/admin/index.html',
    '/assets/admin-7f3a.js',
    '/../admin/index.html',
    '/%2e%2e/admin/index.html',
    '/%2e%2e/admin/assets/admin-7f3a.js',
  ]) {
    for (const method of ['GET', 'POST']) {
      const response = await raw(server.port, path, {
        method,
        headers: { ...MUTATION, 'Cf-Access-Jwt-Assertion': 'anything' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      assert.ok([403, 404, 405].includes(response.status), `${method} ${path} → ${response.status}`);
      assert.ok(!response.body.includes('ADMIN-BUNDLE'), `${method} ${path}`);
      assert.ok(!response.body.includes('Catanova admin'), `${method} ${path}`);
    }
  }
  // And the game itself is still there.
  assert.equal((await raw(server.port, '/')).status, 200);
});
