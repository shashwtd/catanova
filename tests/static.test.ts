import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/src/server.js';

test('one server serves client assets and same-origin WebSockets without exposing parent files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'catanova-static-'));
  const client = join(dir, 'client');
  await mkdir(join(client, 'assets'), { recursive: true });
  await writeFile(join(client, 'index.html'), '<!doctype html><title>Catanova</title>');
  await writeFile(join(client, 'app.html'), '<!doctype html><title>Catanova room</title>');
  await mkdir(join(client, 'guide'));
  await writeFile(join(client, 'guide', 'index.html'), '<!doctype html><title>How to play Catanova</title>');
  await writeFile(join(client, 'sitemap.xml'), '<urlset></urlset>');
  await writeFile(join(client, 'site.webmanifest'), '{"name":"Catanova"}');
  await writeFile(join(client, 'assets', 'game-123.js'), 'export const game = true;');
  await writeFile(join(client, 'assets', 'font-123.woff2'), 'test font');
  await writeFile(join(dir, 'private.txt'), 'must remain private');
  const auth = { url: 'https://configured-project.supabase.co', publishableKey: 'sb_publishable_test' };
  const server = await startServer({ port: 0, databasePath: ':memory:', clientDirectory: client, auth });
  t.after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), null);
  assert.match(await response.text(), /Catanova/);
  assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.ok(response.headers.get('content-security-policy')!.includes(auth.url));
  assert.match(
    response.headers.get('content-security-policy')!,
    /img-src 'self' data: https:\/\/\*\.googleusercontent\.com/,
  );
  const config = await fetch(origin + '/api/config');
  assert.equal(config.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.deepEqual(await config.json(), { auth, mode: 'authenticated' });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const path of ['/room/ABCD2345', '/room/abcd2345/', '/auth/callback', '/?room=ABCD2345']) {
    const invitation = await fetch(origin + path);
    assert.equal(invitation.status, 200);
    assert.match(await invitation.text(), /Catanova room/);
    assert.equal(invitation.headers.get('cache-control'), 'no-cache');
    assert.equal(invitation.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  const guide = await fetch(origin + '/guide/');
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /How to play Catanova/);
  assert.match(guide.headers.get('content-type')!, /text\/html/);
  assert.equal(guide.headers.get('x-robots-tag'), null);
  for (const [path, target] of [
    ['/guide', '/guide/'],
    ['/guide/index.html', '/guide/'],
    ['/index.html', '/'],
    ['/index.html?room=ABCD2345', '/?room=ABCD2345'],
  ]) {
    const redirect = await fetch(origin + path, { redirect: 'manual' });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), target);
  }
  assert.match((await fetch(origin + '/sitemap.xml')).headers.get('content-type')!, /application\/xml/);
  assert.match(
    (await fetch(origin + '/site.webmanifest')).headers.get('content-type')!,
    /application\/manifest\+json/,
  );
  assert.equal((await fetch(origin + '/healthz')).headers.get('x-robots-tag'), 'noindex, nofollow');
  const font = await fetch(`${origin}/assets/font-123.woff2`);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  const asset = await fetch(`${origin}/assets/game-123.js`);
  assert.match(asset.headers.get('cache-control')!, /immutable/);
  assert.match(asset.headers.get('content-type')!, /javascript/);
  const cached = await fetch(origin, { headers: { 'If-None-Match': response.headers.get('etag')! } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
  for (const path of [
    '/..%2fprivate.txt',
    '/%2e%2e/private.txt',
    '/.env',
    '/data/probe.sqlite',
    '/assets/',
    '/app.html',
    '/not-a-page',
  ]) {
    const r = await fetch(origin + path);
    assert.ok(r.status === 403 || r.status === 404);
    assert.ok(!(await r.text()).includes('must remain private'));
  }
  const head = await fetch(origin, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const ws = new WebSocket(server.url, { origin });
  await once(ws, 'open');
  ws.close();
});
