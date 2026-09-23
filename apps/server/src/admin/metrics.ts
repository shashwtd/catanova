/**
 * Event-loop delay and CPU use, measured in fixed windows, and a day of them
 * kept in memory.
 *
 * The histogram samples how late the event loop runs its timers, which is what
 * players feel as lag: every move, broadcast and SQLite commit waits for it.
 * Windows rather than totals since start, so a spike an hour ago does not hide
 * whether the server is healthy now.
 *
 * Every minute (two 30-second windows) a sample joins a ring of the last 24
 * hours: the worst delay of the minute, its average CPU, memory, and what the
 * `gauges` callback reports (sockets, people online and playing). The ring is
 * in memory only, a few hundred kilobytes, and starts empty when the process
 * does.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';
import { availableParallelism, loadavg } from 'node:os';
import type { MetricsHistory, MetricsRange } from './types.js';

export type LoopWindow = {
  /** When this reading was taken. */
  at: number;
  seconds: number;
  eventLoop: { p50Ms: number; p99Ms: number; maxMs: number; meanMs: number };
  /** Process CPU time as a share of one core, over the same window. */
  cpuPercent: number;
};

/** Counts taken at the end of each sample: connections, and people online and playing. */
export type MetricGauges = {
  sockets: number;
  players: number;
  spectators: number;
  /** Null where they could not be counted. */
  online: number | null;
  playing: number | null;
};

/**
 * One minute of history. Delays are the worst window's (p99, max) and the
 * windows' average (p50); CPU is averaged over the minute; memory and the
 * gauges are read at its end.
 */
export type MetricSample = MetricGauges & {
  at: number;
  seconds: number;
  loopP50Ms: number;
  loopP99Ms: number;
  loopMaxMs: number;
  cpuPercent: number;
  rssBytes: number;
  heapUsedBytes: number;
};

/** How often the histogram samples. Each sample is the time since the last one, so this is subtracted. */
const RESOLUTION_MS = 10;
/** One history sample a minute, for a day. */
export const HISTORY_WINDOWS_PER_SAMPLE = 2;
export const HISTORY_CAPACITY = 24 * 60;
/** Lateness beyond the sampling interval, in milliseconds. */
const late = (nanoseconds: number) =>
  Math.max(0, Math.round((nanoseconds / 1e6 - RESOLUTION_MS) * 100) / 100);
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

const NO_GAUGES: MetricGauges = { sockets: 0, players: 0, spectators: 0, online: null, playing: null };

export class RuntimeMetrics {
  private histogram: IntervalHistogram | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: LoopWindow | null = null;
  private windowStart = performance.now();
  private cpuStart = process.cpuUsage();
  private readonly windowMs: number;
  private readonly windowsPerSample: number;
  private readonly capacity: number;
  private readonly gauges: (() => MetricGauges) | undefined;
  private minute: LoopWindow[] = [];
  private readonly samples: MetricSample[] = [];
  /** When the ring started filling: history before this was lost with the last process. */
  startedAt = Date.now();

  constructor(
    options: {
      windowMs?: number;
      windowsPerSample?: number;
      capacity?: number;
      gauges?: () => MetricGauges;
    } = {},
  ) {
    this.windowMs = options.windowMs ?? 30_000;
    this.windowsPerSample = options.windowsPerSample ?? HISTORY_WINDOWS_PER_SAMPLE;
    this.capacity = options.capacity ?? HISTORY_CAPACITY;
    this.gauges = options.gauges;
  }

  start(): void {
    if (this.histogram) return;
    this.histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    this.histogram.enable();
    this.windowStart = performance.now();
    this.cpuStart = process.cpuUsage();
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), this.windowMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.histogram?.disable();
    this.histogram = null;
    this.timer = null;
  }

  /** Closes the current window; every `windowsPerSample` windows, records a history sample. */
  tick(): void {
    this.last = this.read();
    this.histogram?.reset();
    this.windowStart = performance.now();
    this.cpuStart = process.cpuUsage();
    this.minute.push(this.last);
    if (this.minute.length >= this.windowsPerSample) {
      this.record(this.minute);
      this.minute = [];
    }
  }

  private record(windows: LoopWindow[]): void {
    const seconds = windows.reduce((sum, window) => sum + window.seconds, 0);
    let gauges = NO_GAUGES;
    try {
      gauges = this.gauges?.() ?? NO_GAUGES;
    } catch {
      // A count that cannot be taken is left out of this sample, never the sample itself.
      gauges = NO_GAUGES;
    }
    const memory = process.memoryUsage();
    this.samples.push({
      at: windows.at(-1)!.at,
      seconds: round(seconds, 1),
      loopP50Ms: round(windows.reduce((sum, w) => sum + w.eventLoop.p50Ms, 0) / windows.length),
      loopP99Ms: Math.max(...windows.map((window) => window.eventLoop.p99Ms)),
      loopMaxMs: Math.max(...windows.map((window) => window.eventLoop.maxMs)),
      cpuPercent: round(
        windows.reduce((sum, window) => sum + window.cpuPercent * window.seconds, 0) / Math.max(seconds, 0.1),
        1,
      ),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      ...gauges,
    });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  private read(): LoopWindow {
    const elapsed = Math.max(1, performance.now() - this.windowStart);
    const cpu = process.cpuUsage(this.cpuStart);
    const h = this.histogram;
    return {
      at: Date.now(),
      seconds: Math.round(elapsed / 100) / 10,
      eventLoop:
        h && h.count > 0
          ? {
              p50Ms: late(h.percentile(50)),
              p99Ms: late(h.percentile(99)),
              maxMs: late(h.max),
              meanMs: late(h.mean),
            }
          : { p50Ms: 0, p99Ms: 0, maxMs: 0, meanMs: 0 },
      cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / elapsed) * 1000) / 10,
    };
  }

  /** The last complete window, or the one in progress if none has completed yet. */
  snapshot() {
    return {
      window: this.last ?? this.read(),
      windowSeconds: this.windowMs / 1000,
      loadAverage: loadavg().map((n) => Math.round(n * 100) / 100),
      cores: availableParallelism(),
    };
  }

  /** The samples taken at or after `since`, oldest first. */
  history(since = 0): MetricSample[] {
    return this.samples.filter((sample) => sample.at >= since).map((sample) => ({ ...sample }));
  }
}

/** How far back each range reaches, and how many one-minute samples each of its points merges. */
export const METRICS_RANGES: Record<MetricsRange, { ms: number; bucket: number }> = {
  '1h': { ms: 60 * 60_000, bucket: 1 },
  '6h': { ms: 6 * 60 * 60_000, bucket: 2 },
  '24h': { ms: 24 * 60 * 60_000, bucket: 6 },
};

/** The history for one range, as the metrics endpoint answers it. */
export function metricsHistory(metrics: RuntimeMetrics, range: MetricsRange, now: number): MetricsHistory {
  const { ms, bucket } = METRICS_RANGES[range];
  const memory = process.memoryUsage();
  const { window, windowSeconds } = metrics.snapshot();
  return {
    now,
    since: metrics.startedAt,
    range,
    bucketSeconds: 60 * bucket,
    samples: bucketSamples(metrics.history(now - ms), bucket),
    current: { window, windowSeconds, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
  };
}

/**
 * Samples merged into buckets of `size` consecutive samples, so a day fits a
 * chart: the worst delay, memory and counts in each bucket, and its average
 * p50 and CPU. The last bucket may be partial.
 */
export function bucketSamples(samples: MetricSample[], size: number): MetricSample[] {
  if (size <= 1) return samples;
  const buckets: MetricSample[] = [];
  // Aligned from the newest sample back, so the latest bucket is always full when it can be.
  const start = samples.length % size;
  const groups: MetricSample[][] = start ? [samples.slice(0, start)] : [];
  for (let i = start; i < samples.length; i += size) groups.push(samples.slice(i, i + size));
  for (const group of groups) {
    const max = (pick: (sample: MetricSample) => number) => Math.max(...group.map(pick));
    const maxOrNull = (pick: (sample: MetricSample) => number | null) => {
      const values = group.map(pick).filter((value): value is number => value !== null);
      return values.length ? Math.max(...values) : null;
    };
    const seconds = group.reduce((sum, sample) => sum + sample.seconds, 0);
    buckets.push({
      at: group.at(-1)!.at,
      seconds: round(seconds, 1),
      loopP50Ms: round(group.reduce((sum, sample) => sum + sample.loopP50Ms, 0) / group.length),
      loopP99Ms: max((sample) => sample.loopP99Ms),
      loopMaxMs: max((sample) => sample.loopMaxMs),
      cpuPercent: round(
        group.reduce((sum, sample) => sum + sample.cpuPercent * sample.seconds, 0) / Math.max(seconds, 0.1),
        1,
      ),
      rssBytes: max((sample) => sample.rssBytes),
      heapUsedBytes: max((sample) => sample.heapUsedBytes),
      sockets: max((sample) => sample.sockets),
      players: max((sample) => sample.players),
      spectators: max((sample) => sample.spectators),
      online: maxOrNull((sample) => sample.online),
      playing: maxOrNull((sample) => sample.playing),
    });
  }
  return buckets;
}
