/**
 * Aggregate statistics and the private retention report.
 *
 * Both functions take any SQLite connection. In production they run in a
 * worker thread on their own read-only connection (see analysis-runner.ts), so
 * a scan of the whole journal never holds up a move: WAL readers see a
 * consistent snapshot and never block the game's writer.
 *
 * Journal rows are read only through their `phase` and `dice_total` columns
 * and their public entry. Saved states are never opened here.
 */
import type { DatabaseSync } from 'node:sqlite';
import { readMatches, summarize } from '../../../../scripts/reporting/retention.js';
import { renderCsv } from '../../../../scripts/reporting/render.js';
import type { AdminStats, DiceSummary, RetentionReport } from './types.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const STATS_DAYS = 30;
export const STATS_WEEKS = 8;

/** Chance of each total from 2 to 12 with two fair dice. */
export const FAIR_DICE = Array.from({ length: 11 }, (_, i) => (6 - Math.abs(7 - (i + 2))) / 36);

function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let sum = c[0]!;
  for (let i = 1; i < 9; i++) sum += c[i]! / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Regularized upper incomplete gamma Q(a, x), by series or continued fraction. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const front = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    let term = 1 / a,
      sum = term;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return Math.max(0, 1 - front * sum);
  }
  const tiny = 1e-300;
  let b = x + 1 - a,
    c = 1 / tiny,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.min(1, front * h);
}

/** P(χ² ≥ statistic) for the given degrees of freedom. */
export function chiSquarePValue(statistic: number, degreesOfFreedom: number): number {
  return gammaQ(degreesOfFreedom / 2, statistic / 2);
}

/** Observed totals 2–12 against two fair dice. */
export function diceSummary(counts: number[]): DiceSummary {
  const rolls = counts.reduce((sum, n) => sum + n, 0);
  const expected = FAIR_DICE.map((p) => Math.round(p * rolls * 100) / 100);
  if (!rolls) return { rolls, counts, expected, chiSquare: null, pValue: null };
  const chiSquare = counts.reduce((sum, observed, i) => {
    const e = FAIR_DICE[i]! * rolls;
    return sum + (observed - e) ** 2 / e;
  }, 0);
  return {
    rolls,
    counts,
    expected,
    chiSquare: Math.round(chiSquare * 1000) / 1000,
    pValue: Math.round(chiSquarePValue(chiSquare, 10) * 10000) / 10000,
  };
}

const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Monday-based UTC week, labelled by its Monday. */
function weekStart(at: number): number {
  const day = Math.floor(at / DAY_MS) * DAY_MS;
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return day - weekday * DAY_MS;
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(value * 10) / 10;
};

type MatchRow = {
  id: string;
  startedAt: number | null;
  finishedAt: number | null;
  turns: number;
  winner: string | null;
  players: string;
};

export function computeStats(db: DatabaseSync, now: number): AdminStats {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const from = today - (STATS_DAYS - 1) * DAY_MS;
  const matches = db
    .prepare(
      `SELECT room_id AS id, started_at AS startedAt, finished_at AS finishedAt, turns, winner, players FROM match_records
       UNION ALL
       SELECT room_id, started_at, finished_at, turns, winner, players FROM archived_matches`,
    )
    .all() as MatchRow[];
  const days = Array.from({ length: STATS_DAYS }, (_, i) => ({
    day: isoDay(from + i * DAY_MS),
    started: 0,
    finished: 0,
    abandoned: 0,
    players: 0,
  }));
  const dayIndex = (at: number | null) => (at === null || at < from ? -1 : Math.floor((at - from) / DAY_MS));
  const durations: number[] = [],
    turns: number[] = [];
  // A finished game always has a winner, by points or by resignation; only an abandoned one has none.
  for (const match of matches) {
    const started = dayIndex(match.startedAt);
    if (started >= 0 && started < STATS_DAYS) days[started]!.started++;
    const finished = dayIndex(match.finishedAt);
    if (finished >= 0 && finished < STATS_DAYS) {
      if (match.winner) {
        days[finished]!.finished++;
        if (match.startedAt !== null && match.finishedAt! >= match.startedAt) {
          durations.push((match.finishedAt! - match.startedAt) / 60_000);
          turns.push(match.turns);
        }
      } else days[finished]!.abandoned++;
    }
  }
  // Distinct accounts that played, by the day and week their match started.
  const participants = db
    .prepare(
      `SELECT p.user_id AS userId, m.started_at AS startedAt FROM (
         SELECT room_id, user_id FROM match_participants UNION ALL SELECT room_id, user_id FROM archived_participants
       ) p JOIN (
         SELECT room_id, started_at FROM match_records UNION ALL SELECT room_id, started_at FROM archived_matches
       ) m ON m.room_id = p.room_id
       WHERE m.started_at >= ?`,
    )
    .all(weekStart(now) - (STATS_WEEKS - 1) * 7 * DAY_MS) as { userId: string; startedAt: number }[];
  const perDay = days.map(() => new Set<string>());
  const weekLabels = Array.from({ length: STATS_WEEKS }, (_, i) =>
    isoDay(weekStart(now) - (STATS_WEEKS - 1 - i) * 7 * DAY_MS),
  );
  const perWeek = new Map(weekLabels.map((label) => [label, new Set<string>()]));
  for (const row of participants) {
    const index = dayIndex(row.startedAt);
    if (index >= 0 && index < STATS_DAYS) perDay[index]!.add(row.userId);
    perWeek.get(isoDay(weekStart(row.startedAt)))?.add(row.userId);
  }
  days.forEach((day, i) => (day.players = perDay[i]!.size));
  // Bot share of the seats in matches started in the window.
  const botSeats = new Set(
    db
      .prepare('SELECT id FROM seats WHERE bot = 1')
      .all()
      .map((row) => row.id as string),
  );
  const bots = { matches: 0, matchesWithBots: 0, seats: 0, botSeats: 0 };
  for (const match of matches) {
    if (match.startedAt === null || match.startedAt < from) continue;
    const ids = (JSON.parse(match.players) as { id: string }[]).map((player) => player.id);
    const count = ids.filter((id) => botSeats.has(id)).length;
    bots.matches++;
    bots.seats += ids.length;
    bots.botSeats += count;
    if (count) bots.matchesWithBots++;
  }
  // Dice, room by room through the journal's kind index, so only roll rows are
  // visited. The mode is each room's current dice setting.
  const modes = new Map(
    (
      db.prepare('SELECT room_id, settings FROM room_settings').all() as {
        room_id: string;
        settings: string;
      }[]
    ).map((row) => {
      let mode = 'classic';
      try {
        const value = (JSON.parse(row.settings) as { diceMode?: unknown }).diceMode;
        if (typeof value === 'string') mode = value;
      } catch {
        mode = 'classic';
      }
      return [row.room_id, mode];
    }),
  );
  const rolls = db.prepare(
    `SELECT dice_total AS total, count(*) AS n FROM game_events
     WHERE room_id = ? AND json_extract(public_entry, '$.kind') = 'roll' AND dice_total IS NOT NULL
     GROUP BY dice_total`,
  );
  const overall = Array<number>(11).fill(0);
  const byMode = new Map<string, number[]>();
  for (const { room_id: roomId } of db.prepare('SELECT DISTINCT room_id FROM game_events').all() as {
    room_id: string;
  }[]) {
    const mode = modes.get(roomId) ?? 'classic';
    const counts = byMode.get(mode) ?? byMode.set(mode, Array<number>(11).fill(0)).get(mode)!;
    for (const row of rolls.all(roomId) as { total: number; n: number }[])
      if (row.total >= 2 && row.total <= 12) {
        overall[row.total - 2]! += row.n;
        counts[row.total - 2]! += row.n;
      }
  }
  const accounts = db
    .prepare('SELECT count(DISTINCT user_id) AS n FROM seats WHERE user_id IS NOT NULL')
    .get()!.n as number;
  const unindexed = db
    .prepare(
      'SELECT count(*) AS n FROM games g LEFT JOIN match_records m ON m.room_id = g.room_id WHERE m.room_id IS NULL',
    )
    .get()!.n as number;
  return {
    generatedAt: now,
    days,
    weeks: weekLabels.map((week) => ({ week, players: perWeek.get(week)!.size })),
    completed: { count: durations.length, medianMinutes: median(durations), medianTurns: median(turns) },
    bots,
    dice: {
      overall: diceSummary(overall),
      byMode: Object.fromEntries(
        [...byMode]
          .filter(([, counts]) => counts.some(Boolean))
          .map(([mode, counts]) => [mode, diceSummary(counts)]),
      ),
    },
    totals: {
      matches: matches.length,
      finished: matches.filter((match) => match.finishedAt !== null && match.winner).length,
      abandoned: matches.filter((match) => match.finishedAt !== null && !match.winner).length,
      running: matches.filter((match) => match.finishedAt === null).length,
      accounts,
      unindexedGames: unindexed,
    },
  };
}

/**
 * The private retention report (scripts/reporting/retention.ts) over the live
 * database, ending now. Same measures and coverage lines as the offline command.
 */
export function computeRetention(db: DatabaseSync, now: number, days: number): RetentionReport {
  const window = { from: now - days * DAY_MS, to: now, asOf: now };
  const { matches, unindexed, duplicates } = readMatches(db);
  const metrics = summarize(matches, window);
  metrics.push(
    { section: 'Coverage', metric: 'Unindexed saved games (excluded)', value: unindexed },
    { section: 'Coverage', metric: 'Duplicate records excluded', value: duplicates },
  );
  return { generatedAt: now, days, window, metrics, csv: renderCsv(metrics) };
}
