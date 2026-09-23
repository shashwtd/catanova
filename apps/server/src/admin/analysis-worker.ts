/**
 * Runs one analysis job on its own read-only connection, off the game's event
 * loop. The read transaction gives the whole job one consistent snapshot; in
 * WAL mode it never blocks the game's writes.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { computeRetention, computeStats } from './analysis.js';
import type { AnalysisJob } from './analysis-runner.js';

const { databasePath, job } = workerData as { databasePath: string; job: AnalysisJob };
let db: DatabaseSync | undefined;
try {
  db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; BEGIN');
  const result = job.kind === 'stats' ? computeStats(db, job.now) : computeRetention(db, job.now, job.days);
  db.exec('COMMIT');
  parentPort!.postMessage({ ok: true, result });
} catch (error) {
  parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Analysis failed' });
} finally {
  db?.close();
}
