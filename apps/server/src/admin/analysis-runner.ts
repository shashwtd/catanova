/**
 * Runs the expensive admin reads in a worker thread and caches the answers.
 *
 * Statistics and the retention report scan the whole match index and, for
 * dice, every roll in the journal. `node:sqlite` is synchronous, so doing that
 * on the game's own connection would stall every table in play for as long as
 * the scan takes. Each job instead gets a short-lived worker with its own
 * read-only connection, one job of each kind at a time, and its answer is kept
 * for a few minutes. A job past its timeout is answered with an error at once,
 * but its thread can only stop once SQLite returns, so no job of that kind
 * starts again until the thread has exited.
 */
import { Worker } from 'node:worker_threads';
import type { DatabaseSync } from 'node:sqlite';
import { AdminRequestError } from './api.js';
import { computeRetention, computeStats } from './analysis.js';
import { serverErrors } from './errors.js';
import type { AdminStats, Cached, RetentionReport } from './types.js';

const noop = () => {};

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
  private readonly stopping = new Set<string>();

  constructor(
    private readonly options: {
      databasePath: string;
      /** Used directly only for a private in-memory database, which no other thread can open. */
      db: DatabaseSync;
      now: () => number;
      timeoutMs?: number;
    },
  ) {}

  /** The answer, and when the thread that computed it has exited. */
  private run<T>(job: AnalysisJob): { result: Promise<T>; exited: Promise<void> } {
    if (this.options.databasePath === ':memory:') {
      const result = Promise.resolve().then(
        () =>
          (job.kind === 'stats'
            ? computeStats(this.options.db, job.now)
            : computeRetention(this.options.db, job.now, job.days)) as T,
      );
      return { result, exited: result.then(noop, noop) };
    }
    const worker = new Worker(WORKER, {
      workerData: { databasePath: this.options.databasePath, job },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
    const result = new Promise<T>((resolve, reject) => {
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
            // Stops the thread once its current SQLite statement returns; it cannot interrupt one.
            void worker.terminate();
            serverErrors.record('admin', `The ${job.kind} analysis took too long and was stopped`);
            reject(
              new AdminRequestError(503, 'ANALYSIS_TIMEOUT', 'The analysis took too long and was stopped'),
            );
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
    return { result, exited };
  }

  private async cached<T>(key: string, maxAge: number, job: () => AnalysisJob): Promise<Cached<T>> {
    const hit = this.cache.get(key);
    if (hit && this.options.now() - hit.at < maxAge)
      return { value: hit.value as T, cachedAt: hit.at, fresh: false };
    let pending = this.running.get(key) as Promise<{ at: number; value: T }> | undefined;
    if (!pending) {
      // A run that failed or was given up on keeps its kind closed until its thread has exited:
      // it may still be scanning, and a second scan beside it would only double the load.
      if (this.stopping.has(key))
        throw new AdminRequestError(
          503,
          'ANALYSIS_BUSY',
          'The last run took too long and is still stopping. Try again shortly.',
        );
      const next = job();
      const { result, exited } = this.run<T>(next);
      pending = result.then((value) => {
        this.cache.set(key, { at: next.now, value });
        return { at: next.now, value };
      });
      this.running.set(key, pending);
      void pending.then(
        () => this.running.delete(key),
        () => {
          this.running.delete(key);
          this.stopping.add(key);
          void exited.then(() => this.stopping.delete(key));
        },
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
