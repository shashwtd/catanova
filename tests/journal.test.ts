import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import { newSession } from '../apps/client/src/connection.js';
import { emptyHand, gameView, robberVictims } from '../packages/rules/src/game.js';
import type { Game, GameAction } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import { readyLobby } from './helpers.js';

/** The simplest legal move for whoever owes one, so a game can run for as long as a test needs. */
function choose(g: Game): { player: string; action: GameAction } {
  let player = g.players[g.active]!.id;
  const legal = gameView(g, player).legal;
  let action: GameAction;
  if (g.phase === 'setupSettlement') action = { kind: 'settlement', vertex: legal.settlements[0]! };
  else if (g.phase === 'setupRoad') action = { kind: 'road', edge: legal.roads[0]! };
  else if (g.phase === 'roll') action = { kind: 'roll' };
  else if (g.phase === 'actions') action = { kind: 'endTurn' };
  else if (g.phase === 'robber') {
    const hex = (g.robber + 1) % 19,
      victim = robberVictims(g, player, hex)[0];
    action = { kind: 'robber', hex, ...(victim ? { victim } : {}) };
  } else {
    player = Object.keys(g.discards)[0]!;
    let left = g.discards[player]!;
    const resources = emptyHand();
    for (const r of RESOURCES) {
      resources[r] = Math.min(left, g.players.find((p) => p.id === player)!.hand[r]);
      left -= resources[r];
    }
    action = { kind: 'discard', resources };
  }
  return { player, action };
}

function playedRoom(store: Store, moves: number): string {
  const host = store.enter('create', newSession('One').token, 'One');
  for (const name of ['Two', 'Three']) store.enter('join', newSession(name).token, name, host.room_id);
  store.action(host, 'start-journal', readyLobby(store, host.room_id), { kind: 'start' });
  for (let i = 0; i < moves; i++) {
    const next = choose(store.loadGame(host.room_id)!);
    const seat = store.snapshot(host.room_id).players.find((p) => p.id === next.player)!;
    store.action(
      { ...seat, room_id: host.room_id },
      `journal-move-${i}`,
      store.snapshot(host.room_id).revision,
      next.action,
    );
  }
  return host.room_id;
}

type Row = { revision: number; phase: string | null; dice_total: number | null; kind: string; state: Game };
function journal(store: Store, roomId: string): Row[] {
  return (
    store.db
      .prepare(
        "SELECT revision, phase, dice_total, json_extract(public_entry,'$.kind') AS kind FROM game_events WHERE room_id=? ORDER BY revision",
      )
      .all(roomId) as Omit<Row, 'state'>[]
  ).map((row) => ({ ...row, state: store.journalState(roomId, row.revision)! }));
}

/** Rewrite a room's journal the way servers before compaction stored it: every row a whole game. */
function asLegacyJournal(store: Store, roomId: string) {
  for (const { revision } of store.db
    .prepare('SELECT revision FROM game_events WHERE room_id=?')
    .all(roomId) as { revision: number }[])
    store.db
      .prepare('UPDATE game_events SET state=?, state_z=NULL, board_hash=NULL WHERE room_id=? AND revision=?')
      .run(JSON.stringify(store.journalState(roomId, revision)), roomId, revision);
}
const storedBytes = (store: Store, roomId: string) =>
  store.db
    .prepare(
      'SELECT sum(length(state)) + coalesce(sum(length(state_z)), 0) AS n FROM game_events WHERE room_id=?',
    )
    .get(roomId)!.n as number;

test('journal rows carry their phase and dice total, and older rows gain them when the database opens', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-journal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'journal.sqlite');
  let store = new Store(path);
  const roomId = playedRoom(store, 160);
  const check = () => {
    const rows = journal(store, roomId);
    const rolls = rows.filter((row) => row.kind === 'roll');
    assert.ok(rolls.length >= 20, 'the scripted game rolls often enough to be meaningful');
    for (const row of rows) {
      assert.equal(row.phase, row.state.phase, `revision ${row.revision} phase`);
      assert.equal(
        row.dice_total,
        row.kind === 'roll' ? row.state.dice![0] + row.state.dice![1] : null,
        `revision ${row.revision} dice`,
      );
    }
    const expected = Array<number>(11).fill(0);
    for (const row of rolls) expected[row.dice_total! - 2]!++;
    assert.deepEqual(store.statistics(roomId).diceCounts, expected);
    assert.equal(store.statistics(roomId).rolls, rolls.length);
  };
  check();
  const before = store.statistics(roomId);
  // A database written before these columns existed: whole games, no extra columns.
  asLegacyJournal(store, roomId);
  store.db.exec('ALTER TABLE game_events DROP COLUMN phase');
  store.db.exec('ALTER TABLE game_events DROP COLUMN dice_total');
  store.close();
  store = new Store(path);
  t.after(() => store.close());
  check();
  assert.deepEqual(store.statistics(roomId), before);
});

test('each move is stored without its board, compressed, and reads back as exactly the state that was hashed', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const roomId = playedRoom(store, 160);
  const rows = store.db
    .prepare(
      'SELECT revision, state, length(state_z) AS size, board_hash, state_hash FROM game_events WHERE room_id=?',
    )
    .all(roomId) as {
    revision: number;
    state: string;
    size: number;
    board_hash: string;
    state_hash: string;
  }[];
  assert.ok(rows.length > 150);
  for (const row of rows) {
    assert.equal(row.state, '', 'no row keeps a whole game');
    const text = JSON.stringify(store.journalState(roomId, row.revision));
    assert.equal(createHash('sha256').update(text).digest('hex'), row.state_hash, `revision ${row.revision}`);
  }
  assert.equal(new Set(rows.map((row) => row.board_hash)).size, 1, 'one board, stored once');
  const average = rows.reduce((n, row) => n + row.size, 0) / rows.length;
  const whole = JSON.stringify(store.loadGame(roomId)).length;
  assert.ok(
    average * 6 < whole,
    `a stored move (${average.toFixed(0)} B) is a fraction of a game (${whole} B)`,
  );
  assert.deepEqual(store.verifyJournal(roomId), { events: rows.length, problems: [] });
});

test('older whole-game rows compact losslessly, and a row that fails its own hash is kept and reported', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const roomId = playedRoom(store, 120);
  const states = journal(store, roomId).map((row) => row.state);
  const statistics = store.statistics(roomId);
  asLegacyJournal(store, roomId);
  const legacyBytes = storedBytes(store, roomId);
  assert.deepEqual(store.verifyJournal(roomId).problems, []);
  // One row whose saved state no longer matches its hash: evidence, not something to tidy away.
  const tampered = journal(store, roomId)[40]!.revision;
  const edited = store.journalState(roomId, tampered)!;
  edited.turn += 1;
  store.db
    .prepare('UPDATE game_events SET state=? WHERE room_id=? AND revision=?')
    .run(JSON.stringify(edited), roomId, tampered);
  let passes = 0;
  while (store.compactJournal(25).scanned > 0) passes++;
  assert.ok(passes >= 4, 'compaction works through the journal in small batches');
  assert.deepEqual(store.compactJournal(25), { scanned: 0, compacted: 0 }, 'and then stops');
  const after = journal(store, roomId);
  for (const [i, row] of after.entries())
    if (row.revision === tampered) assert.equal(row.state.turn, edited.turn);
    else assert.deepEqual(row.state, states[i], `revision ${row.revision}`);
  assert.deepEqual(store.statistics(roomId), statistics);
  assert.deepEqual(store.verifyJournal(roomId).problems, [
    `revision ${tampered}: saved state does not match its hash`,
  ]);
  const compactBytes = storedBytes(store, roomId);
  assert.ok(compactBytes * 5 < legacyBytes, `${legacyBytes} B of whole games became ${compactBytes} B`);
});
