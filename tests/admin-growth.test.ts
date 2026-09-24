import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../apps/server/src/store.js';
import { startAdminServer } from '../apps/server/src/admin/listener.js';
import { computeGrowth, GROWTH_COHORTS, GROWTH_SQL } from '../apps/server/src/admin/growth.js';
import { computeStats } from '../apps/server/src/admin/analysis.js';
import type { AuditPage, Cached, GrowthReport, GrowthSeries } from '../apps/server/src/admin/types.js';
import { API, raw } from './admin-fixture.js';

const at = (iso: string) => Date.parse(`${iso}Z`);
/** Thursday 24 September 2026, noon UTC. */
const NOW = at('2026-09-24T12:00');

type Player = { id: string; account?: string; bot?: boolean };

/**
 * Matches written straight into the index, as the game's records would hold
 * them: a room's seats (bots and local seats among them), its match record
 * and each account's participation, and optionally an archived earlier round.
 */
function history(store: Store) {
  const db = store.db;
  let n = 0;
  const seat = db.prepare(
    `INSERT OR IGNORE INTO seats (id, room_id, token_hash, name, user_id, account_type, bot, departed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const match = (
    room: string,
    options: {
      startedAt: number | null;
      finishedAt: number | null;
      winner: string | null;
      players: Player[];
      archive?: string;
    },
  ) => {
    db.prepare('INSERT OR IGNORE INTO rooms (id, revision) VALUES (?, 1)').run(room);
    for (const player of options.players)
      seat.run(
        player.id,
        room,
        `token-${n++}`,
        player.id,
        player.account ?? null,
        player.account ? 'permanent' : null,
        player.bot ? 1 : 0,
        0,
      );
    const players = JSON.stringify(
      options.players.map((player) => ({
        id: player.id,
        name: player.id,
        profile: { name: player.id, avatar: 0, accent: 'sea', frame: 'rope' },
        points: player.id === options.winner ? 10 : 4,
        winner: player.id === options.winner,
      })),
    );
    const values = [
      options.startedAt,
      options.finishedAt,
      options.startedAt ?? 0,
      40,
      options.winner,
      players,
    ] as const;
    if (options.archive) {
      db.prepare(
        `INSERT INTO archived_matches (room_id, revision, started_at, finished_at, sort_at, turns, winner, players, source_room_id)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(options.archive, ...values, room);
    } else
      db.prepare(
        `INSERT INTO match_records (room_id, revision, started_at, finished_at, sort_at, turns, winner, players)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
      ).run(room, ...values);
    for (const player of options.players)
      if (player.account)
        db.prepare(
          `INSERT INTO ${options.archive ? 'archived' : 'match'}_participants (room_id, player_id, user_id, points, outcome, resumable)
           VALUES (?, ?, ?, 4, 'lost', 0)`,
        ).run(options.archive ?? room, player.id, player.account);
  };
  const [a, b, c, d] = ['acct-a', 'acct-b', 'acct-c', 'acct-d'];
  // June: a local seat and a bot, abandoned. No account played.
  match('r0', {
    startedAt: at('2026-06-01T10:00'),
    finishedAt: at('2026-06-01T10:05'),
    winner: null,
    players: [{ id: 'l0' }, { id: 'k0', bot: true }],
  });
  // 10 August: D's first game, against a bot, won in 30 minutes.
  match('r5', {
    startedAt: at('2026-08-10T20:00'),
    finishedAt: at('2026-08-10T20:30'),
    winner: 'd5',
    players: [
      { id: 'd5', account: d },
      { id: 'k5', bot: true },
    ],
  });
  // Tuesday 1 September: A and B's first game, 40 minutes.
  match('r1', {
    startedAt: at('2026-09-01T10:00'),
    finishedAt: at('2026-09-01T10:40'),
    winner: 'a1',
    players: [
      { id: 'a1', account: a },
      { id: 'b1', account: b },
    ],
  });
  // Tuesday 8 September: B again, C's first, and a bot; an hour.
  match('r2', {
    startedAt: at('2026-09-08T20:00'),
    finishedAt: at('2026-09-08T21:00'),
    winner: 'b2',
    players: [
      { id: 'b2', account: b },
      { id: 'c2', account: c },
      { id: 'k2', bot: true },
    ],
  });
  // Tuesday 15 September: A and D, abandoned. A bot removed from the lobby before the game is not one of its seats.
  match('r3', {
    startedAt: at('2026-09-15T19:00'),
    finishedAt: at('2026-09-15T19:30'),
    winner: null,
    players: [
      { id: 'a3', account: a },
      { id: 'd3', account: d },
    ],
  });
  seat.run('k3-removed', 'r3', `token-${n++}`, 'Bot', null, null, 1, 1);
  // Monday 21 September: A, C and a bot play a round (archived, 20 minutes), then start another.
  const r4: Player[] = [
    { id: 'a4', account: a },
    { id: 'c4', account: c },
    { id: 'k4', bot: true },
  ];
  match('r4', {
    startedAt: at('2026-09-21T18:00'),
    finishedAt: at('2026-09-21T18:20'),
    winner: 'a4',
    players: r4,
    archive: 'r4-round-1',
  });
  match('r4', { startedAt: at('2026-09-21T19:00'), finishedAt: null, winner: null, players: r4 });
  // This morning: B and a local seat, still playing.
  match('r7', {
    startedAt: at('2026-09-24T11:00'),
    finishedAt: null,
    winner: null,
    players: [{ id: 'b7', account: b }, { id: 'l7' }],
  });
}

function fixture(t: TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  history(store);
  return store;
}

/** A series' values by bucket start, for the buckets named. */
const pick = (series: GrowthSeries, field: keyof Omit<GrowthSeries, 'start' | 'lengths'>, starts: string[]) =>
  starts.map((start) => series[field][series.start.indexOf(start)]);

test('growth counts games, players, bots and lengths by day, week and month', (t) => {
  const store = fixture(t);
  const growth = computeGrowth(store.db, NOW);
  assert.equal(growth.firstGameAt, at('2026-06-01T10:00'));
  const { days, weeks, months } = growth;
  // Days: the last 90, ending today.
  assert.equal(days.start.length, 90);
  assert.deepEqual([days.start[0], days.start.at(-1)], ['2026-06-27', '2026-09-24']);
  const dated = ['2026-08-10', '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-21', '2026-09-24'];
  assert.deepEqual(
    pick(days, 'started', dated),
    [1, 1, 1, 1, 2, 1],
    'by start; an archived round counts too',
  );
  assert.deepEqual(pick(days, 'finished', dated), [1, 1, 1, 0, 1, 0], 'with a winner, by end');
  assert.deepEqual(pick(days, 'abandoned', dated), [0, 0, 0, 1, 0, 0]);
  assert.deepEqual(
    pick(days, 'active', dated),
    [1, 2, 2, 2, 2, 1],
    'distinct accounts; local seats and bots are not players',
  );
  assert.deepEqual(pick(days, 'newPlayers', dated), [1, 2, 1, 0, 0, 0]);
  assert.deepEqual(pick(days, 'accounts', dated), [1, 3, 4, 4, 4, 4]);
  assert.deepEqual(pick(days, 'seats', dated), [2, 2, 3, 2, 6, 2]);
  assert.deepEqual(
    pick(days, 'botSeats', dated),
    [1, 0, 1, 0, 2, 0],
    'a bot removed before the game is not counted',
  );
  assert.deepEqual(pick(days, 'withBots', dated), [1, 0, 1, 0, 2, 0]);
  // Accounts that played in the 7 days to each day.
  assert.deepEqual(pick(days, 'trailing', ['2026-09-08', '2026-09-15', '2026-09-24']), [2, 2, 3]);
  const lengthOn = (day: string) => days.lengths.median[days.start.indexOf(day)];
  assert.deepEqual(dated.map(lengthOn), [30, 40, 60, null, 20, null], 'games won that day, start to end');
  // Weeks: from Monday, back past a year.
  assert.ok(weeks.start.length >= 53);
  assert.equal(weeks.start.at(-1), '2026-09-21');
  assert.ok(weeks.start.every((start) => new Date(`${start}T00:00Z`).getUTCDay() === 1));
  const mondays = ['2026-06-01', '2026-08-10', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
  assert.deepEqual(pick(weeks, 'started', mondays), [1, 1, 1, 1, 1, 3]);
  assert.deepEqual(pick(weeks, 'abandoned', mondays), [1, 0, 0, 0, 1, 0]);
  assert.deepEqual(pick(weeks, 'active', mondays), [0, 1, 2, 2, 2, 3]);
  assert.deepEqual(pick(weeks, 'newPlayers', mondays), [0, 1, 2, 1, 0, 0]);
  assert.equal(weeks.trailing.at(-1), 4, 'everyone played in the 28 days to today');
  // Months: from the 1st.
  assert.deepEqual(pick(months, 'started', ['2026-06-01', '2026-08-01', '2026-09-01']), [1, 1, 6]);
  assert.deepEqual(pick(months, 'active', ['2026-06-01', '2026-08-01', '2026-09-01']), [0, 1, 4]);
  const september = months.start.indexOf('2026-09-01');
  assert.deepEqual(
    [months.lengths.games[september], months.lengths.median[september], months.lengths.low[september]],
    [3, 40, 30],
    'the median and lower quartile of 20, 40 and 60 minutes',
  );
});

test('each range is totalled against the period before it, when that period is wholly after the first game', (t) => {
  const store = fixture(t);
  const { periods } = computeGrowth(store.db, NOW);
  const last30 = periods['30d'].current;
  assert.deepEqual([last30.from, last30.to], [NOW - 30 * 86_400_000, NOW + 1]);
  assert.deepEqual(
    {
      started: last30.started,
      finished: last30.finished,
      abandoned: last30.abandoned,
      active: last30.active,
      newPlayers: last30.newPlayers,
      accountsBefore: last30.accountsBefore,
      accountsAfter: last30.accountsAfter,
      seats: last30.seats,
      botSeats: last30.botSeats,
      withBots: last30.withBots,
      lengthGames: last30.lengthGames,
      medianMinutes: last30.medianMinutes,
    },
    {
      started: 6,
      finished: 3,
      abandoned: 1,
      active: 4,
      newPlayers: 3,
      accountsBefore: 1,
      accountsAfter: 4,
      seats: 15,
      botSeats: 3,
      withBots: 3,
      lengthGames: 3,
      medianMinutes: 40,
    },
  );
  // A and B (first week 31 August) and C (7 September) have had their next week; only B played in it.
  assert.deepEqual(last30.nextWeek, { players: 3, returned: 1 });
  const before = periods['30d'].previous!;
  assert.deepEqual([before.from, before.to], [NOW - 60 * 86_400_000, NOW - 30 * 86_400_000]);
  assert.deepEqual(
    [
      before.started,
      before.finished,
      before.active,
      before.newPlayers,
      before.botSeats,
      before.medianMinutes,
    ],
    [1, 1, 1, 1, 1, 30],
    'D’s first game, in August',
  );
  assert.deepEqual(before.nextWeek, { players: 1, returned: 0 });
  // 90 days before the last 90 reach back before the first game in June: nothing to compare.
  assert.equal(periods['90d'].previous, null);
  assert.deepEqual([periods['90d'].current.started, periods['90d'].current.medianMinutes], [7, 35]);
  assert.equal(periods['1y'].previous, null);
  assert.equal(periods.all.previous, null);
  assert.deepEqual(
    [
      periods.all.current.from,
      periods.all.current.started,
      periods.all.current.abandoned,
      periods.all.current.seats,
    ],
    [at('2026-06-01T10:00'), 8, 2, 19],
  );
});

test('weekly cohorts follow each week’s new players through the weeks after their first', (t) => {
  const store = fixture(t);
  const { cohorts } = computeGrowth(store.db, NOW);
  assert.equal(cohorts.length, GROWTH_COHORTS);
  assert.equal(cohorts.at(-1)!.week, '2026-09-21');
  const of = (week: string) => cohorts.find((cohort) => cohort.week === week)!.active;
  // D, from 10 August, came back five weeks later; A and B from 31 August; C from 7 September.
  assert.deepEqual(of('2026-08-10'), [1, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(of('2026-08-31'), [2, 1, 1, 2]);
  assert.deepEqual(of('2026-09-07'), [1, 0, 1]);
  assert.deepEqual(of('2026-09-21'), [0], 'nobody new this week yet');
  assert.ok(cohorts.every((cohort, i) => cohort.active.length === GROWTH_COHORTS - i));
});

test('growth agrees with the Stats tab where they overlap, counted independently', (t) => {
  const store = fixture(t);
  const growth = computeGrowth(store.db, NOW);
  const stats = computeStats(store.db, NOW);
  const recent = (values: number[]) => values.slice(-30);
  assert.deepEqual(
    recent(growth.days.started),
    stats.days.map((day) => day.started),
  );
  assert.deepEqual(
    recent(growth.days.finished),
    stats.days.map((day) => day.finished),
  );
  assert.deepEqual(
    recent(growth.days.abandoned),
    stats.days.map((day) => day.abandoned),
  );
  assert.deepEqual(
    recent(growth.days.active),
    stats.days.map((day) => day.players),
  );
  assert.deepEqual(
    growth.weeks.active.slice(-8),
    stats.weeks.map((week) => week.players),
  );
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  assert.deepEqual(
    {
      matches: sum(recent(growth.days.started)),
      matchesWithBots: sum(recent(growth.days.withBots)),
      seats: sum(recent(growth.days.seats)),
      botSeats: sum(recent(growth.days.botSeats)),
    },
    stats.bots,
  );
  assert.equal(growth.periods['30d'].current.medianMinutes, stats.completed.medianMinutes);
});

test('growth is as of its moment: later games are left out, and one not over by then is still being played', (t) => {
  const store = fixture(t);
  // Twenty minutes into the first of September's game.
  const growth = computeGrowth(store.db, at('2026-09-01T10:20'));
  const today = growth.days.start.indexOf('2026-09-01');
  assert.equal(today, 89);
  assert.deepEqual(
    [growth.days.started[today], growth.days.finished[today], growth.days.active[today]],
    [1, 0, 2],
  );
  assert.equal(growth.periods.all.current.started, 3, 'June, August and this one');
  assert.equal(growth.periods.all.current.accountsAfter, 3, 'D, A and B; C has not played yet');
  assert.deepEqual(growth.cohorts.at(-1), { week: '2026-08-31', active: [2] });
});

test('an empty database has a report of zeros and nothing to compare', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const growth = computeGrowth(store.db, NOW);
  assert.equal(growth.firstGameAt, null);
  assert.equal(growth.days.start.length, 90);
  assert.ok(growth.days.started.every((n) => n === 0));
  assert.equal(growth.periods['30d'].previous, null);
  assert.deepEqual(growth.periods.all.current.nextWeek, { players: 0, returned: 0 });
  assert.ok(growth.cohorts.every((cohort) => cohort.active.every((n) => n === 0)));
});

test('growth reads each match and participation once, through indexes rather than scans of whole tables', (t) => {
  const store = fixture(t);
  const plan = (sql: string) =>
    store.db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((row) => row.detail as string);
  const participations = plan(GROWTH_SQL.participations);
  // Each match's start comes from its covering order index; its participants by primary key.
  assert.ok(participations.includes('SEARCH m USING COVERING INDEX match_records_order (sort_at>?)'));
  assert.ok(participations.includes('SEARCH m USING COVERING INDEX archived_matches_order (sort_at>?)'));
  assert.ok(
    participations.includes('SEARCH p USING INDEX sqlite_autoindex_match_participants_1 (room_id=?)'),
  );
  assert.ok(
    participations.includes('SEARCH p USING INDEX sqlite_autoindex_archived_participants_1 (room_id=?)'),
  );
  assert.ok(!participations.some((step) => /^SCAN|TEMP B-TREE/.test(step)), participations.join('\n'));
  const matches = plan(GROWTH_SQL.matches);
  // One pass over each match table; a match's bots are its room's seats, found by index.
  assert.deepEqual(
    matches.filter((step) => step.startsWith('SCAN')),
    ['SCAN match_records', 'SCAN archived_matches'],
  );
  assert.ok(matches.includes('SEARCH b USING INDEX seats_room (room_id=?)'));
  assert.ok(!matches.some((step) => /TEMP B-TREE|AUTOMATIC/.test(step)), matches.join('\n'));
});

test('the growth endpoint answers from the worker, keeps its answer, and is not audited', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'catanova-growth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'game.sqlite');
  const store = new Store(path);
  t.after(() => store.close());
  history(store);
  const admin = await startAdminServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      auth: { mode: 'local-dev' },
      origin: 'http://127.0.0.1:3100',
      statusDir: join(dir, 'status'),
      revision: null,
    },
    store,
    runtime: { sockets: () => ({ total: 0, players: 0, spectators: 0, seats: [] }), broadcast: () => {} },
    databasePath: path,
    assetsDirectory: join(dir, 'no-build'),
    log: () => {},
  });
  t.after(() => admin.close());
  const get = async <T>(url: string) => {
    const response = await raw(admin.port, url, { headers: API });
    assert.equal(response.status, 200, `${url}: ${response.body}`);
    return JSON.parse(response.body) as T;
  };
  const first = await get<Cached<GrowthReport>>('/api/admin/growth');
  assert.equal(first.fresh, true);
  assert.deepEqual(
    first.value,
    computeGrowth(store.db, first.value.generatedAt),
    'the worker reads what the game’s own connection would',
  );
  assert.equal((await get<Cached<GrowthReport>>('/api/admin/growth')).fresh, false, 'kept for five minutes');
  assert.equal(
    (await get<AuditPage>('/api/admin/audit')).entries.length,
    0,
    'aggregates only: nothing audited',
  );
});
