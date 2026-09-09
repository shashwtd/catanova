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
  await writeFile(join(client, 'assets', 'game-123.js'), 'export const game = true;');
  await writeFile(join(client, 'assets', 'font-123.woff2'), 'test font');
  await writeFile(join(dir, 'private.txt'), 'must remain private');
  const server = await startServer({ port: 0, databasePath: ':memory:', clientDirectory: client });
  t.after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Catanova/);
  assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const path of ['/room/ABCD2345', '/room/abcd2345/']) {
    const invitation = await fetch(origin + path);
    assert.equal(invitation.status, 200);
    assert.match(await invitation.text(), /Catanova/);
    assert.equal(invitation.headers.get('cache-control'), 'no-cache');
  }
  const font = await fetch(`${origin}/assets/font-123.woff2`);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  const asset = await fetch(`${origin}/assets/game-123.js`);
  assert.match(asset.headers.get('cache-control')!, /immutable/);
  assert.match(asset.headers.get('content-type')!, /javascript/);
  for (const path of [
    '/..%2fprivate.txt',
    '/%2e%2e/private.txt',
    '/.env',
    '/data/probe.sqlite',
    '/assets/',
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
