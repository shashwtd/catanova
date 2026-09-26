/**
 * Release A reads before any release writes: a game saved by a newer release, in a mode this version does not
 * know, is refused on every path that reads a saved game, and left exactly as it was. docs/GAME-MODES.md,
 * "The staged rollout".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import type { Seat } from '../apps/server/src/store.js';
import { encodeState } from '../apps/server/src/journal.js';
import { computeGameAnalytics } from '../apps/server/src/admin/game-analytics.js';
import { computeStats } from '../apps/server/src/admin/analysis.js';
import { openGame } from '../apps/server/src/admin/rooms.js';
import { readMatches } from '../scripts/reporting/retention.js';
import { formatReport, gameInvariantProblems, verifyStore } from '../scripts/verify-restored-games.js';
import { newSession } from '../apps/client/src/connection.js';
import { activePlayer } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { timeoutAction } from '../packages/rules/src/timeout.js';

const NEWER = 'big-table-v2';
let commands = 0;
/** A two-player Classic game played through setup and a few turns, every move through Store.action. */
function played(store: Store, turns: number) {
  const host = newSession('Host'),
    guest = newSession('Guest');
  const a = store.enter('create', host.token, host.name);
  const b = store.enter('join', guest.token, guest.name, a.room_id);
  const roomId = a.room_id;
  store.setConnected(a, true);
  store.setConnected(b, true);
  store.lobby(b, `ready-${++commands}`, store.snapshot(roomId).revision, true);
  store.action(a, `start-${++commands}`, store.snapshot(roomId).revision, { kind: 'start' });
  for (let step = 0; step < 400; step++) {
    const game = store.loadGame(roomId)!;
    if (game.turn > turns) break;
    const actor = game.phase === 'discard' ? Object.keys(game.discards)[0]! : activePlayer(game).id;
    const action: GameAction = timeoutAction(game, actor, () => 0.42)!;
    const seat: Seat = { id: actor, name: actor, room_id: roomId };
    store.action(seat, `move-${++commands}`, store.snapshot(roomId).revision, action);
  }
  return { roomId, seats: [a, b] };
}

/**
 * What a newer release leaves behind: the same game, every journal row and the saved game naming a ruleset
 * this version does not know, hashes and links intact. `whole` keeps rows as whole JSON, as rows written
 * before compaction are.
 */
function fromNewerRelease(store: Store, roomId: string, whole = false) {
  const rows = store.db
    .prepare('SELECT revision, previous_hash FROM game_events WHERE room_id = ? ORDER BY revision')
    .all(roomId) as { revision: number; previous_hash: string | null }[];
  let previous = rows[0]!.previous_hash,
    last = '';
  for (const { revision } of rows) {
    const game = store.journalState(roomId, revision)!;
    game.ruleset = NEWER;
    last = JSON.stringify(game);
    const encoded = encodeState(game, last);
    store.db
      .prepare('INSERT OR IGNORE INTO journal_boards(hash, board) VALUES (?, ?)')
      .run(encoded.boardHash, encoded.board);
    store.db
      .prepare(
        'UPDATE game_events SET state = ?, state_z = ?, board_hash = ?, state_hash = ?, previous_hash = ? WHERE room_id = ? AND revision = ?',
      )
      .run(
        whole ? last : '{}',
        whole ? null : encoded.compact,
        whole ? null : encoded.boardHash,
        encoded.stateHash,
        previous,
        roomId,
        revision,
      );
    previous = encoded.stateHash;
  }
  store.db.prepare('UPDATE games SET state = ? WHERE room_id = ?').run(last, roomId);
  return JSON.parse(last) as Game;
}

/** The game's last row, rewritten as a finished game with a winner, the way its journal would end. */
function finishLastRow(store: Store, roomId: string) {
  const { revision } = store.db
    .prepare('SELECT max(revision) AS revision FROM game_events WHERE room_id = ?')
    .get(roomId) as { revision: number };
  const game = store.journalState(roomId, revision)!;
  game.phase = 'finished';
  game.winner = game.players[0]!.id;
  const text = JSON.stringify(game),
    encoded = encodeState(game, text);
  store.db
    .prepare('INSERT OR IGNORE INTO journal_boards(hash, board) VALUES (?, ?)')
    .run(encoded.boardHash, encoded.board);
  store.db
    .prepare(
      "UPDATE game_events SET state = '{}', state_z = ?, board_hash = ?, state_hash = ? WHERE room_id = ? AND revision = ?",
    )
    .run(encoded.compact, encoded.boardHash, encoded.stateHash, roomId, revision);
}

const rowsOf = (store: Store, roomId: string) =>
  JSON.stringify(
    ['games', 'turn_clocks', 'room_presence', 'game_events'].map((table) =>
      store.db.prepare(`SELECT * FROM ${table} WHERE room_id = ? ORDER BY 1`).all(roomId),
    ),
  );

test('a game in a mode this version does not know is refused on load and left untouched at start-up', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-unknown-ruleset-'));
  const path = join(directory, 'game.sqlite');
  let store = new Store(path, { trackPresence: true });
  try {
    const newer = played(store, 3);
    const classic = played(store, 3);
    fromNewerRelease(store, newer.roomId);
    assert.throws(
      () => store.loadGame(newer.roomId),
      (error: Error & { code?: string }) =>
        error.code === 'VERSION_MISMATCH' && /compatible server version/.test(error.message),
    );
    assert.equal(store.roomMode(newer.roomId), NEWER, 'the room still says what it is');
    assert.ok(store.loadGame(classic.roomId));
    // A restart rewrites the presence of the games it can play, and leaves this one exactly as it was.
    const before = rowsOf(store, newer.roomId);
    const classicPresence = store.db
      .prepare('SELECT state FROM room_presence WHERE room_id = ?')
      .get(classic.roomId);
    store.close();
    store = new Store(path, { trackPresence: true });
    assert.equal(rowsOf(store, newer.roomId), before);
    assert.notDeepEqual(
      store.db.prepare('SELECT state FROM room_presence WHERE room_id = ?').get(classic.roomId),
      classicPresence,
      'a Classic game at the same restart gets its recovery grace',
    );
    // Neither a player nor the clock can move it, and the clock stops asking.
    // Joining, resuming and watching all read the room's snapshot, which refuses it.
    assert.throws(
      () => store.snapshot(newer.roomId, newer.seats[0]!.id),
      (error: Error & { code?: string }) => error.code === 'VERSION_MISMATCH',
    );
    assert.throws(
      () => store.expireRoom(newer.roomId),
      (error: Error & { code?: string }) => error.code === 'VERSION_MISMATCH',
    );
    store.db.prepare('UPDATE turn_clocks SET next_deadline = 0 WHERE room_id = ?').run(newer.roomId);
    assert.ok(!store.dueRooms().includes(newer.roomId));
    // The admin console shows the refusal instead of the game.
    assert.deepEqual(openGame(store, newer.roomId), { error: 'VERSION_MISMATCH' });
    assert.ok(openGame(store, classic.roomId).game);
    // The account history skips it rather than failing.
    assert.doesNotThrow(() => store.accountGames('nobody'));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the journal compactor leaves a newer mode’s rows untouched and still finishes', () => {
  const store = new Store(':memory:');
  try {
    const newer = played(store, 2);
    const classic = played(store, 2);
    fromNewerRelease(store, newer.roomId, true);
    // The Classic game's rows are made whole again too, as rows from before compaction are.
    for (const { revision } of store.db
      .prepare('SELECT revision FROM game_events WHERE room_id = ?')
      .all(classic.roomId) as { revision: number }[]) {
      const text = JSON.stringify(store.journalState(classic.roomId, revision));
      store.db
        .prepare(
          'UPDATE game_events SET state = ?, state_z = NULL, board_hash = NULL WHERE room_id = ? AND revision = ?',
        )
        .run(text, classic.roomId, revision);
    }
    const before = JSON.stringify(
      store.db.prepare('SELECT * FROM game_events WHERE room_id = ? ORDER BY revision').all(newer.roomId),
    );
    let passes = 0;
    while (store.compactJournal(5).scanned > 0) assert.ok(++passes < 1000, 'compaction finishes');
    assert.equal(
      JSON.stringify(
        store.db.prepare('SELECT * FROM game_events WHERE room_id = ? ORDER BY revision').all(newer.roomId),
      ),
      before,
    );
    assert.equal(
      store.db
        .prepare('SELECT count(*) AS n FROM game_events WHERE room_id = ? AND state_z IS NULL')
        .get(classic.roomId)!.n,
      0,
      'the Classic rows were compacted',
    );
    assert.deepEqual(store.verifyJournal(classic.roomId).problems, []);
  } finally {
    store.close();
  }
});

test('the restore verifier and the admin reads name a newer mode’s game instead of reading it', () => {
  const store = new Store(':memory:');
  try {
    const newer = played(store, 3);
    const classic = played(store, 3);
    const game = fromNewerRelease(store, newer.roomId);
    assert.deepEqual(gameInvariantProblems(game), [
      'the game plays ruleset big-table-v2, which this release does not know, so it was not checked; verify it with the release that wrote it',
    ]);
    const report = verifyStore(store);
    const room = report.details.find((detail) => detail.roomId === newer.roomId)!;
    assert.equal(room.status, 'failed');
    assert.equal(room.ruleset, NEWER);
    assert.match(room.problems[0]!, /ruleset big-table-v2, which this release does not know/);
    assert.equal(report.details.find((detail) => detail.roomId === classic.roomId)!.status, 'verified');
    assert.match(
      formatReport('restored.sqlite', 1, report),
      /FAIL \S+ {2}a big-table-v2 game this release cannot load/,
    );
    // Game analytics refuses it; the dice statistics leave its rolls out; retention reads no ending from it.
    const head = (roomId: string) =>
      (
        store.db
          .prepare('SELECT max(revision) AS revision FROM game_events WHERE room_id = ?')
          .get(roomId) as {
          revision: number;
        }
      ).revision;
    assert.throws(
      () =>
        computeGameAnalytics(store.db, {
          roomId: newer.roomId,
          archiveId: null,
          toRevision: head(newer.roomId),
        }),
      /big-table-v2, a mode this version cannot read/,
    );
    assert.ok(
      computeGameAnalytics(store.db, {
        roomId: classic.roomId,
        archiveId: null,
        toRevision: head(classic.roomId),
      }),
    );
    const rolls = (roomId: string) =>
      store.db
        .prepare(
          "SELECT count(*) AS n FROM game_events WHERE room_id = ? AND json_extract(public_entry, '$.kind') = 'roll'",
        )
        .get(roomId)!.n as number;
    assert.ok(rolls(newer.roomId) > 0);
    assert.equal(computeStats(store.db, Date.now()).dice.overall.rolls, rolls(classic.roomId));
    // The retention report reads how each match ended from its last row. Both games' journals now end
    // finished: the Classic one is read, and the newer mode's is left unread, as if its row were missing.
    finishLastRow(store, classic.roomId);
    finishLastRow(store, newer.roomId);
    const outcome = (roomId: string) =>
      readMatches(store.db).matches.find((match) => match.room === roomId)!.outcome;
    assert.equal(outcome(classic.roomId), 'finishedUnknown');
    assert.equal(outcome(newer.roomId), 'running');
  } finally {
    store.close();
  }
});
