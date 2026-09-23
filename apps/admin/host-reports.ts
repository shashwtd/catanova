import type { StatusFile } from '../server/src/admin/types.js';
import { bytes, count, duration, time } from './format.js';
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
/** Names for the fields the host's scripts write; anything else is spelled out from its key. */
const FIELD_LABELS: Record<string, string> = { reason: 'Reason', durationSeconds: 'Took', bytes: 'Size' };

/** `lastGoodBackup` or `last_good_backup` as "Last good backup". */
export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A field's value as text: sizes, durations and times in words, a nested object as its pairs. */
export function fieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (/seconds$/i.test(key)) return value < 60 ? `${Math.round(value * 10) / 10} s` : duration(value);
    if (/bytes$/i.test(key)) return bytes(value);
    return count(value);
  }
  if (typeof value === 'string') {
    const at = /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(at) ? time(at) : value;
  }
  if (Array.isArray(value))
    return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  return Object.entries(value as Record<string, unknown>)
    .map(([name, item]) => `${fieldLabel(name).toLowerCase()} ${fieldValue(name, item)}`)
    .join(' · ');
}

/**
 * A report's fields in reading order, as label and text. The run time is
 * shown on its own and the result is the badge, so neither repeats here.
 */
export function reportFields(file: Extract<StatusFile, { state: 'ok' }>) {
  return Object.entries(file.data)
    .filter(
      ([key, value]) =>
        !HIDDEN_FIELDS.has(key) && !(key === 'result' && (value === 'success' || value === 'failure')),
    )
    .sort(
      ([a], [b]) =>
        (REPORT_FIELDS.indexOf(a) + 1 || 99) - (REPORT_FIELDS.indexOf(b) + 1 || 99) || a.localeCompare(b),
    )
    .map(([key, value]) => ({ key, label: fieldLabel(key), value: fieldValue(key, value) }));
}

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
