/**
 * The restore rehearsal, end to end: really played games, backed up by backup.py's own
 * snapshot and compression while the game still has the database open, restored and checked by
 * restore_drill.py with the real game verifier, and then served by the real server, where the
 * person whose turn it was reconnects and plays on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Store } from '../apps/server/src/store.js';
import { startServer } from '../apps/server/src/server.js';
import { Connection } from '../apps/client/src/connection.js';
import { buildPlayedDatabase, seatTokens } from './restore-fixture.js';

const python = spawnSync('python3', ['--version']).status === 0;
const hasJournalCheck = typeof (Store.prototype as { verifyJournal?: unknown }).verifyJournal === 'function';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test(
  'a played match survives backup, restore drill and a real server restart from the verified copy',
  { skip: python ? false : 'python3 is needed to run backup.py and the restore drill' },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'catanova-drill-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const folder of ['data', 'work', 'server']) mkdirSync(join(root, folder));
    const live = join(root, 'data', 'probe.sqlite');
    const { store, rooms } = await buildPlayedDatabase(live);

    // What a player sees at the moment of the backup, recorded while the game is still open.
    const before = store.loadGame(rooms.inProgress)!;
    const active = before.players[before.active]!;
    const revision = store.snapshot(rooms.inProgress).revision;
    assert.equal(before.phase, 'actions');

    // backup.py snapshots through SQLite's backup API while the Store holds the WAL open.
    const written = JSON.parse(
      execFileSync(
        'python3',
        ['-B', 'deploy/single-vm/backup/backup.py', '--local-output', join(root, 'backup.sqlite.gz')],
        { env: { ...process.env, CATANOVA_BACKUP_DATABASE_PATH: live }, encoding: 'utf8' },
      ).replace(/^backup written /, ''),
    ) as { sha256: string; snapshotBytes: number };
    store.close();
    const archive = readFileSync(join(root, 'backup.sqlite.gz'));
    assert.equal(written.sha256, sha256(archive));

    const drill = (file: string, digest: string, ...extra: string[]) =>
      spawnSync(
        'python3',
        [
          '-B',
          'deploy/single-vm/backup/restore_drill.py',
          '--file',
          file,
          '--sha256',
          digest,
          '--verifier-command',
          `${JSON.stringify(process.execPath)} --import tsx scripts/verify-restored-games.ts`,
          '--work-directory',
          join(root, 'work'),
          '--no-report',
          ...(hasJournalCheck ? [] : ['--allow-missing-journal-check']),
          ...extra,
        ],
        { encoding: 'utf8', env: { ...process.env, CATANOVA_STATUS_DIRECTORY: join(root, 'status') } },
      );

    const verified = join(root, 'verified.sqlite');
    const passed = drill(join(root, 'backup.sqlite.gz'), written.sha256, '--output', verified);
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.match(passed.stdout, /SHA-256 [0-9a-f]{64} matches the recorded checksum/);
    assert.match(passed.stdout, /SQLite integrity_check, foreign_key_check and required tables passed/);
    assert.match(passed.stdout, new RegExp(`PASS ${rooms.inProgress}  3 players, turn \\d+, actions`));
    assert.match(passed.stdout, /RESULT: PASS - 5 games in 6 rooms verified/);
    assert.match(passed.stdout, /restore drill passed: 5 games in 6 rooms verified/);
    assert.equal(sha256(readFileSync(verified)), sha256(gunzipSync(archive)));

    // One changed game row in an otherwise perfect backup is found and named.
    const tampered = join(root, 'tampered.sqlite');
    writeFileSync(tampered, gunzipSync(archive));
    const db = new DatabaseSync(tampered);
    db.prepare(
      "UPDATE games SET state = json_set(state, '$.bank.ore', json_extract(state, '$.bank.ore') - 1) WHERE room_id = ?",
    ).run(rooms.inProgress);
    db.close();
    const tamperedArchive = gzipSync(readFileSync(tampered));
    writeFileSync(join(root, 'tampered.sqlite.gz'), tamperedArchive);
    const failed = drill(join(root, 'tampered.sqlite.gz'), sha256(tamperedArchive));
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout, new RegExp(`FAIL ${rooms.inProgress}`));
    assert.match(failed.stdout, /loadGame: STATE_INTEGRITY/);
    assert.match(failed.stderr, /restore drill FAILED: game verification failed for 1 of 6 rooms/);
    assert.match(failed.stderr, new RegExp(`room ${rooms.inProgress}: loadGame: STATE_INTEGRITY`));
    // With the original checksum, the same tampering is refused before anything is opened.
    const refused = drill(join(root, 'tampered.sqlite.gz'), written.sha256);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /SHA-256 mismatch/);
    assert.doesNotMatch(refused.stdout, /restored-game verification/);

    // The verified copy is what a restore installs. Serve it and let the player carry on.
    const databasePath = join(root, 'server', 'probe.sqlite');
    copyFileSync(verified, databasePath);
    const server = await startServer({ port: 0, databasePath, auth: null });
    const player = new Connection(server.url, {
      name: active.name,
      token: seatTokens.get(active.id)!,
      roomId: rooms.inProgress,
      joined: true,
    });
    try {
      player.start();
      await until(
        () => player.status === 'connected' && !!player.state?.game,
        'the player resumes the restored game',
      );
      const view = player.state!.game!;
      assert.equal(player.playerId, active.id);
      assert.equal(player.state!.revision, revision);
      assert.equal(view.phase, 'actions');
      assert.equal(view.turn, before.turn);
      assert.deepEqual(view.players.find((p) => p.id === active.id)!.hand, active.hand);
      const ack = await player.action({ kind: 'endTurn' });
      assert.equal(ack.revision, revision + 1);
      await until(() => player.state!.revision >= revision + 1, 'the restored game accepts the next move');
      assert.notEqual(player.state!.game!.players[player.state!.game!.active]!.id, active.id);
    } finally {
      player.stop();
      await server.close();
    }
  },
);
