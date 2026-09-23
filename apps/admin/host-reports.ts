import type { StatusFile } from '../server/src/admin/types.js';
import type { Tone } from './ui.js';

/**
 * The host's three reports (deploy/single-vm/OPERATIONS.md#reading-status). Each
 * job replaces its file on every run with `result` (`success` or `failure`),
 * `reason`, `timestamp` and `durationSeconds`. `staleAfterMs` is how long a
 * report may go unrenewed before its job has evidently stopped running: the
 * backup's matches the watchdog's own alert on the newest good backup, the
 * others allow two missed runs.
 */
export const HOST_REPORTS = [
  { key: 'backup', name: 'Backup', every: 'every 15 minutes', staleAfterMs: 35 * 60_000 },
  { key: 'watchdog', name: 'Watchdog', every: 'every 5 minutes', staleAfterMs: 15 * 60_000 },
  { key: 'drill', name: 'Restore drill', every: 'weekly', staleAfterMs: 8 * 24 * 60 * 60_000 },
] as const;

/** Shown first, in this order. */
export const REPORT_FIELDS = ['result', 'reason', 'durationSeconds'];
/** Shown elsewhere (the run time) or saying nothing the heading does not. */
export const HIDDEN_FIELDS = new Set(['timestamp', 'schema', 'kind']);

export type ReportVerdict = { tone: Tone; label: string };

/** When the job says it ran; the file's modification time if it does not say. */
export function reportedAt(file: Extract<StatusFile, { state: 'ok' }>): number {
  const stamp = typeof file.data.timestamp === 'string' ? Date.parse(file.data.timestamp) : NaN;
  return Number.isFinite(stamp) ? stamp : file.modifiedAt;
}

/** A failed run is failing whatever its age; a successful one is only OK while it is recent. */
export function reportVerdict(file: StatusFile, now: number, staleAfterMs: number): ReportVerdict {
  if (file.state === 'missing') return { tone: 'neutral', label: 'Not configured' };
  if (file.state === 'invalid') return { tone: 'critical', label: 'Unreadable' };
  if (file.data.result === 'failure') return { tone: 'critical', label: 'Failing' };
  if (now - reportedAt(file) > staleAfterMs) return { tone: 'warning', label: 'Stale' };
  return file.data.result === 'success'
    ? { tone: 'good', label: 'OK' }
    : { tone: 'warning', label: 'Reported' };
}
