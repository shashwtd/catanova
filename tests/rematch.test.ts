import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/src/store.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import { parseClientMessage, type RoomState } from '../packages/protocol/src/index.js';
import { snapshotProblem } from '../apps/client/src/state.js';
import { gameView, type GameAction } from '../packages/rules/src/game.js';

const token = () => randomBytes(32).toString('hex');
function crew(store: Store) {
  const players = ['Captain', 'Builder', 'Trader'];
  const enter = (name: string, roomId?: string) =>
    store.enter(roomId ? 'join' : 'create', token(), name, roomId, {
      id: name,
      name,
      profile: defaultProfile(name),
      expiresAt: Date.now() + 100000,
    });
  const host = enter(players[0]!);
  return [host, ...players.slice(1).map((name) => enter(name, host.room_id))];
}
function begin(store: Store, roomId: string, id: string) {
  const room = store.snapshot(roomId);
  for (const p of room.players.slice(1))
    store.lobby({ ...p, room_id: roomId }, token(), store.snapshot(roomId).revision, true);
  store.action({ ...room.players[0]!, room_id: roomId }, id, store.snapshot(roomId).revision, {
    kind: 'start',
  });
}
function roll(store: Store, roomId: string) {
  let game = store.loadGame(roomId)!;
  while (game.turn === 0) {
    const player = game.players[game.active]!;
    const legal = gameView(game, player.id).legal;
    const next: GameAction =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! };
    store.action({ ...player, room_id: roomId }, token(), store.snapshot(roomId).revision, next);
    game = store.loadGame(roomId)!;
  }
  const player = game.players[game.active]!;
  const id = token(),
    revision = store.snapshot(roomId).revision;
  store.action({ ...player, room_id: roomId }, id, revision, { kind: 'roll' });
  store.action({ ...player, room_id: roomId }, id, revision, { kind: 'roll' });
}
function end(store: Store, players: ReturnType<typeof crew>) {
  for (const player of players.slice(1))
    store.leave(player, token(), store.snapshot(player.room_id).revision);
}

test('returning to the same lobby preserves results, code, receipts and event history across restart and a second game', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-rematch-'));
  const path = join(directory, 'game.sqlite');
  let store = new Store(path, { random: () => 0.3 });
  try {
    const players = crew(store),
      host = players[0]!,
      roomId = host.room_id;
    const code = store.roomCode(roomId);
    begin(store, roomId, 'first-start');
    assert.throws(
      () => store.action(host, token(), store.snapshot(roomId).revision, { kind: 'returnToLobby' }),
      /Finish this game/,
    );
    roll(store, roomId);
    assert.equal(store.statistics(roomId).rolls, 1, 'duplicate command does not duplicate roll statistics');
    end(store, players);
    const finished = store.snapshot(roomId, host.id);
    assert.equal(finished.game!.winner, host.id);
    const journalBefore = store.db.prepare('SELECT count(*) AS n FROM game_events').get()!.n;
    const id = token(),
      revision = finished.revision;
    store.action(host, id, revision, { kind: 'returnToLobby' });
    const lobby = store.snapshot(roomId, host.id);
    assert.equal(lobby.roomCode, code);
    assert.equal(lobby.game, undefined);
    assert.equal(lobby.round, revision + 1);
    assert.equal(store.statistics(roomId).rolls, 0);
    assert.deepEqual(store.history(roomId).entries, []);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM game_events').get()!.n, journalBefore);
    assert.equal(snapshotProblem(finished as RoomState, lobby as RoomState), null);
    assert.match(
      snapshotProblem(finished as RoomState, { ...finished, game: undefined } as RoomState)!,
      /missing/,
    );
    assert.equal(store.action(host, id, revision, { kind: 'returnToLobby' }).duplicate, true);
    assert.equal(store.accountGames('Captain').games.length, 1);
    assert.deepEqual(store.accountGames('Captain').stats, { played: 1, wins: 1 });
    store.close();
    store = new Store(path, { random: () => 0.3 });
    assert.equal(store.snapshot(roomId).round, lobby.round);
    assert.equal(store.roomCode(roomId), code);
    const newcomer = store.enter('join', token(), 'Newcomer', code);
    begin(store, roomId, 'second-start');
    assert.equal(
      snapshotProblem(finished as RoomState, store.snapshot(roomId, host.id) as RoomState),
      null,
      'missed reset snapshot can still reconnect into the new round',
    );
    roll(store, roomId);
    assert.equal(store.statistics(roomId).rolls, 1);
    assert.ok(store.history(roomId).entries.every((e) => e.revision > lobby.round));
    assert.equal(store.accountGames('Captain').games.length, 2);
    assert.equal(store.accountGames('Captain').games.filter((g) => g.outcome === 'won').length, 1);
    store.leave(newcomer, token(), store.snapshot(roomId).revision);
    assert.deepEqual(store.accountGames('Captain').stats, { played: 2, wins: 2 });
    assert.throws(
      () => store.action(host, token(), revision, { kind: 'returnToLobby' }),
      /State changed/,
      'stale rematch intent cannot reset the next match',
    );
    assert.equal(store.loadGame(roomId)!.phase, 'finished');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a departed participant cannot reopen a finished room and archive failures roll back the reset', () => {
  const store = new Store(':memory:', { now: () => 100000 });
  try {
    const players = crew(store),
      host = players[0]!,
      roomId = host.room_id;
    begin(store, roomId, token());
    end(store, players);
    assert.throws(
      () => store.action(players[1]!, token(), store.snapshot(roomId).revision, { kind: 'returnToLobby' }),
      /left/,
    );
    const before = store.snapshot(roomId, host.id);
    store.db.exec(
      "CREATE TRIGGER fail_archive BEFORE INSERT ON archived_matches BEGIN SELECT RAISE(ABORT,'test archive failure'); END",
    );
    assert.throws(
      () => store.action(host, token(), before.revision, { kind: 'returnToLobby' }),
      /archive failure/,
    );
    assert.deepEqual(store.snapshot(roomId, host.id), before);
    assert.equal(store.accountGames('Captain').games.length, 1);
  } finally {
    store.close();
  }
});

test('statistics expose only public totals and cannot receive injected dice', () => {
  const store = new Store(':memory:', { now: () => 100000 });
  try {
    const players = crew(store),
      roomId = players[0]!.room_id;
    begin(store, roomId, token());
    roll(store, roomId);
    const stats = store.statistics(roomId);
    assert.deepEqual(Object.keys(stats).sort(), ['diceCounts', 'revision', 'rolls', 'round']);
    assert.equal(
      stats.diceCounts.reduce((a, b) => a + b, 0),
      1,
    );
    assert.equal(stats.diceCounts.length, 11);
    assert.deepEqual(parseClientMessage('{"type":"statistics","diceCounts":[999]}'), { type: 'statistics' });
  } finally {
    store.close();
  }
});
