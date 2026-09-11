import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../apps/server/src/server.js';

test('guest CAPTCHA exposes only a public site key and enables the required widget CSP', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-captcha-config-'));
  await writeFile(join(directory, 'index.html'), '<title>Catanova</title>');
  const before = process.env.TURNSTILE_SITE_KEY;
  process.env.TURNSTILE_SITE_KEY = '  public-site-key-fixture  ';
  t.after(() => {
    if (before === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = before;
  });
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    clientDirectory: directory,
    auth: null,
    verifyIdentity: async () => ({
      id: 'verified-google-fixture',
      name: 'Captain',
      isGuest: false,
      expiresAt: Date.now() + 60000,
    }),
  });
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const config = await (await fetch(`${origin}/api/config`)).json();
  assert.deepEqual(config, {
    auth: null,
    mode: 'authenticated',
    captcha: { siteKey: 'public-site-key-fixture' },
  });
  const csp = (await fetch(origin)).headers.get('content-security-policy')!;
  assert.match(csp, /script-src 'self' https:\/\/challenges.cloudflare.com/);
  assert.match(csp, /frame-src https:\/\/challenges.cloudflare.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/challenges.cloudflare.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.equal(
    (await fetch(`${origin}/api/profile`, { headers: { Authorization: 'Bearer fixture' } })).status,
    200,
    'Google access has no app CAPTCHA gate',
  );
});

test('without a guest CAPTCHA site key, runtime config and CSP retain their original scope', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-no-captcha-'));
  await writeFile(join(directory, 'index.html'), '<title>Catanova</title>');
  const server = await startServer({
    port: 0,
    databasePath: ':memory:',
    clientDirectory: directory,
    auth: null,
    captcha: null,
  });
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.port}`;
  assert.deepEqual(await (await fetch(`${origin}/api/config`)).json(), { auth: null, mode: 'local' });
  const csp = (await fetch(origin)).headers.get('content-security-policy')!;
  assert.match(csp, /script-src 'self';/);
  assert.ok(!csp.includes('challenges.cloudflare.com'));
});
