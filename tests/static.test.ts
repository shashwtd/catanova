import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/src/server.js';
import { precompressClient } from '../scripts/precompress-client.js';
import { ART_REDIRECTS } from '../apps/server/src/art-redirects.js';

function rawRequest(url: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () =>
        resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }),
      );
    });
    request.on('error', reject);
    request.end();
  });
}

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
  await mkdir(join(client, 'audio', 'sfx'), { recursive: true });
  await mkdir(join(client, 'audio', 'music'), { recursive: true });
  await writeFile(join(client, 'audio', 'sfx', 'diceContact.123456abcdef.wav'), 'test wav');
  await writeFile(join(client, 'audio', 'music', 'theme.123456abcdef.m4a'), 'test aac');
  await writeFile(join(client, 'audio', 'music', 'theme.m4a'), 'unversioned aac');
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
  assert.match(response.headers.get('content-security-policy')!, /img-src 'self' data:;/);
  assert.ok(!response.headers.get('content-security-policy')!.includes('googleusercontent.com'));
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
  for (const [path, type] of [
    ['/audio/sfx/diceContact.123456abcdef.wav', 'audio/wav'],
    ['/audio/music/theme.123456abcdef.m4a', 'audio/mp4'],
  ]) {
    const audio = await fetch(origin + path);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('content-type'), type);
    assert.match(audio.headers.get('cache-control')!, /max-age=31536000, immutable/);
    assert.equal(audio.headers.get('content-encoding'), null);
  }
  assert.equal((await fetch(origin + '/audio/music/theme.m4a')).headers.get('cache-control'), 'no-cache');
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

test('content-hashed WebP art is immutable while stable art URLs revalidate', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-art-cache-'));
  await mkdir(join(directory, 'art', 'optimized'), { recursive: true });
  const paths = [
    '/art/optimized/terrain-timber.a1b2c3d4e5f6.webp',
    '/art/optimized/terrain-timber.webp',
    '/art/optimized/terrain-timber.A1B2C3D4E5F6.webp',
    '/art/optimized/terrain-timber.a1b2.webp',
    '/art/terrain-timber.a1b2c3d4e5f6.webp',
    '/art/terrain-timber.png',
  ];
  for (const path of paths) await writeFile(join(directory, path), 'fixture image bytes');
  const server = await startServer({ port: 0, databasePath: ':memory:', clientDirectory: directory });
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.port}`;
  for (const [index, path] of paths.entries()) {
    const response = await rawRequest(origin + path);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers['cache-control'],
      index === 0 ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    assert.equal(response.headers['content-type'], path.endsWith('.webp') ? 'image/webp' : 'image/png');
    const cached = await rawRequest(origin + path, { 'If-None-Match': response.headers.etag! });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
    assert.equal(cached.headers['content-length'], undefined);
    assert.equal(cached.headers['cache-control'], response.headers['cache-control']);
  }
  const old = await rawRequest(origin + paths[1]);
  await writeFile(join(directory, paths[1]!), 'updated image content with a different size');
  const changed = await rawRequest(origin + paths[1], { 'If-None-Match': old.headers.etag! });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.etag, old.headers.etag);
  assert.match(changed.body.toString(), /updated image/);
});

test('legacy PNG requests redirect temporarily to optimized art without exposing offline masters', async (t) => {
  assert.ok(ART_REDIRECTS['/art/terrain-fantasy.png']);
  const directory = await mkdtemp(join(tmpdir(), 'catanova-art-redirect-'));
  const client = join(directory, 'client');
  await mkdir(join(client, 'art', 'optimized'), { recursive: true });
  await mkdir(join(directory, 'assets', 'source-art'), { recursive: true });
  await writeFile(join(directory, 'assets', 'source-art', 'terrain-fantasy.png'), 'private offline master');
  for (const target of Object.values(ART_REDIRECTS)) {
    await writeFile(join(client, target), 'optimized fixture');
  }
  const server = await startServer({ port: 0, databasePath: ':memory:', clientDirectory: client });
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.port}`;
  for (const [legacy, target] of Object.entries(ART_REDIRECTS)) {
    assert.match(target, /^\/art\/optimized\/[a-z0-9_-]+\.[a-f0-9]{12}\.webp$/);
    for (const method of ['GET', 'HEAD']) {
      const response = await rawRequest(origin + legacy + '?v=old', {}, method);
      assert.equal(response.status, 307, legacy);
      assert.equal(response.headers.location, target);
      assert.equal(response.headers['cache-control'], 'no-cache');
      assert.equal(response.body.length, 0);
    }
    const image = await fetch(origin + legacy);
    assert.equal(image.status, 200);
    assert.equal(image.url, origin + target);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.match(image.headers.get('cache-control')!, /immutable/);
  }
  assert.equal((await rawRequest(origin + '/art/terrain-fantasy.png', {}, 'POST')).status, 405);
  for (const path of [
    '/art/unknown.png',
    '/assets/source-art/terrain-fantasy.png',
    '/..%2fassets/source-art/terrain-fantasy.png',
  ]) {
    const response = await rawRequest(origin + path);
    assert.ok(response.status === 403 || response.status === 404);
    assert.equal(response.headers.location, undefined);
    assert.ok(!response.body.toString().includes('private offline master'));
  }
});

test('prebuilt text variants negotiate quality and retain correct wire lengths, cache validators and private entry headers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'catanova-compression-'));
  await mkdir(join(directory, 'assets'), { recursive: true });
  const script = 'export const terrain = "Timber Clay Sheep Hay Rock";\n'.repeat(500);
  const publicPage = '<!doctype html><title>Catanova</title>' + '<p>Welcome to the island</p>'.repeat(80);
  const privatePage =
    '<!doctype html><title>Catanova room</title>' + '<div>Loading your room</div>'.repeat(80);
  await writeFile(join(directory, 'assets', 'game-123.js'), script);
  await writeFile(join(directory, 'index.html'), publicPage);
  await writeFile(join(directory, 'app.html'), privatePage);
  await writeFile(join(directory, 'tiny.txt'), 'tiny');
  const binary = Buffer.alloc(4096, 24);
  await writeFile(join(directory, 'board.webp'), binary);
  const totals = await precompressClient(directory);
  assert.equal(totals.files, 3);
  assert.ok(totals.brotliBytes < totals.originalBytes / 2);
  assert.ok(totals.gzipBytes < totals.originalBytes / 2);
  for (const missing of ['tiny.txt.br', 'tiny.txt.gz', 'board.webp.br', 'board.webp.gz']) {
    await assert.rejects(stat(join(directory, missing)), { code: 'ENOENT' });
  }
  const server = await startServer({ port: 0, databasePath: ':memory:', clientDirectory: directory });
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const asset = origin + '/assets/game-123.js';
  const br = await rawRequest(asset, { 'Accept-Encoding': 'gzip, br' });
  const gzip = await rawRequest(asset, { 'Accept-Encoding': 'br;q=0.2, gzip;q=0.9' });
  const identity = await rawRequest(asset);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.equal(brotliDecompressSync(br.body).toString(), script);
  assert.equal(gunzipSync(gzip.body).toString(), script);
  assert.equal(identity.body.toString(), script);
  assert.notEqual(br.headers.etag, gzip.headers.etag);
  assert.notEqual(br.headers.etag, identity.headers.etag);
  for (const response of [br, gzip, identity]) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.vary, 'Accept-Encoding');
    assert.equal(Number(response.headers['content-length']), response.body.length);
    assert.match(response.headers['content-type']!, /javascript/);
    assert.match(response.headers['cache-control']!, /immutable/);
  }
  for (const [accepted, expected] of [
    ['', undefined],
    ['*', 'br'],
    ['BR;q=1, gzip;q=0', 'br'],
    ['br;q=0, gzip;q=0.5', 'gzip'],
    ['br;q=0.5, identity;q=1', undefined],
    ['br;q=0, gzip;q=0', undefined],
    ['*;q=0.5, gzip;q=0', 'br'],
    ['identity;q=0, *;q=0.5', 'br'],
    ['*;q=0, identity;q=1', undefined],
    ['br;q=1.001, gzip;q=1.000', 'gzip'],
    ['br;q=invalid, gzip;q=0.5', 'gzip'],
    ['compress', undefined],
  ] as const) {
    const response = await rawRequest(asset, { 'Accept-Encoding': accepted });
    assert.equal(response.status, 200, accepted);
    assert.equal(response.headers['content-encoding'], expected, accepted);
  }
  for (const accepted of ['*;q=0', 'br;q=0, gzip;q=0, identity;q=0']) {
    const response = await rawRequest(asset, { 'Accept-Encoding': accepted });
    assert.equal(response.status, 406);
    assert.equal(response.headers.vary, 'Accept-Encoding');
    assert.equal(response.body.length, 0);
  }
  assert.equal(
    (await rawRequest(origin + '/tiny.txt', { 'Accept-Encoding': 'br, identity;q=0' })).status,
    406,
  );
  const head = await rawRequest(asset, { 'Accept-Encoding': 'gzip' }, 'HEAD');
  assert.equal(head.headers['content-encoding'], 'gzip');
  assert.equal(head.headers.etag, gzip.headers.etag);
  assert.equal(Number(head.headers['content-length']), gzip.body.length);
  assert.equal(head.body.length, 0);
  for (const method of ['GET', 'HEAD']) {
    const cached = await rawRequest(
      asset,
      { 'Accept-Encoding': 'br', 'If-None-Match': `"other", ${br.headers.etag!.replace(/^W\//, '')}` },
      method,
    );
    assert.equal(cached.status, 304);
    assert.equal(cached.headers['content-encoding'], 'br');
    assert.equal(cached.headers.vary, 'Accept-Encoding');
    assert.equal(cached.headers.etag, br.headers.etag);
    assert.equal(cached.headers['content-length'], undefined);
    assert.equal(cached.body.length, 0);
  }
  assert.equal(
    (await rawRequest(asset, { 'Accept-Encoding': 'gzip', 'If-None-Match': br.headers.etag! })).status,
    200,
  );
  assert.equal((await rawRequest(asset, { 'If-None-Match': '*' })).status, 304);
  const room = await rawRequest(origin + '/?room=ABCD2345', { 'Accept-Encoding': 'br' });
  assert.equal(brotliDecompressSync(room.body).toString(), privatePage);
  assert.equal(room.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(room.headers['cache-control'], 'no-cache');
  const roomCached = await rawRequest(origin + '/auth/callback', {
    'Accept-Encoding': 'br',
    'If-None-Match': room.headers.etag!,
  });
  assert.equal(roomCached.status, 304);
  assert.equal(roomCached.headers['x-robots-tag'], 'noindex, nofollow');
  for (const path of ['/app.html.br', '/app.html.gz', '/assets/game-123.js.br']) {
    assert.equal((await rawRequest(origin + path)).status, 404);
  }
  assert.deepEqual(await readFile(join(directory, 'board.webp')), binary);

  // A source edit cannot keep serving the old sidecars, even before the next build.
  const newer = new Date(Date.now() + 10_000);
  await writeFile(join(directory, 'assets', 'game-123.js'), 'export const updated = true;');
  await utimes(join(directory, 'assets', 'game-123.js'), newer, newer);
  const changed = await rawRequest(asset, {
    'Accept-Encoding': 'br, gzip',
    'If-None-Match': br.headers.etag!,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.headers['content-encoding'], undefined);
  assert.equal(changed.body.toString(), 'export const updated = true;');
  await precompressClient(directory);
  await assert.rejects(stat(join(directory, 'assets', 'game-123.js.br')), { code: 'ENOENT' });
  await assert.rejects(stat(join(directory, 'assets', 'game-123.js.gz')), { code: 'ENOENT' });
});
