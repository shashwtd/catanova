/**
 * How Catanova has grown, for the Growth tab: games started and ended,
 * accounts playing and arriving, how long games last and how many seats bots
 * fill, by day (the last 90), by week and by month since the first game;
 * totals for the last 30 days, 90 days and year against the period before
 * each; and weekly cohorts of new players with how many played again in each
 * week after their first.
 *
 * It reads the match index only, never the journal: every match once and
 * every participation once, in two passes driven by indexes rather than joins
 * over whole tables.
 * - Matches: each table is scanned once. A match's bots are the bot seats of
 *   its room (found by the room's seat index) whose ids appear in its player
 *   list, a text search, so no JSON is parsed but the list's length.
 * - Participations: each match is walked through its (sort_at, room_id)
 *   index, which holds its start, and its participants are found by primary
 *   key, so no match row is read for its start.
 * Everything else is counted in one sorted pass in memory. On a synthetic
 * database of 200,000 games (219,000 with rematches, 536,000 participations
 * and 78,000 accounts) the report takes about 1.1 s once the file is in the
 * page cache, 0.85 s of it in the two reads. It grows with the whole history,
 * so it runs in the analysis worker on its own read-only connection and is
 * cached for five minutes (analysis-runner.ts). Only aggregates leave the
 * worker.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { GrowthPeriod, GrowthRange, GrowthReport, GrowthSeries } from './types.js';

const DAY = 86_400_000;
/** The days series covers the 90-day range. */
export const GROWTH_DAYS = 90;
/** The weeks series covers at least the year range. */
export const GROWTH_WEEKS = 53;
/** Weekly cohorts reported, the latest first. */
export const GROWTH_COHORTS = 26;
/** Each range's length in days; `all` runs from the first game. */
export const GROWTH_RANGES: Record<GrowthRange, number | null> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  all: null,
};

// Weeks start on Monday, UTC. Day 0, 1 January 1970, was a Thursday, so day 4 was the first Monday.
const weekOf = (day: number) => Math.floor((day + 3) / 7);
const mondayOf = (week: number) => week * 7 - 3;
const monthOf = (day: number) => {
  const date = new Date(day * DAY);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
};
const firstDayOf = (month: number) => Date.UTC(Math.floor(month / 12), month % 12, 1) / DAY;
const iso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const tenth = (value: number) => Math.round(value * 10) / 10;

/** Linear interpolation between the order statistics around `q`. */
function quantile(sorted: ArrayLike<number>, q: number): number {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low]! + (sorted[Math.ceil(at)]! - sorted[low]!) * (at - low);
}

/**
 * Every match, the current round's and archived ones: its start and end,
 * whether it had a winner, its seats, and how many of them were bots.
 */
const MATCHES = `SELECT m.started_at AS startedAt, m.finished_at AS finishedAt, m.winner IS NOT NULL AS won,
    json_array_length(m.players) AS seats,
    (SELECT count(*) FROM seats b WHERE b.room_id = m.source AND b.bot = 1
       AND instr(m.players, '"' || b.id || '"') > 0) AS bots
  FROM (
    SELECT room_id AS source, started_at, finished_at, winner, players FROM match_records
    UNION ALL
    SELECT source_room_id, started_at, finished_at, winner, players FROM archived_matches
  ) m`;

/**
 * Every account's seat in a match, with the match's start. `sort_at` is the
 * start (0 for a match with none), and the CROSS JOIN keeps SQLite walking
 * the matches through their covering order index, then each one's
 * participants by primary key.
 */
const PARTICIPATIONS = `SELECT p.user_id AS userId, m.sort_at AS at
  FROM match_records m CROSS JOIN match_participants p ON p.room_id = m.room_id
  WHERE m.sort_at > 0
  UNION ALL
  SELECT p.user_id, m.sort_at
  FROM archived_matches m CROSS JOIN archived_participants p ON p.room_id = m.room_id
  WHERE m.sort_at > 0`;

/** The two reads, for tests of how SQLite plans them. */
export const GROWTH_SQL = { matches: MATCHES, participations: PARTICIPATIONS };

type MatchRow = {
  startedAt: number | null;
  finishedAt: number | null;
  won: number;
  seats: number;
  bots: number;
};

/** A period being totalled: its bounds, and running counts. */
type Tally = GrowthPeriod & { minutes: number[]; seen: Uint8Array };

function tally(from: number, to: number, accounts: number): Tally {
  return {
    from,
    to,
    started: 0,
    finished: 0,
    abandoned: 0,
    active: 0,
    newPlayers: 0,
    accountsBefore: 0,
    accountsAfter: 0,
    seats: 0,
    botSeats: 0,
    withBots: 0,
    lengthGames: 0,
    medianMinutes: null,
    nextWeek: { players: 0, returned: 0 },
    minutes: [],
    seen: new Uint8Array(accounts),
  };
}

export function computeGrowth(db: DatabaseSync, now: number): GrowthReport {
  const today = Math.floor(now / DAY);
  const thisWeek = weekOf(today);

  // Pass 1: matches, as they stood at `now`: one that had not ended by then is still being played.
  const matches: MatchRow[] = [];
  for (const match of db.prepare(MATCHES).iterate() as Iterable<MatchRow>) {
    if (match.startedAt !== null && match.startedAt > now) continue;
    matches.push(
      match.finishedAt !== null && match.finishedAt > now ? { ...match, finishedAt: null } : match,
    );
  }
  // Pass 2: participations. Accounts are numbered as they appear.
  const ids = new Map<string, number>();
  const firstAt: number[] = [];
  const who: number[] = [];
  const when: number[] = [];
  for (const row of db.prepare(PARTICIPATIONS).iterate() as Iterable<{ userId: string; at: number }>) {
    if (row.at > now) continue;
    let id = ids.get(row.userId);
    if (id === undefined) {
      id = firstAt.length;
      ids.set(row.userId, id);
      firstAt.push(row.at);
    } else if (row.at < firstAt[id]!) firstAt[id] = row.at;
    who.push(id);
    when.push(row.at);
  }
  const accounts = firstAt.length;

  let firstGame = Infinity,
    firstDay = today;
  for (const match of matches) {
    if (match.startedAt !== null) firstGame = Math.min(firstGame, match.startedAt);
    for (const at of [match.startedAt, match.finishedAt])
      if (at !== null) firstDay = Math.min(firstDay, Math.floor(at / DAY));
  }
  const firstGameAt = Number.isFinite(firstGame) ? firstGame : null;
  // Days are counted from a Monday at least a year back, so every range has its days and weeks.
  const origin = mondayOf(
    weekOf(Math.min(firstDay, today - GROWTH_DAYS + 1, mondayOf(thisWeek - GROWTH_WEEKS + 1))),
  );
  const length = today - origin + 1;
  const at = (moment: number) => Math.floor(moment / DAY) - origin;

  // The periods: each range and the one before it, and everything since the first game.
  const windows: { range: GrowthRange; previous: boolean; tally: Tally }[] = [];
  for (const [range, days] of Object.entries(GROWTH_RANGES) as [GrowthRange, number | null][]) {
    if (days === null) {
      windows.push({ range, previous: false, tally: tally(firstGameAt ?? now, now + 1, accounts) });
      continue;
    }
    windows.push({ range, previous: false, tally: tally(now - days * DAY, now + 1, accounts) });
    // The period before is only compared when it lies wholly after the first game.
    if (firstGameAt !== null && now - 2 * days * DAY >= firstGameAt)
      windows.push({ range, previous: true, tally: tally(now - 2 * days * DAY, now - days * DAY, accounts) });
  }
  const tallies = windows.map((window) => window.tally);
  const inside = (t: Tally, moment: number) => moment >= t.from && moment < t.to;

  // Day by day: games, seats and bots by start; results and lengths by end.
  const started = new Int32Array(length),
    finished = new Int32Array(length),
    abandoned = new Int32Array(length),
    seats = new Int32Array(length),
    botSeats = new Int32Array(length),
    withBots = new Int32Array(length);
  const lengths: number[][] = Array.from({ length }, () => []);
  for (const match of matches) {
    if (match.startedAt !== null) {
      const day = at(match.startedAt);
      started[day]!++;
      seats[day]! += match.seats;
      botSeats[day]! += match.bots;
      if (match.bots) withBots[day]!++;
    }
    const minutes =
      match.won &&
      match.startedAt !== null &&
      match.finishedAt !== null &&
      match.finishedAt >= match.startedAt
        ? (match.finishedAt - match.startedAt) / 60_000
        : null;
    if (match.finishedAt !== null) {
      const day = at(match.finishedAt);
      if (match.won) finished[day]!++;
      else abandoned[day]!++;
      if (minutes !== null) lengths[day]!.push(minutes);
    }
    for (const t of tallies) {
      if (match.startedAt !== null && inside(t, match.startedAt)) {
        t.started++;
        t.seats += match.seats;
        t.botSeats += match.bots;
        if (match.bots) t.withBots++;
      }
      if (match.finishedAt !== null && inside(t, match.finishedAt)) {
        if (match.won) t.finished++;
        else t.abandoned++;
        if (minutes !== null) t.minutes.push(minutes);
      }
    }
  }

  // Accounts: when each first played, and who played in each period.
  const newPlayers = new Int32Array(length);
  const firstWeek = new Int32Array(accounts);
  for (let user = 0; user < accounts; user++) {
    const first = firstAt[user]!;
    newPlayers[at(first)]!++;
    firstWeek[user] = weekOf(Math.floor(first / DAY));
    for (const t of tallies) {
      if (first < t.from) t.accountsBefore++;
      if (first < t.to) t.accountsAfter++;
      if (inside(t, first)) t.newPlayers++;
    }
  }
  for (let i = 0; i < who.length; i++) {
    const moment = when[i]!,
      user = who[i]!;
    for (const t of tallies)
      if (inside(t, moment) && !t.seen[user]) {
        t.seen[user] = 1;
        t.active++;
      }
  }

  // One pass over each account's distinct days, in day order: players per day, week and month,
  // players over the trailing 7 and 28 days, and each weekly cohort week by week.
  const keys = new Float64Array(who.length);
  for (let i = 0; i < who.length; i++) keys[i] = at(when[i]!) * accounts + who[i]!;
  keys.sort();
  const weeks = thisWeek - weekOf(origin) + 1;
  const months = monthOf(today) - monthOf(origin) + 1;
  const monthIndex = Array.from({ length }, (_, day) => monthOf(origin + day) - monthOf(origin));
  const daily = new Int32Array(length),
    weekly = new Int32Array(weeks),
    monthly = new Int32Array(months);
  const lastWeek = new Int32Array(accounts).fill(-1),
    lastMonth = new Int32Array(accounts).fill(-1);
  const trailing = [7, 28].map((span) => ({
    span,
    diff: new Int32Array(length + span),
    end: new Int32Array(accounts).fill(-1),
  }));
  const cohortFrom = thisWeek - GROWTH_COHORTS + 1;
  const cohorts = Array.from({ length: GROWTH_COHORTS }, (_, i) => new Int32Array(GROWTH_COHORTS - i));
  const returnedNextWeek = new Uint8Array(accounts);
  let previous = -1;
  for (const key of keys) {
    if (key === previous) continue;
    previous = key;
    const day = Math.floor(key / accounts);
    const user = key - day * accounts;
    daily[day]!++;
    const week = weekOf(origin + day) - weekOf(origin);
    if (lastWeek[user] !== week) {
      lastWeek[user] = week;
      weekly[week]!++;
      const since = week + weekOf(origin) - firstWeek[user]!;
      if (since === 1) returnedNextWeek[user] = 1;
      const cohort = firstWeek[user]! - cohortFrom;
      if (cohort >= 0) cohorts[cohort]![since]!++;
    }
    if (lastMonth[user] !== monthIndex[day]) {
      lastMonth[user] = monthIndex[day]!;
      monthly[monthIndex[day]!]!++;
    }
    // Each account counts in the trailing window from a day it played until `span` days after its last.
    for (const window of trailing) {
      if (window.end[user]! > day) window.diff[window.end[user]!]!++;
      else window.diff[day]!++;
      window.end[user] = day + window.span;
      window.diff[day + window.span]!--;
    }
  }
  const [trailing7, trailing28] = trailing.map((window) => {
    const counts = new Int32Array(length);
    let running = 0;
    for (let day = 0; day < length; day++) counts[day] = running += window.diff[day]!;
    return counts;
  }) as [Int32Array, Int32Array];

  // New players of each period whose following week is over, and whether they played in it.
  for (let user = 0; user < accounts; user++) {
    if (firstWeek[user]! + 1 >= thisWeek) continue;
    for (const { tally: t } of windows)
      if (inside(t, firstAt[user]!)) {
        t.nextWeek.players++;
        t.nextWeek.returned += returnedNextWeek[user]!;
      }
  }

  // Sums over any run of days, from running totals.
  const sums = (values: Int32Array) => {
    const running = new Float64Array(length + 1);
    values.forEach((value, day) => (running[day + 1] = running[day]! + value));
    return (from: number, to: number) => running[Math.min(length, to + 1)]! - running[Math.max(0, from)]!;
  };
  const totals = {
    started: sums(started),
    finished: sums(finished),
    abandoned: sums(abandoned),
    newPlayers: sums(newPlayers),
    seats: sums(seats),
    botSeats: sums(botSeats),
    withBots: sums(withBots),
  };
  /** A series over buckets of days [from, to], with their distinct players and trailing players at their end. */
  const series = (
    buckets: { start: number; from: number; to: number }[],
    active: (bucket: number) => number,
    trailingAt: Int32Array,
  ): GrowthSeries => {
    const result: GrowthSeries = {
      start: [],
      started: [],
      finished: [],
      abandoned: [],
      active: [],
      trailing: [],
      newPlayers: [],
      accounts: [],
      seats: [],
      botSeats: [],
      withBots: [],
      lengths: { games: [], median: [], low: [], high: [] },
    };
    buckets.forEach(({ start, from, to }, bucket) => {
      result.start.push(iso(start));
      for (const name of [
        'started',
        'finished',
        'abandoned',
        'newPlayers',
        'seats',
        'botSeats',
        'withBots',
      ] as const)
        result[name].push(totals[name](from - origin, to - origin));
      result.active.push(active(bucket));
      const end = Math.min(to, today) - origin;
      result.trailing.push(trailingAt[end]!);
      result.accounts.push(totals.newPlayers(0, end));
      const first = Math.max(0, from - origin),
        last = Math.min(length - 1, to - origin);
      let games = 0;
      for (let day = first; day <= last; day++) games += lengths[day]!.length;
      const minutes = new Float64Array(games);
      for (let day = first, n = 0; day <= last; day++)
        for (const value of lengths[day]!) minutes[n++] = value;
      minutes.sort();
      result.lengths.games.push(minutes.length);
      result.lengths.median.push(minutes.length ? tenth(quantile(minutes, 0.5)) : null);
      result.lengths.low.push(minutes.length ? tenth(quantile(minutes, 0.25)) : null);
      result.lengths.high.push(minutes.length ? tenth(quantile(minutes, 0.75)) : null);
    });
    return result;
  };
  const dayBuckets = Array.from({ length: GROWTH_DAYS }, (_, i) => {
    const day = today - GROWTH_DAYS + 1 + i;
    return { start: day, from: day, to: day };
  });
  const weekBuckets = Array.from({ length: weeks }, (_, i) => {
    const monday = mondayOf(weekOf(origin) + i);
    return { start: monday, from: monday, to: monday + 6 };
  });
  const monthBuckets = Array.from({ length: months }, (_, i) => {
    const first = firstDayOf(monthOf(origin) + i);
    return { start: first, from: first, to: firstDayOf(monthOf(origin) + i + 1) - 1 };
  });

  const periods = {} as GrowthReport['periods'];
  for (const { range, previous: before, tally: t } of windows) {
    const minutes = Float64Array.from(t.minutes).sort();
    const period: GrowthPeriod = {
      from: t.from,
      to: t.to,
      started: t.started,
      finished: t.finished,
      abandoned: t.abandoned,
      active: t.active,
      newPlayers: t.newPlayers,
      accountsBefore: t.accountsBefore,
      accountsAfter: t.accountsAfter,
      seats: t.seats,
      botSeats: t.botSeats,
      withBots: t.withBots,
      lengthGames: minutes.length,
      medianMinutes: minutes.length ? tenth(quantile(minutes, 0.5)) : null,
      nextWeek: t.nextWeek,
    };
    periods[range] = before
      ? { current: periods[range]!.current, previous: period }
      : { current: period, previous: null };
  }

  return {
    generatedAt: now,
    firstGameAt,
    days: series(dayBuckets, (i) => daily[dayBuckets[i]!.from - origin]!, trailing7),
    weeks: series(weekBuckets, (i) => weekly[i]!, trailing28),
    months: series(monthBuckets, (i) => monthly[i]!, trailing28),
    periods,
    cohorts: cohorts.map((active, i) => ({ week: iso(mondayOf(cohortFrom + i)), active: [...active] })),
  };
}
