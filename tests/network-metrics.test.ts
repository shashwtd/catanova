import test from 'node:test';
import assert from 'node:assert/strict';
import { initialMetrics } from '../apps/client/src/connection.js';
import type { NetworkMetrics } from '../apps/client/src/connection.js';
import { CLOCK_OFFSET_TOLERANCE_MS, NetworkMetricsFeed } from '../apps/client/src/network-metrics.js';

/** What useSyncExternalStore does: a subscriber renders only when its snapshot changes. */
function renders<T>(feed: NetworkMetricsFeed, snapshot: () => T) {
  let seen = snapshot(),
    count = 0;
  feed.subscribe(() => {
    if (!Object.is(snapshot(), seen)) {
      seen = snapshot();
      count++;
    }
  });
  return () => count;
}

test('every probe reaches the connection panel while the table renders only for a clock correction', () => {
  const feed = new NetworkMetricsFeed();
  const panel = renders(feed, feed.current),
    table = renders(feed, feed.clockOffset);
  let metrics: NetworkMetrics = initialMetrics();
  const probe = (rtt: number, clockOffsetMs: number) => {
    metrics = {
      ...metrics,
      samples: [...metrics.samples, { at: metrics.samples.length, rtt }],
      clockOffsetMs,
    };
    feed.publish(metrics);
  };
  probe(40, 1200);
  assert.equal(feed.clockOffset(), 1200, 'the first estimate is used at once');
  // A minute of pings every 3 s, with network jitter in each clock estimate.
  for (let i = 0; i < 20; i++) probe(40 + (i % 5) * 9, 1200 + (i % 2 ? 1 : -1) * (i % 7) * 12);
  assert.equal(panel(), 21, 'the panel follows every probe');
  assert.equal(feed.current().samples.length, 21);
  assert.equal(table(), 1, 'jitter never re-renders the table');
  assert.equal(feed.clockOffset(), 1200);
  probe(40, 1200 + CLOCK_OFFSET_TOLERANCE_MS + 1);
  assert.equal(table(), 2, 'a correction timers could show still reaches them');
  feed.publish(initialMetrics());
  assert.equal(feed.clockOffset(), undefined, 'leaving a room forgets the old server clock');
  assert.equal(feed.current().samples.length, 0);
});
