import type { DatabaseSync } from 'node:sqlite';
import { decodeState } from '../../apps/server/src/journal.js';

type AccountType = 'guest' | 'permanent' | 'unknown';
type Outcome = 'points' | 'resignation' | 'abandoned' | 'running' | 'finishedUnknown';
type Mix = 'humanOnly' | 'withBots' | 'unknown';
type Participant = { account: string; type: AccountType; player: string };
export type ObservedMatch = {
  key: string;
  room: string;
  start: number | null;
  finish: number | null;
  outcome: Outcome;
  turns: number;
  mix: Mix;
  humans: Participant[];
  humanActions: { account: string; at: number }[];
  unknownActions: number;
  knownActions: number;
  startKnown: boolean;
};
export type Window = { from: number; to: number; asOf: number };
export type Metric = {
  section: string;
  metric: string;
  value: number | null;
  denominator?: number;
  unit?: string;
};
const minute = 60_000,
  day = 24 * 60 * minute;
const time = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Date.parse(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};
const fields = (db: DatabaseSync, table: string) =>
  new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name),
  );

/** Reads a consistent, isolated snapshot. Never opens a Store or backfills live records. */
export function readMatches(db: DatabaseSync): {
  matches: ObservedMatch[];
  unindexed: number;
  duplicates: number;
} {
  const cols = fields(db, 'game_events');
  const rows = db
    .prepare(
      `
    SELECT room_id,room_id AS source_room_id,revision,started_at,finished_at,turns,winner,players,0 AS archived FROM match_records
    UNION ALL
    SELECT room_id,source_room_id,revision,started_at,finished_at,turns,winner,players,1 AS archived FROM archived_matches
    ORDER BY source_room_id,revision,archived DESC
  `,
    )
    .all() as unknown as {
    room_id: string;
    source_room_id: string;
    revision: number;
    started_at: number | null;
    finished_at: number | null;
    turns: number;
    winner: string | null;
    players: string;
    archived: number;
  }[];
  const startQuery =
    db.prepare(`SELECT revision,public_entry,${cols.has('participants') ? 'participants' : 'NULL AS participants'} FROM game_events
    WHERE room_id=? AND revision<=? AND revision>? AND json_extract(public_entry,'$.kind')='start' ORDER BY revision DESC LIMIT 1`);
  // Older snapshots keep a whole game on every row; newer ones compact it (see
  // apps/server/src/journal.ts). Only the last row of each match is read, so
  // decoding it here costs next to nothing.
  const compact = cols.has('state_z');
  const endQuery =
    db.prepare(`SELECT state,${compact ? 'state_z,board_hash' : 'NULL AS state_z,NULL AS board_hash'}
    FROM game_events WHERE room_id=? AND revision<=? AND revision>? ORDER BY revision DESC LIMIT 1`);
  const boardQuery = compact ? db.prepare('SELECT board FROM journal_boards WHERE hash=?') : undefined;
  const ending = (roomId: string, revision: number, floor: number) => {
    const row = endQuery.get(roomId, revision, floor) as
      { state: string; state_z: Uint8Array | null; board_hash: string | null } | undefined;
    if (!row) return undefined;
    const board =
      row.state === '' ? (boardQuery?.get(row.board_hash)?.board as string | undefined) : undefined;
    const game =
      row.state !== ''
        ? (JSON.parse(row.state) as { phase?: string; finishReason?: string })
        : row.state_z && board
          ? decodeState(row.state_z, board)
          : undefined;
    return game ? { phase: game.phase, reason: game.finishReason } : undefined;
  };
  const actionsQuery =
    db.prepare(`SELECT actor,public_entry,${cols.has('actor_kind') ? 'actor_kind' : 'NULL AS actor_kind'} FROM game_events
    WHERE room_id=? AND revision>=? AND revision<=? ORDER BY revision`);
  const participantsQuery = db.prepare(`SELECT player_id,user_id FROM match_participants WHERE room_id=?
    UNION SELECT player_id,user_id FROM archived_participants WHERE room_id=?`);
  const seatsQuery = db.prepare('SELECT id,bot FROM seats WHERE room_id=?');
  const matches: ObservedMatch[] = [],
    seen = new Set<string>(),
    revisions = new Set<string>();
  const lower = new Map<string, number>();
  let duplicates = 0;
  for (const row of rows) {
    const revisionKey = `${row.source_room_id}:${row.revision}`;
    if (revisions.has(revisionKey)) {
      duplicates++;
      continue;
    }
    revisions.add(revisionKey);
    const floor = lower.get(row.source_room_id) ?? -1;
    const start = startQuery.get(row.source_room_id, row.revision, floor);
    const startRevision = start?.revision as number | undefined;
    const key = `${row.source_room_id}:${startRevision === undefined ? 'legacy:' + row.revision : startRevision}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    if (row.archived) lower.set(row.source_room_id, row.revision);
    const info = ending(row.source_room_id, row.revision, floor);
    const roster = JSON.parse(row.players) as { id: string }[];
    const meta = start?.participants
      ? (JSON.parse(start.participants as string) as { id: string; bot: number; accountType?: string }[])
      : null;
    const seats = seatsQuery.all(row.source_room_id) as { id: string; bot: number }[];
    const humans: Participant[] = (
      participantsQuery.all(row.room_id, row.room_id) as { player_id: string; user_id: string }[]
    )
      .filter(
        (p) =>
          roster.some((r) => r.id === p.player_id) && !(meta ?? seats).find((r) => r.id === p.player_id)?.bot,
      )
      .map((p) => {
        const type = meta?.find((r) => r.id === p.player_id)?.accountType;
        return {
          account: p.user_id,
          player: p.player_id,
          type: type === 'guest' || type === 'permanent' ? type : 'unknown',
        };
      });
    const hasBots = roster.some((p) => (meta ?? seats).find((r) => r.id === p.id)?.bot);
    const rosterKnown = roster.every((p) => (meta ?? seats).some((r) => r.id === p.id));
    const actions = actionsQuery.all(row.source_room_id, startRevision ?? floor + 1, row.revision);
    const humanActions: ObservedMatch['humanActions'] = [];
    let unknownActions = 0,
      knownActions = 0;
    for (const action of actions) {
      const entry = JSON.parse(action.public_entry as string) as { at?: string; kind?: string };
      const account = humans.find((p) => p.player === action.actor)?.account;
      const at = time(entry.at);
      if (!account || at === null) continue;
      if (!action.actor_kind || entry.kind === 'legacy') unknownActions++;
      else {
        knownActions++;
        if (action.actor_kind === 'human') humanActions.push({ account, at });
      }
    }
    const finished =
      row.archived === 1 || info?.phase === 'finished' || !!row.winner || row.finished_at !== null;
    const outcome: Outcome = !finished
      ? 'running'
      : info?.reason === 'resignation'
        ? 'resignation'
        : info?.reason === 'abandoned'
          ? 'abandoned'
          : info?.phase === 'finished' && row.winner
            ? 'points'
            : 'finishedUnknown';
    matches.push({
      key,
      room: row.source_room_id,
      start: start ? time(JSON.parse(start.public_entry as string).at) : time(row.started_at),
      startKnown: !!start,
      finish: finished ? time(row.finished_at) : null,
      outcome,
      turns: row.turns,
      mix: hasBots ? 'withBots' : rosterKnown ? 'humanOnly' : 'unknown',
      humans,
      humanActions,
      unknownActions,
      knownActions,
    });
  }
  const unindexed = Number(
    db
      .prepare(
        'SELECT count(*) n FROM games g LEFT JOIN match_records m ON m.room_id=g.room_id WHERE m.room_id IS NULL',
      )
      .get()!.n,
  );
  return { matches, unindexed, duplicates };
}
const median = (values: number[]) => {
  values.sort((a, b) => a - b);
  const n = values.length;
  return n ? (values[Math.floor((n - 1) / 2)]! + values[Math.floor(n / 2)]!) / 2 : null;
};
export function summarize(matches: ObservedMatch[], window: Window): Metric[] {
  const { from, to, asOf } = window;
  if (![from, to, asOf].every(Number.isFinite) || from >= to || to > asOf)
    throw new Error('Require from < to <= as-of');
  const cohort = matches.filter((m) => m.start !== null && m.start >= from && m.start < to);
  const metrics: Metric[] = [];
  const add = (section: string, metric: string, value: number | null, denominator?: number, unit?: string) =>
    metrics.push({
      section,
      metric,
      value,
      ...(denominator === undefined ? {} : { denominator }),
      ...(unit ? { unit } : {}),
    });
  add('Coverage', 'Matches with unknown start time', matches.filter((m) => m.start === null).length);
  add('Coverage', 'Matches without a start event', matches.filter((m) => !m.startKnown).length);
  add(
    'Coverage',
    'Account actions with unknown provenance',
    matches.reduce((n, m) => n + m.unknownActions, 0),
  );
  add(
    'Coverage',
    'Account actions with known provenance',
    matches.reduce((n, m) => n + m.knownActions, 0),
  );
  for (const mix of ['all', 'humanOnly', 'withBots', 'unknown'] as const) {
    const group = cohort.filter((m) => mix === 'all' || m.mix === mix);
    add(`Matches · ${mix}`, 'Started', group.length);
    for (const outcome of ['points', 'resignation', 'abandoned', 'running', 'finishedUnknown'] as const) {
      const subset = group.filter((m) => m.outcome === outcome);
      add(`Matches · ${mix}`, outcome, subset.length, group.length);
      if (outcome === 'running') continue;
      const durations = subset
        .filter((m) => m.finish !== null && m.finish! >= m.start!)
        .map((m) => (m.finish! - m.start!) / minute);
      add(`Duration · ${mix}`, `${outcome} elapsed minutes`, median(durations), durations.length, 'minutes');
      add(
        `Duration · ${mix}`,
        `${outcome} turns`,
        median(subset.map((m) => m.turns)),
        subset.length,
        'turns',
      );
    }
  }
  const humanMultiplayer = (m: ObservedMatch) => new Set(m.humans.map((p) => p.account)).size >= 2;
  const sources = cohort.filter((m) => humanMultiplayer(m) && m.outcome !== 'running' && m.finish !== null);
  const mature = sources.filter((m) => m.finish! + 30 * minute <= asOf);
  let sameRoom = 0,
    newRoom = 0;
  for (const source of mature) {
    const accounts = new Set(source.humans.map((p) => p.account));
    const next = matches
      .filter(
        (m) =>
          m.key !== source.key &&
          m.start !== null &&
          m.start >= source.finish! &&
          m.start <= source.finish! + 30 * minute &&
          new Set(m.humans.filter((p) => accounts.has(p.account)).map((p) => p.account)).size >= 2,
      )
      .sort((a, b) => a.start! - b.start! || a.key.localeCompare(b.key))[0];
    if (next) {
      if (source.room === next.room) sameRoom++;
      else newRoom++;
    }
  }
  add('Group return', 'Played another match within 30 minutes', sameRoom + newRoom, mature.length);
  add('Group return', 'Same room', sameRoom, mature.length);
  add('Group return', 'New room', newRoom, mature.length);
  add('Group return', 'Pending 30-minute observation', sources.length - mature.length);
  add(
    'Group return',
    'Finished multiplayer matches missing finish time',
    cohort.filter((m) => humanMultiplayer(m) && m.outcome !== 'running' && m.finish === null).length,
  );
  // Fix an account's anchor to its first observed human-played match; never slide it to its latest match.
  const anchors = new Map<string, { at: number; type: AccountType }>();
  const activity = new Map<string, number[]>();
  const unproven = new Set<string>();
  for (const m of [...matches].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))) {
    for (const p of m.humans) {
      const actions = m.humanActions.filter((a) => a.account === p.account && a.at <= asOf);
      if (!actions.length) unproven.add(p.account);
      if (m.start !== null && actions.length && !anchors.has(p.account))
        anchors.set(p.account, { at: m.start, type: p.type });
      activity.set(p.account, [...(activity.get(p.account) ?? []), ...actions.map((a) => a.at)]);
    }
  }
  add(
    'Coverage',
    'Accounts with no proven human action',
    [...unproven].filter((a) => !anchors.has(a)).length,
  );
  const accounts = [...anchors].filter(([, a]) => a.at >= from && a.at < to);
  for (const type of ['all', 'guest', 'permanent', 'unknown'] as const) {
    const group = accounts.filter(([, a]) => type === 'all' || a.type === type);
    const eligible = group.filter(([, a]) => a.at + 2 * day <= asOf);
    const returned = eligible.filter(([id, a]) =>
      activity.get(id)?.some((at) => at >= a.at + day && at < a.at + 2 * day),
    ).length;
    add(`Account return · ${type}`, 'Human action 24–48 hours later', returned, eligible.length);
    add(`Account return · ${type}`, 'Pending 48-hour observation', group.length - eligible.length);
  }
  add(
    'Checkpoint',
    'Completed human multiplayer matches',
    cohort.filter((m) => humanMultiplayer(m) && m.outcome !== 'running').length,
  );
  return metrics;
}
