import { useSyncExternalStore } from 'react';
import { initialMetrics } from './connection.js';
import type { NetworkMetrics } from './connection.js';

/** Timers count whole seconds on a 250 ms tick; a smaller clock correction is lost in that tick. */
export const CLOCK_OFFSET_TOLERANCE_MS = 100;

/**
 * Probe results arrive every few seconds. Held here rather than in App state, a
 * probe re-renders only what displays it, not the board, hand and HUD around it.
 */
export class NetworkMetricsFeed {
  private metrics = initialMetrics();
  private offset: number | undefined;
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly current = () => this.metrics;
  /** The server clock offset for timers, moved only by a correction they could show. */
  readonly clockOffset = () => this.offset;
  publish(metrics: NetworkMetrics) {
    const next = metrics.clockOffsetMs;
    if (
      next === undefined ||
      this.offset === undefined ||
      Math.abs(next - this.offset) > CLOCK_OFFSET_TOLERANCE_MS
    )
      this.offset = next;
    this.metrics = metrics;
    for (const listener of this.listeners) listener();
  }
}
export const useNetworkMetrics = (feed: NetworkMetricsFeed) =>
  useSyncExternalStore(feed.subscribe, feed.current);
export const useClockOffset = (feed: NetworkMetricsFeed) =>
  useSyncExternalStore(feed.subscribe, feed.clockOffset);
