import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMatches, summarize, type Window } from './reporting/retention.js';
import { renderCsv, renderHtml } from './reporting/render.js';

export function reportSnapshot(snapshot: string, output: string, window: Window) {
  // Use a SQLite backup, not a copy of a live database's main file without its WAL.
  if (!existsSync(snapshot)) throw new Error('Snapshot does not exist');
  if (existsSync(snapshot + '-wal') || existsSync(snapshot + '-shm'))
    throw new Error('Use an isolated, closed SQLite backup without WAL/SHM sidecars');
  // SQLite can create WAL/SHM sidecars even for a read-only connection. Keep those
  // in a disposable working directory, never beside the owner's snapshot.
  const temporary = mkdtempSync(resolve(tmpdir(), 'catanova-report-'));
  let db: DatabaseSync | undefined;
  try {
    const working = resolve(temporary, 'snapshot.sqlite');
    copyFileSync(snapshot, working);
    if (existsSync(snapshot + '-wal') || existsSync(snapshot + '-shm'))
      throw new Error('Snapshot became active while copying');
    db = new DatabaseSync(working, { readOnly: true });
    db.exec('PRAGMA query_only=ON; BEGIN');
    if (
      db
        .prepare('PRAGMA integrity_check')
        .all()
        .some((r) => Object.values(r)[0] !== 'ok')
    )
      throw new Error('Snapshot integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Snapshot foreign-key check failed');
    const latest = db.prepare("SELECT max(json_extract(public_entry,'$.at')) at FROM game_events").get()?.at;
    if (typeof latest === 'string' && Date.parse(latest) > window.asOf)
      throw new Error('As-of predates data in this snapshot; use its capture time');
    const { matches, unindexed, duplicates } = readMatches(db);
    const metrics = summarize(matches, window);
    metrics.push(
      { section: 'Coverage', metric: 'Unindexed saved games (excluded)', value: unindexed },
      { section: 'Coverage', metric: 'Duplicate records excluded', value: duplicates },
    );
    mkdirSync(output, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(output, 'retention.html'), renderHtml(metrics, window), { mode: 0o600 });
    writeFileSync(resolve(output, 'retention.csv'), renderCsv(metrics), { mode: 0o600 });
    return metrics;
  } finally {
    db?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const help =
    'Usage: npm run report:retention -- --snapshot /path/to/closed-backup.sqlite --as-of 2026-09-21T12:00:00Z --from 2026-09-01T00:00:00Z --to 2026-09-21T12:00:00Z --out /private/report';
  try {
    if (args.includes('--help')) {
      console.log(help);
    } else {
      const values = new Map<string, string>();
      for (let i = 0; i < args.length; i += 2) {
        if (
          !['--snapshot', '--as-of', '--from', '--to', '--out'].includes(args[i]!) ||
          !args[i + 1] ||
          values.has(args[i]!)
        )
          throw new Error(help);
        values.set(args[i]!, args[i + 1]!);
      }
      if (values.size !== 5) throw new Error(help);
      const date = (key: string) => {
        const value = values.get(key)!;
        if (
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
          !Number.isFinite(Date.parse(value))
        )
          throw new Error(`${key} must be a UTC ISO timestamp`);
        return Date.parse(value);
      };
      const window = { from: date('--from'), to: date('--to'), asOf: date('--as-of') };
      const output = resolve(values.get('--out')!);
      reportSnapshot(resolve(values.get('--snapshot')!), output, window);
      console.log(`Aggregate report written to ${output}/retention.html and retention.csv`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Report failed');
    process.exitCode = 1;
  }
}
