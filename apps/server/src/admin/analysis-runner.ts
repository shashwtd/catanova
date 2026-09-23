/**
 * Runs the expensive admin reads in a worker thread and caches the answers.
 *
 * Statistics and the retention report scan the whole match index and, for
 * dice, every roll in the journal. `node:sqlite` is synchronous, so doing that
 * on the game's own connection would stall every table in play for as long as
 * the scan takes. Each job instead gets a short-lived worker with its own
 * read-only connection, one job of each kind at a time, and its answer is kept
 * for a few minutes.
 */
import { Worker } from 'node:worker_threads';
import type { DatabaseSync } from 'node:sqlite';
import { computeRetention, computeStats } from './analysis.js';
import type { AdminStats, Cached, RetentionReport } from './types.js';

export type AnalysisJob = { kind: 'stats'; now: number } | { kind: 'retention'; now: number; days: number };

export const STATS_CACHE_MS = 5 * 60_000;
/** Refresh can recompute statistics, but not more often than this. */
export const STATS_MIN_REFRESH_MS = 30_000;
export const RETENTION_CACHE_MS = 10 * 60_000;
export const RETENTION_DAYS = [7, 14, 30, 90] as const;

const WORKER = new URL(
  `./analysis-worker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`,
  import.meta.url,
);

export class Analysis {
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(
    private readonly options: {
      databasePath: string;
      /** Used directly only for a private in-memory database, which no other thread can open. */
      db: DatabaseSync;
      now: () => number;
      timeoutMs?: number;
    },
  ) {}

  private run<T>(job: AnalysisJob): Promise<T> {
    if (this.options.databasePath === ':memory:')
      return Promise.resolve().then(
        () =>
          (job.kind === 'stats'
            ? computeStats(this.options.db, job.now)
            : computeRetention(this.options.db, job.now, job.days)) as T,
      );
    return new Promise<T>((resolve, reject) => {
      const worker = new Worker(WORKER, {
        workerData: { databasePath: this.options.databasePath, job },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      let settled = false;
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done();
      };
      const timer = setTimeout(
        () =>
          settle(() => {
            void worker.terminate();
            reject(new Error('The analysis took too long and was stopped'));
          }),
        this.options.timeoutMs ?? 60_000,
      );
      worker.once('message', (message: { ok: boolean; result?: T; error?: string }) =>
        settle(() =>
          message.ok ? resolve(message.result as T) : reject(new Error(message.error ?? 'Analysis failed')),
        ),
      );
      worker.once('error', (error) => settle(() => reject(error)));
      worker.once('exit', (code) => settle(() => reject(new Error(`The analysis stopped (exit ${code})`))));
    });
  }

  private async cached<T>(key: string, maxAge: number, job: () => AnalysisJob): Promise<Cached<T>> {
    const hit = this.cache.get(key);
    if (hit && this.options.now() - hit.at < maxAge)
      return { value: hit.value as T, cachedAt: hit.at, fresh: false };
    let pending = this.running.get(key) as Promise<{ at: number; value: T }> | undefined;
    if (!pending) {
      const next = job();
      pending = this.run<T>(next).then((value) => {
        this.cache.set(key, { at: next.now, value });
        return { at: next.now, value };
      });
      this.running.set(key, pending);
      void pending.then(
        () => this.running.delete(key),
        () => this.running.delete(key),
      );
    }
    const { at, value } = await pending;
    return { value, cachedAt: at, fresh: true };
  }

  stats(refresh = false): Promise<Cached<AdminStats>> {
    return this.cached('stats', refresh ? STATS_MIN_REFRESH_MS : STATS_CACHE_MS, () => ({
      kind: 'stats',
      now: this.options.now(),
    }));
  }

  retention(days: number): Promise<Cached<RetentionReport>> {
    return this.cached(`retention:${days}`, RETENTION_CACHE_MS, () => ({
      kind: 'retention',
      now: this.options.now(),
      days,
    }));
  }

  /** The last report for this window if it is still inside its cache time. */
  cachedRetention(days: number): Cached<RetentionReport> | null {
    const hit = this.cache.get(`retention:${days}`);
    if (!hit || this.options.now() - hit.at >= RETENTION_CACHE_MS) return null;
    return { value: hit.value as RetentionReport, cachedAt: hit.at, fresh: false };
  }
}
