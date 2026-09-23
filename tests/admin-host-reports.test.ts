import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOST_REPORTS,
  fieldLabel,
  fieldValue,
  reportFields,
  reportVerdict,
  reportedAt,
} from '../apps/admin/host-reports.js';
import { time } from '../apps/admin/format.js';
import type { StatusFile } from '../apps/server/src/admin/types.js';

const MINUTE = 60_000;
const now = Date.parse('2026-09-23T12:00:00Z');
const report = (data: Record<string, unknown>, modifiedAt = now): StatusFile => ({
  state: 'ok',
  modifiedAt,
  data,
});
const backup = HOST_REPORTS.find((entry) => entry.key === 'backup')!;
const verdict = (file: StatusFile, staleAfterMs = backup.staleAfterMs) =>
  reportVerdict(file, now, staleAfterMs).label;

test('host reports are judged by their result and by how recently their job ran', () => {
  const at = (minutesAgo: number) => new Date(now - minutesAgo * MINUTE).toISOString();
  assert.deepEqual(reportVerdict({ state: 'missing' }, now, backup.staleAfterMs), {
    tone: 'neutral',
    label: 'Not configured',
  });
  assert.equal(verdict({ state: 'invalid', error: 'Not valid JSON', modifiedAt: now }), 'Unreadable');
  assert.equal(verdict(report({ result: 'success', timestamp: at(10) })), 'OK');
  assert.equal(verdict(report({ result: 'failure', timestamp: at(1) })), 'Failing');
  // A failure stays a failure however old; a success is only OK while its job keeps running.
  assert.equal(verdict(report({ result: 'failure', timestamp: at(600) })), 'Failing');
  assert.equal(verdict(report({ result: 'success', timestamp: at(36) })), 'Stale');
  // Without a readable timestamp, the file's own modification time dates the run.
  assert.equal(verdict(report({ result: 'success' }, now - 40 * MINUTE)), 'Stale');
  assert.equal(reportedAt({ state: 'ok', modifiedAt: 5, data: { timestamp: 'not a time' } }), 5);
  assert.equal(
    verdict(report({ ok: true, timestamp: at(1) })),
    'Reported',
    'an unknown shape is not called OK',
  );
});

test('report fields read as words: sizes, durations, times and nested checks, without repeating the badge', () => {
  const file: StatusFile = {
    state: 'ok',
    modifiedAt: now,
    data: {
      schema: 1,
      kind: 'backup',
      timestamp: '2026-09-23T08:00:00Z',
      result: 'success',
      reason: 'uploaded',
      durationSeconds: 4.1,
      bytes: 1843200,
      lastGoodBackup: '2026-09-23T07:45:00Z',
      checks: { health: 'ok', diskFree: true },
      container: 'catanova-backups',
    },
  };
  assert.deepEqual(
    reportFields(file as Extract<StatusFile, { state: 'ok' }>).map((field) => [field.label, field.value]),
    [
      ['Reason', 'uploaded'],
      ['Took', '4.1 s'],
      ['Size', '1.8 MB'],
      ['Checks', 'health ok · disk free yes'],
      ['Container', 'catanova-backups'],
      ['Last good backup', time(Date.parse('2026-09-23T07:45:00Z'))],
    ],
  );
  assert.equal(fieldValue('durationSeconds', 125), '2m 5s');
  assert.equal(fieldValue('files', 1200), '1,200');
  assert.equal(fieldLabel('restore_drill_status'), 'Restore drill status');
  // An unknown result is not the badge's to say, so it stays.
  assert.deepEqual(
    reportFields({ state: 'ok', modifiedAt: now, data: { result: 'partial' } }).map((field) => field.value),
    ['partial'],
  );
});

test('each report allows its job about two missed runs, matching the host timers', () => {
  const timer = (path: string) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .find((line) => line.startsWith('OnCalendar='));
  const expected = {
    backup: ['deploy/single-vm/backup/catanova-backup.timer', 'OnCalendar=*-*-* *:00/15:00', 35 * MINUTE],
    watchdog: [
      'deploy/single-vm/monitoring/catanova-watchdog.timer',
      'OnCalendar=*-*-* *:02/5:00',
      15 * MINUTE,
    ],
    drill: [
      'deploy/single-vm/backup/catanova-drill.timer',
      'OnCalendar=Wed *-*-* 21:40:00 UTC',
      8 * 24 * 60 * MINUTE,
    ],
  } as const;
  assert.deepEqual(
    HOST_REPORTS.map((entry) => entry.key),
    ['backup', 'watchdog', 'drill'],
  );
  for (const entry of HOST_REPORTS) {
    const [path, schedule, staleAfterMs] = expected[entry.key];
    assert.equal(timer(path), schedule, `${path} changed: update the admin's stale threshold with it`);
    assert.equal(entry.staleAfterMs, staleAfterMs, entry.key);
  }
});
