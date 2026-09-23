import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../apps/server/src/server.js';
import { startAdminServer } from '../apps/server/src/admin/listener.js';
import {
  HISTORY_CAPACITY,
  RuntimeMetrics,
  bucketSamples,
  metricsHistory,
} from '../apps/server/src/admin/metrics.js';
import type { MetricGauges, MetricSample } from '../apps/server/src/admin/metrics.js';
import type { MetricsHistory } from '../apps/server/src/admin/types.js';
import { newSession } from '../apps/client/src/connection.js';
import { API, raw } from './admin-fixture.js';

const gauges = (n: number): MetricGauges => ({
  sockets: n,
  players: n,
  spectators: 0,
  online: n + 1,
  playing: n,
});

test('a sample joins the history every two windows, and the ring keeps only the newest', () => {
  let n = 0;
  const metrics = new RuntimeMetrics({ windowMs: 1_000_000, capacity: 3, gauges: () => gauges(++n) });
  assert.equal(HISTORY_CAPACITY, 1440, 'a day of one-minute samples');
  metrics.tick();
  assert.equal(metrics.history().length, 0, 'half a minute is not a sample yet');
  for (let i = 0; i < 7; i++) metrics.tick();
  const history = metrics.history();
  assert.equal(history.length, 3, 'four samples taken, the oldest dropped');
  assert.deepEqual(
    history.map((sample) => sample.sockets),
    [2, 3, 4],
    'gauges are read once per sample',
  );
  assert.deepEqual(
    history.map((sample) => sample.online),
    [3, 4, 5],
  );
  for (const sample of history) {
    assert.ok(sample.rssBytes > 0 && sample.heapUsedBytes > 0);
    assert.ok(sample.loopP99Ms >= 0 && sample.cpuPercent >= 0);
  }
  assert.ok(history[0]!.at <= history[2]!.at);
  assert.equal(metrics.history(history[2]!.at + 1).length, 0, 'filtered by time');
});

test('a count that cannot be taken leaves the sample without it, not the history without the sample', () => {
  const metrics = new RuntimeMetrics({
    windowMs: 1_000_000,
    windowsPerSample: 1,
    gauges: () => {
      throw new Error('presence is down');
    },
  });
  metrics.tick();
  const [sample] = metrics.history();
  assert.deepEqual([sample!.sockets, sample!.online, sample!.playing], [0, null, null]);
});

test('longer ranges merge samples: the worst delay and the peak counts, the average CPU', () => {
  const sample = (i: number, over: Partial<MetricSample> = {}): MetricSample => ({
    at: 1000 * i,
    seconds: 60,
    loopP50Ms: i,
    loopP99Ms: 10 * i,
    loopMaxMs: 20 * i,
    cpuPercent: i,
    rssBytes: 100 * i,
    heapUsedBytes: 50 * i,
    sockets: i,
    players: i,
    spectators: 0,
    online: i,
    playing: null,
    ...over,
  });
  const samples = [1, 2, 3, 4, 5, 6, 7].map((i) => sample(i));
  const buckets = bucketSamples(samples, 3);
  // Aligned to the newest sample: [1] [2 3 4] [5 6 7].
  assert.deepEqual(
    buckets.map((bucket) => bucket.at),
    [1000, 4000, 7000],
  );
  const last = buckets.at(-1)!;
  assert.deepEqual(
    [last.loopP99Ms, last.loopMaxMs, last.rssBytes, last.sockets, last.online, last.playing],
    [70, 140, 700, 7, 7, null],
  );
  assert.equal(last.loopP50Ms, 6);
  assert.equal(last.cpuPercent, 6);
  assert.equal(last.seconds, 180);
  assert.equal(bucketSamples(samples, 1), samples, 'a bucket of one changes nothing');
  const history = metricsHistory(new RuntimeMetrics(), '24h', Date.now());
  assert.equal(history.bucketSeconds, 360);
  assert.deepEqual(history.samples, []);
});

test('the metrics endpoint answers a range of the running history, with who was online in each sample', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'catanova-admin-metrics-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const databasePath = join(dir, 'game.sqlite');
  const server = await startServer({ port: 0, databasePath, auth: null, captcha: null });
  t.after(() => server.close());
  // One account in the hub, and nobody at a table.
  server.store.enter('create', newSession('Pat').token, 'Pat');
  const admin = await startAdminServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      auth: { mode: 'local-dev' },
      origin: 'http://127.0.0.1:3100',
      statusDir: join(dir, 'status'),
      revision: null,
    },
    store: server.store,
    runtime: {
      ...server.runtime,
      online: () => [
        { userId: '00000000-0000-4000-8000-000000000042', name: 'Quinn', guest: false, since: 1, tabs: 1 },
      ],
    },
    databasePath,
    assetsDirectory: join(dir, 'no-build'),
    log: () => {},
  });
  t.after(() => admin.close());
  const get = async (path: string, status = 200) => {
    const response = await raw(admin.port, path, { headers: API });
    assert.equal(response.status, status, response.body);
    return JSON.parse(response.body) as MetricsHistory;
  };
  const empty = await get('/api/admin/metrics');
  assert.equal(empty.range, '1h');
  assert.equal(empty.bucketSeconds, 60);
  assert.deepEqual(empty.samples, [], 'nothing yet: the history starts with the process');
  assert.ok(empty.since <= empty.now);
  assert.ok(empty.current.rssBytes > 0 && empty.current.window.eventLoop.p99Ms >= 0);
  admin.metrics.tick();
  admin.metrics.tick();
  const [sample] = (await get('/api/admin/metrics?range=6h')).samples;
  assert.deepEqual([sample!.online, sample!.playing, sample!.sockets], [1, 0, 0]);
  await get('/api/admin/metrics?range=2h', 400);
  await get('/api/admin/metrics?range=constructor', 400);
});
