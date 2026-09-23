/**
 * Event-loop delay and CPU use, measured in fixed windows.
 *
 * The histogram samples how late the event loop runs its timers, which is what
 * players feel as lag: every move, broadcast and SQLite commit waits for it.
 * Windows rather than totals since start, so a spike an hour ago does not hide
 * whether the server is healthy now.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';
import { availableParallelism, loadavg } from 'node:os';

export type LoopWindow = {
  /** When this reading was taken. */
  at: number;
  seconds: number;
  eventLoop: { p50Ms: number; p99Ms: number; maxMs: number; meanMs: number };
  /** Process CPU time as a share of one core, over the same window. */
  cpuPercent: number;
};

/** How often the histogram samples. Each sample is the time since the last one, so this is subtracted. */
const RESOLUTION_MS = 10;
/** Lateness beyond the sampling interval, in milliseconds. */
const late = (nanoseconds: number) =>
  Math.max(0, Math.round((nanoseconds / 1e6 - RESOLUTION_MS) * 100) / 100);

export class RuntimeMetrics {
  private histogram: IntervalHistogram | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: LoopWindow | null = null;
  private windowStart = performance.now();
  private cpuStart = process.cpuUsage();

  constructor(private readonly windowMs = 30_000) {}

  start(): void {
    if (this.histogram) return;
    this.histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    this.histogram.enable();
    this.windowStart = performance.now();
    this.cpuStart = process.cpuUsage();
    this.timer = setInterval(() => {
      this.last = this.read();
      this.histogram?.reset();
      this.windowStart = performance.now();
      this.cpuStart = process.cpuUsage();
    }, this.windowMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.histogram?.disable();
    this.histogram = null;
    this.timer = null;
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
}
