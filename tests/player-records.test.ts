import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, RECONNECT_GRACE_MS, ROOM_CODE_LEASE_MS } from '../apps/server/src/store.js';
import { MATCH_PAGE_SIZE } from '../apps/server/src/player-records.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import { createGame } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import type { Identity } from '../apps/server/src/auth.js';

const identity = (id: string): Identity => ({
  id,
  name: id,
  profile: { ...defaultProfile(id), username: id },
  expiresAt: Date.now() + 3_600_000,
});
const token = () => randomBytes(32).toString('hex');
function seats(store: Store, names = ['Captain', 'Builder']) {
  const host = store.enter('create', token(), 'ignored', undefined, identity(names[0]!));
  return [
    host,
    ...names.slice(1).map((name) => store.enter('join', token(), 'ignored', host.room_id, identity(name))),
  ];
}
function start(store: Store, names = ['Captain', 'Builder']) {
  const players = seats(store, names),
    host = players[0]!;
  for (const player of players) store.setConnected(player, true);
  for (const player of players.slice(1))
    store.lobby(player, 'ready-match', store.snapshot(host.room_id).revision, true);
  const revision = store.snapshot(host.room_id).revision;
  store.action(host, 'start-match', revision, { kind: 'start' });
  return { players, host, revision };
}
function saveLegacy(store: Store, game: Game, roomId: string) {
  store.db.prepare('INSERT INTO games(room_id,state) VALUES(?,?)').run(roomId, JSON.stringify(game));
}

test('personal history backfills legacy games, preserves privacy and unknown dates, and survives index rebuilds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-records-')),
    path = join(dir, 'game.sqlite');
  let store = new Store(path);
  try {
    const players = seats(store),
      roomId = players[0]!.room_id;
    const game = createGame(players, 17, () => 0.34);
    game.players[0]!.cards.push({ id: 'private-card-A', kind: 'victoryPoint', boughtTurn: 0 });
    game.players[1]!.cards.push({ id: 'private-card-B', kind: 'victoryPoint', boughtTurn: 0 });
    game.players[1]!.hand.ore = 7;
    saveLegacy(store, game, roomId);
    const profile = {
      ...defaultProfile('Builder'),
      username: 'Builder',
      avatarUrl: 'https://private.example/photo',
      email: 'secret@example.invalid',
    };
    store.db.prepare('UPDATE seats SET profile=? WHERE id=?').run(JSON.stringify(profile), players[1]!.id);
    const mine = store.accountGames('Captain');
    assert.deepEqual(mine.stats, { played: 0, wins: 0 });
    assert.equal(mine.games.length, 1);
    assert.equal(mine.games[0]!.startedAt, null);
    assert.equal(mine.games[0]!.finishedAt, null);
    assert.equal(mine.games[0]!.points, 1);
    assert.equal(
      mine.games[0]!.players.find((p) => p.id === players[1]!.id)!.points,
      0,
      'opponent VP remains hidden',
    );
    assert.equal(
      store.accountGames('Builder').games[0]!.points,
      1,
      'each player sees only their own hidden VP',
    );
    assert.deepEqual(store.accountGames('Stranger'), {
      stats: { played: 0, wins: 0 },
      games: [],
      nextCursor: null,
    });
    const encoded = JSON.stringify(mine);
    for (const privateField of ['private-card', 'hand', 'deck', 'avatarUrl', 'secret@', 'user_id', 'token'])
      assert.ok(!encoded.includes(privateField), privateField);
    const saved = store.db.prepare('SELECT state FROM games WHERE room_id=?').get(roomId)!.state;
    store.db.exec('DROP TABLE match_participants; DROP TABLE match_records;');
    store.close();
    store = new Store(path);
    assert.deepEqual(store.accountGames('Captain'), mine);
    assert.equal(store.db.prepare('SELECT state FROM games WHERE room_id=?').get(roomId)!.state, saved);
    assert.equal(
      store.db.prepare('SELECT count(*) AS n FROM game_events').get()!.n,
      0,
      'backfill never invents events',
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completed game and resignation statistics commit atomically and are never doubled by retries or restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catanova-records-')),
    path = join(dir, 'game.sqlite');
  let now = 1_000_000,
    store = new Store(path, { now: () => now, trackPresence: true });
  try {
    const { host, players, revision } = start(store);
    assert.equal(store.action(host, 'start-match', revision, { kind: 'start' }).duplicate, true);
    const initial = store.accountGames('Captain');
    assert.deepEqual(initial.stats, { played: 0, wins: 0 });
    assert.equal(initial.games.length, 1);
    assert.equal(initial.games[0]!.startedAt, now);
    store.setConnected(players[1]!, false);
    now += RECONNECT_GRACE_MS;
    store.db.exec(
      "CREATE TEMP TRIGGER reject_summary BEFORE UPDATE ON match_records BEGIN SELECT RAISE(ABORT,'Summary storage failed'); END;",
    );
    assert.throws(() => store.expireRoom(host.room_id), /Summary storage failed/);
    assert.equal(store.loadGame(host.room_id)!.winner, null);
    assert.deepEqual(store.accountGames('Captain'), initial);
    store.db.exec('DROP TRIGGER reject_summary');
    assert.equal(store.expireRoom(host.room_id), true);
    assert.equal(store.expireRoom(host.room_id), false);
    const winner = store.accountGames('Captain'),
      loser = store.accountGames('Builder');
    assert.deepEqual(winner.stats, { played: 1, wins: 1 });
    assert.deepEqual(loser.stats, { played: 1, wins: 0 });
    assert.equal(winner.games[0]!.outcome, 'won');
    assert.equal(loser.games[0]!.outcome, 'resigned');
    assert.equal(winner.games[0]!.resumable, false);
    assert.equal(loser.games[0]!.resumable, false);
    assert.equal(winner.games[0]!.finishedAt, now);
    store.db.exec('DELETE FROM match_participants; DELETE FROM match_records;');
    assert.deepEqual(
      store.accountGames('Captain'),
      winner,
      'the saved event journal rebuilds real start and finish dates',
    );
    store.db.exec('DELETE FROM match_participants;');
    assert.deepEqual(store.accountGames('Builder'), loser, 'a missing participant index is also rebuilt');
    store.close();
    store = new Store(path, { now: () => now, trackPresence: true });
    assert.deepEqual(store.accountGames('Captain'), winner);
    assert.deepEqual(store.accountGames('Builder'), loser);
    start(store, ['Captain', 'NewFriend']);
    assert.deepEqual(
      store.accountGames('Captain').stats,
      { played: 1, wins: 1 },
      'unfinished game does not inflate played count',
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only actual participants receive records; expired room codes do not invalidate an account-owned resume', () => {
  let now = 1_000_000;
  const store = new Store(':memory:', { now: () => now });
  try {
    const initial = seats(store, ['Captain', 'Leaver']),
      host = initial[0]!;
    store.leave(initial[1]!, 'leave-lobby', 0);
    const replacement = store.enter('join', token(), 'ignored', host.room_id, identity('Builder'));
    store.lobby(replacement, 'ready-match', store.snapshot(host.room_id).revision, true);
    store.action(host, 'start-match', store.snapshot(host.room_id).revision, { kind: 'start' });
    assert.equal(store.accountGames('Leaver').games.length, 0);
    now += ROOM_CODE_LEASE_MS + 1;
    const history = store.accountGames('Captain').games[0]!;
    assert.equal(history.roomCode, null);
    assert.equal(history.resumable, true);
    const resumed = store.enter('join', token(), 'ignored', history.roomId, identity('Captain'));
    assert.equal(resumed.id, host.id);
    assert.equal(store.accountGames('Captain').games.length, 1);
  } finally {
    store.close();
  }
});

test('history pages are bounded and stable when start timestamps tie; invalid cursors cannot alter scope', () => {
  const store = new Store(':memory:', { now: () => 1_000_000 });
  try {
    for (let i = 0; i < MATCH_PAGE_SIZE + 5; i++) start(store, ['Captain', `Friend${i}`]);
    start(store, ['Stranger', 'PrivateFriend']);
    const first = store.accountGames('Captain');
    assert.equal(first.games.length, MATCH_PAGE_SIZE);
    assert.ok(first.nextCursor);
    const second = store.accountGames('Captain', first.nextCursor!);
    assert.equal(second.games.length, 5);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.games, ...second.games].map((g) => g.roomId)).size, MATCH_PAGE_SIZE + 5);
    assert.deepEqual(second.stats, { played: 0, wins: 0 });
    for (const cursor of [
      '',
      '%bad',
      'a'.repeat(241),
      Buffer.from(JSON.stringify({ v: 1, at: -1, id: first.games[0]!.roomId })).toString('base64url'),
    ])
      assert.throws(() => store.accountGames('Captain', cursor), /reload your game history/);
    assert.ok(
      store
        .accountGames('Stranger', first.nextCursor!)
        .games.every((g) => g.players.some((p) => p.name === 'Stranger')),
    );
    assert.doesNotThrow(
      () =>
        store.accountGames(
          'Captain',
          Buffer.from(JSON.stringify({ v: 1, at: 0, id: 'ABCD2345' })).toString('base64url'),
        ),
      'legacy eight-character permanent room IDs remain valid pagination cursors',
    );
  } finally {
    store.close();
  }
});

test('an already resigned player is not counted as completed until the remaining match finishes', () => {
  let now = 1_000_000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const { players, host } = start(store, ['Captain', 'Builder', 'Trader']);
    store.setConnected(players[1]!, false);
    now += RECONNECT_GRACE_MS;
    store.expireRoom(host.room_id);
    const record = store.accountGames('Builder');
    assert.deepEqual(record.stats, { played: 0, wins: 0 });
    assert.equal(record.games[0]!.outcome, 'resigned');
    assert.equal(record.games[0]!.resumable, false);
    store.setConnected(players[2]!, false);
    now += RECONNECT_GRACE_MS;
    store.expireRoom(host.room_id);
    assert.deepEqual(store.accountGames('Builder').stats, { played: 1, wins: 0 });
  } finally {
    store.close();
  }
});

test('large legacy histories yield between durable batches, keep exact totals and resume after a bounded timeout', async () => {
  const store = new Store(':memory:');
  try {
    for (let i = 0; i < 33; i++) {
      const players = seats(store),
        game = createGame(players, 17, () => 0.34);
      game.phase = 'finished';
      game.turn = 24 + i;
      game.winner = players[i % 2]!.id;
      saveLegacy(store, game, players[0]!.room_id);
    }
    const lobby = store.enter('create', token(), 'Still playing');
    const count = () => Number(store.db.prepare('SELECT count(*) AS n FROM match_records').get()!.n);
    await assert.rejects(
      store.accountGamesAsync('Captain', undefined, { cancelled: () => true }),
      /interrupted/,
    );
    assert.equal(count(), 0, 'cancelled requests perform no indexing');
    await assert.rejects(
      store.accountGamesAsync('Captain', undefined, { maxDurationMs: 0 }),
      /still being prepared/,
    );
    assert.equal(
      count(),
      8,
      'a timed-out request retains only its bounded completed batch, never returns partial totals',
    );
    const result = store.accountGamesAsync('Captain');
    const between = await new Promise<number>((resolve, reject) =>
      setImmediate(() => {
        try {
          const indexed = count();
          assert.equal(
            store.increment(lobby, 'during-history-backfill', 0).counter,
            1,
            'other durable commands can commit between batches',
          );
          resolve(indexed);
        } catch (error) {
          reject(error);
        }
      }),
    );
    assert.ok(between > 8 && between < 33, `expected a callback during indexing, observed ${between}`);
    const completed = await result;
    assert.deepEqual(completed.stats, { played: 33, wins: 17 });
    assert.equal(completed.games.length, MATCH_PAGE_SIZE);
    assert.equal(count(), 33);
    const second = await store.accountGamesAsync('Captain', completed.nextCursor!);
    assert.deepEqual(second.stats, completed.stats);
    assert.equal(second.games.length, 13);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(
      (await store.accountGamesAsync('Captain')).stats,
      completed.stats,
      'repeated calls never double-count previously committed batches',
    );
    assert.deepEqual((await store.accountGamesAsync('Builder')).stats, { played: 33, wins: 16 });
  } finally {
    store.close();
  }
});
