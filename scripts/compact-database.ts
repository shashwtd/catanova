/**
 * Offline maintenance: compact every whole-game journal row, then reclaim the
 * freed space. The running server already compacts old rows in the background;
 * only VACUUM needs the server stopped, because it rewrites the whole file.
 *
 *   node dist/scripts/compact-database.js --database /app/data/probe.sqlite
 *
 * Take a backup first and stop the game container; never run it against a
 * database another process has open.
 */
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../apps/server/src/store.js';

const arg = (name: string) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const path = arg('database');
if (!path) {
  console.error('Usage: compact-database --database <path to the game database>');
  process.exit(2);
}
const file = resolve(path);
const size = () => {
  let bytes = 0;
  for (const suffix of ['', '-wal'])
    try {
      bytes += statSync(file + suffix).size;
    } catch {
      // A missing WAL is fine.
    }
  return bytes;
};
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MiB';
const before = size();
const store = new Store(file);
try {
  let compacted = 0,
    kept = 0;
  for (;;) {
    const batch = store.compactJournal(500);
    compacted += batch.compacted;
    kept += batch.scanned - batch.compacted;
    if (batch.scanned === 0) break;
  }
  // VACUUM rewrites the database through the WAL, so checkpoint afterwards to
  // hand the space back and leave the file self-contained.
  store.db.exec('VACUUM');
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  console.log(
    JSON.stringify({ compacted, keptAsWritten: kept, before: mb(before), after: mb(size()) }, null, 2),
  );
  if (kept) console.log('Rows kept as written failed their own hash check; see verifyJournal for details.');
} finally {
  store.close();
}
