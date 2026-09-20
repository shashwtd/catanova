import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../apps/server/src/store.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';
import { gameView } from '../packages/rules/src/game.js';
import { readMatches, summarize, type ObservedMatch, type Metric } from '../scripts/reporting/retention.js';
import { reportSnapshot } from '../scripts/retention-report.js';

const minute = 60_000,
  day = 1440 * minute,
  epoch = Date.parse('2026-09-01T00:00:00Z');
const token = () => randomBytes(32).toString('hex');
const human = (account: string, type: 'guest' | 'permanent' | 'unknown' = 'permanent') => ({
  account,
  type,
  player: account,
});
function match(key: string, start: number, overrides: Partial<ObservedMatch> = {}): ObservedMatch {
  return {
    key,
    room: key,
    start: epoch + start,
    finish: epoch + start + 20 * minute,
    outcome: 'points',
    turns: 80,
    mix: 'humanOnly',
    humans: [human('a'), human('b', 'guest')],
    humanActions: [
      { account: 'a', at: epoch + start },
      { account: 'b', at: epoch + start + minute },
    ],
    unknownActions: 0,
    knownActions: 2,
    startKnown: true,
    ...overrides,
  };
}
const value = (report: Metric[], section: string, metric: string) =>
  report.find((m) => m.section === section && m.metric === metric)!;

test('group return combines rooms, counts only the first qualifying match, and excludes immature windows', () => {
  const source = match('first', 0, { room: 'same' });
  const same = match('second', 25 * minute, { room: 'same' });
  const elsewhere = match('third', 55 * minute, { room: 'different', outcome: 'resignation' });
  const abandoned = match('abandoned', 120 * minute, {
    outcome: 'abandoned',
    humans: [human('c'), human('d')],
    humanActions: [],
  });
  const running = match('running', 170 * minute, { outcome: 'running', finish: null });
  const pending = match('pending', 175 * minute, { humans: [human('e'), human('f')] });
  const report = summarize([source, same, elsewhere, abandoned, running, pending], {
    from: epoch,
    to: epoch + 200 * minute,
    asOf: epoch + 200 * minute,
  });
  assert.deepEqual(value(report, 'Group return', 'Played another match within 30 minutes'), {
    section: 'Group return',
    metric: 'Played another match within 30 minutes',
    value: 2,
    denominator: 4,
  });
  assert.equal(value(report, 'Group return', 'Same room').value, 1);
  assert.equal(value(report, 'Group return', 'New room').value, 1);
  assert.equal(value(report, 'Group return', 'Pending 30-minute observation').value, 1);
  assert.equal(value(report, 'Matches · all', 'running').value, 1);
  assert.equal(value(report, 'Matches · all', 'abandoned').value, 1);
  assert.equal(value(report, 'Duration · all', 'points elapsed minutes').value, 20);
});

test('return cohorts have fixed anchors, rolling mature windows and never count bots or unknown actions', () => {
  const first = match('first', 0);
  const dayLater = match('later', 25 * 60 * minute, {
    humans: [human('a'), human('b', 'permanent')],
    humanActions: [{ account: 'a', at: epoch + 25 * 60 * minute }],
  });
  const legacy = match('legacy', 0, {
    humans: [human('old', 'unknown')],
    humanActions: [],
    unknownActions: 5,
    knownActions: 0,
  });
  const pending = match('pending', 3 * day, {
    humans: [human('new')],
    humanActions: [{ account: 'new', at: epoch + 3 * day }],
  });
  const at48 = match('boundary', 2 * day, {
    humans: [human('b')],
    humanActions: [{ account: 'b', at: epoch + 2 * day }],
  });
  const report = summarize([first, dayLater, legacy, pending, at48], {
    from: epoch,
    to: epoch + 4 * day,
    asOf: epoch + 4 * day,
  });
  const total = value(report, 'Account return · all', 'Human action 24–48 hours later');
  assert.equal(total.value, 1);
  assert.equal(total.denominator, 2);
  assert.equal(
    value(report, 'Account return · guest', 'Human action 24–48 hours later').denominator,
    1,
    'linking later does not rewrite the anchor account type',
  );
  assert.equal(
    value(report, 'Account return · guest', 'Human action 24–48 hours later').value,
    0,
    '48h upper boundary is excluded',
  );
  assert.equal(value(report, 'Account return · all', 'Pending 48-hour observation').value, 1);
  assert.equal(value(report, 'Coverage', 'Accounts with no proven human action').value, 1);
  const laterCohort = summarize([first, dayLater], {
    from: epoch + day,
    to: epoch + 4 * day,
    asOf: epoch + 4 * day,
  });
  assert.equal(
    value(laterCohort, 'Account return · all', 'Human action 24–48 hours later').denominator,
    0,
    'a later match cannot become a new anchor',
  );
});

test('no data produces unknown medians and zero denominators without claiming zero-percent retention', () => {
  const report = summarize([], { from: epoch, to: epoch + day, asOf: epoch + day });
  assert.equal(value(report, 'Duration · all', 'points elapsed minutes').value, null);
  assert.equal(value(report, 'Account return · all', 'Human action 24–48 hours later').denominator, 0);
  assert.throws(() => summarize([], { from: epoch, to: epoch + 2 * day, asOf: epoch + day }), /from < to/);
});

test('real journals preserve rounds, account type at start, private provenance, and aggregate-only offline output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catanova-retention-'));
  const path = join(directory, 'snapshot.sqlite');
  let now = epoch;
  const store = new Store(path, { now: () => now, random: () => 0.35 });
  try {
    const identity = (id: string, isGuest: boolean) => ({
      id,
      name: id,
      profile: defaultProfile(id),
      isGuest,
      expiresAt: epoch + 20 * day,
    });
    const host = store.enter('create', token(), 'SecretAlpha', undefined, identity('SecretAlpha', false));
    let guest = store.enter('join', token(), 'SecretBeta', host.room_id, identity('SecretBeta', true));
    const roomId = host.room_id;
    const begin = () => {
      store.lobby(guest, token(), store.snapshot(roomId).revision, true);
      store.action(host, token(), store.snapshot(roomId).revision, { kind: 'start' });
    };
    const end = () => {
      now += 20 * minute;
      store.leave(guest, token(), store.snapshot(roomId).revision);
      store.action(host, token(), store.snapshot(roomId).revision, { kind: 'returnToLobby' });
    };
    begin();
    end();
    now += 5 * minute;
    guest = store.enter('join', token(), 'SecretBeta', roomId, identity('SecretBeta', false));
    store.lobby(host, token(), store.snapshot(roomId).revision, false, undefined, undefined, true);
    begin();
    let game = store.loadGame(roomId)!;
    // Move past an invited bot, if the shuffle gave it first placement, so the
    // next automated action really belongs to a human seat under a stand-in.
    while (store.botSeatsIn(roomId).some((p) => p.id === game.players[game.active]!.id)) {
      const actor = { ...game.players[game.active]!, room_id: roomId };
      const legal = gameView(game, actor.id).legal;
      store.action(
        actor,
        token(),
        store.snapshot(roomId).revision,
        game.phase === 'setupSettlement'
          ? { kind: 'settlement', vertex: legal.settlements[0]! }
          : { kind: 'road', edge: legal.roads[0]! },
        'bot',
      );
      game = store.loadGame(roomId)!;
    }
    const active = { ...game.players[game.active]!, room_id: roomId };
    const action = { kind: 'settlement' as const, vertex: gameView(game, active.id).legal.settlements[0]! };
    store.action(active, 'bot-stand-in', store.snapshot(roomId).revision, action, 'bot');
    const row = store.db
      .prepare("SELECT actor_kind,public_entry FROM game_events WHERE command_id='bot-stand-in'")
      .get()!;
    assert.equal(row.actor_kind, 'bot');
    game = store.loadGame(roomId)!;
    store.action(
      active,
      'timer-default',
      store.snapshot(roomId).revision,
      { kind: 'road', edge: gameView(game, active.id).legal.roads[0]! },
      true,
    );
    assert.equal(
      store.db.prepare("SELECT actor_kind FROM game_events WHERE command_id='timer-default'").get()!
        .actor_kind,
      'timer',
    );

    assert.ok(!String(row.public_entry).includes('actor_kind'));
    const read = readMatches(store.db);
    assert.equal(read.matches.length, 2);
    assert.notEqual(read.matches[0]!.key, read.matches[1]!.key);
    assert.equal(read.matches[0]!.humans.find((p) => p.account === 'SecretBeta')!.type, 'guest');
    assert.equal(read.matches[1]!.humans.find((p) => p.account === 'SecretBeta')!.type, 'permanent');
    assert.equal(read.matches[1]!.humanActions.length, 1, 'a stand-in move is not a human visit');
    assert.equal(read.matches[0]!.outcome, 'resignation');
    assert.equal(read.matches[1]!.outcome, 'running');
    assert.equal(read.matches[0]!.mix, 'humanOnly');
    assert.equal(read.matches[1]!.mix, 'withBots');
    assert.equal(read.matches[1]!.humans.length, 2);
    // Freeze the snapshot after closing SQLite; reporting must neither migrate nor alter it.
    store.close();
    const before = readFileSync(path);
    const output = join(directory, 'report');
    reportSnapshot(path, output, { from: epoch, to: epoch + 3 * day, asOf: epoch + 3 * day });
    assert.deepEqual(readFileSync(path), before);
    const html = readFileSync(join(output, 'retention.html'), 'utf8'),
      csv = readFileSync(join(output, 'retention.csv'), 'utf8');
    for (const secret of ['SecretAlpha', 'SecretBeta', roomId, guest.id, host.id]) {
      assert.ok(!html.includes(secret));
      assert.ok(!csv.includes(secret));
    }
    assert.ok(!html.includes('<script'));
    assert.match(html, /24–48/);
    assert.throws(
      () =>
        reportSnapshot(path, join(directory, 'invalid'), {
          from: epoch,
          to: epoch + minute,
          asOf: epoch + minute,
        }),
      /predates/,
    );
    assert.ok(!existsSync(join(directory, 'invalid')));
    const db = new DatabaseSync(path);
    // A compatibility read of a pre-provenance snapshot must not guess who acted.
    db.exec(
      'ALTER TABLE game_events DROP COLUMN actor_kind; ALTER TABLE game_events DROP COLUMN participants',
    );
    const legacy = readMatches(db);
    assert.ok(legacy.matches.every((m) => m.humanActions.length === 0));
    assert.ok(legacy.matches.every((m) => m.humans.every((p) => p.type === 'unknown')));
    assert.ok(legacy.matches.some((m) => m.unknownActions > 0));
    db.close();
  } finally {
    try {
      store.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy matches remain unknown and duplicate archives are counted once', () => {
  const store = new Store(':memory:');
  try {
    const seat = store.enter('create', token(), 'Legacy');
    const room = seat.room_id;
    const insert = store.db.prepare('INSERT INTO archived_matches VALUES (?,?,?,?,?,?,?,?,?)');
    const roster = JSON.stringify([{ id: seat.id }]);
    insert.run('one', 12, null, null, 0, 20, null, roster, room);
    insert.run('duplicate', 12, null, null, 0, 20, null, roster, room);
    insert.run('next-legacy', 25, null, null, 0, 50, null, roster, room);
    const data = readMatches(store.db);
    assert.equal(data.duplicates, 1);
    assert.equal(data.matches.length, 2);
    assert.ok(data.matches.every((m) => !m.startKnown && m.start === null));
    assert.notEqual(data.matches[0]!.key, data.matches[1]!.key);
    const report = summarize(data.matches, { from: epoch, to: epoch + day, asOf: epoch + day });
    assert.equal(value(report, 'Coverage', 'Matches with unknown start time').value, 2);
    assert.equal(value(report, 'Matches · all', 'Started').value, 0);
  } finally {
    store.close();
  }
});
