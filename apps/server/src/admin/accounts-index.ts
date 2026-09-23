/**
 * Every account this server knows, with its record, for the Players tab.
 *
 * An account is known from a seat it sat in, a profile it saved, or a visit
 * the presence heartbeat recorded. Its record comes from the match records:
 * games played, won, the points it finished decided games with, and when it
 * first played. Building the list reads every seat and every participation,
 * so it runs on the room index's worker (see room-index.ts), is reused for a
 * short while, and only one sorted page travels back.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { PlayerSort } from './types.js';

export const PLAYERS_PAGE_SIZE = 25;
/** How long the list of accounts is reused, whoever asks. */
export const ACCOUNTS_MAX_AGE_MS = 15_000;

export const PLAYER_SORTS: readonly PlayerSort[] = ['lastSeen', 'games', 'wins', 'joined', 'name'];
export type PlayersQuery = { q: string; sort: PlayerSort; dir: 'asc' | 'desc'; page: number };

export type IndexedAccount = {
  userId: string;
  /** The name it last sat down with, or its profile's; null if it never gave one here. */
  name: string | null;
  /** Every name it has sat down with, newest first: a search matches any of them. */
  names: string[];
  accountType: string | null;
  lastSeen: number | null;
  /** When its first recorded game started. */
  firstPlayed: number | null;
  games: number;
  wins: number;
  /** Games with a winner that it finished in: won, lost or resigned. */
  decided: number;
  /** Points summed over its decided games, where every victory point card was revealed. */
  decidedPoints: number;
};

export type AccountsPage = {
  indexedAt: number;
  total: number;
  accounts: Omit<IndexedAccount, 'names'>[];
};

type RecordRow = {
  userId: string;
  games: number;
  wins: number;
  decided: number;
  decidedPoints: number;
  firstPlayed: number | null;
};

/** Every known account with its record. Reads whole tables: keep it off the game's thread. */
export function indexAccounts(db: DatabaseSync): IndexedAccount[] {
  const accounts = new Map<string, IndexedAccount>();
  const account = (userId: string) => {
    let found = accounts.get(userId);
    if (!found) {
      found = {
        userId,
        name: null,
        names: [],
        accountType: null,
        lastSeen: null,
        firstPlayed: null,
        games: 0,
        wins: 0,
        decided: 0,
        decidedPoints: 0,
      };
      accounts.set(userId, found);
    }
    return found;
  };
  // Seat names, newest first, and the latest sign-in type seen.
  for (const row of db
    .prepare(
      `SELECT user_id AS userId, name, max(rowid) AS latest FROM seats
       WHERE user_id IS NOT NULL GROUP BY user_id, name ORDER BY latest DESC`,
    )
    .all() as { userId: string; name: string }[])
    account(row.userId).names.push(row.name);
  for (const row of db
    .prepare(
      `SELECT user_id AS userId, account_type AS accountType FROM seats
       WHERE user_id IS NOT NULL AND account_type IS NOT NULL ORDER BY rowid`,
    )
    .all() as { userId: string; accountType: string }[])
    account(row.userId).accountType = row.accountType;
  for (const row of db
    .prepare("SELECT user_id AS userId, json_extract(profile, '$.name') AS name FROM profiles")
    .all() as { userId: string; name: unknown }[]) {
    const found = account(row.userId);
    if (typeof row.name === 'string' && !found.names.includes(row.name)) found.names.push(row.name);
  }
  for (const row of db.prepare('SELECT user_id AS userId, at FROM account_last_seen').all() as {
    userId: string;
    at: number;
  }[])
    account(row.userId).lastSeen = row.at;
  for (const row of db
    .prepare(
      `SELECT p.user_id AS userId, count(*) AS games,
         coalesce(sum(p.outcome = 'won'), 0) AS wins,
         coalesce(sum(p.outcome IN ('won', 'lost', 'resigned')), 0) AS decided,
         coalesce(sum(CASE WHEN p.outcome IN ('won', 'lost', 'resigned') THEN p.points ELSE 0 END), 0) AS decidedPoints,
         min(m.started_at) AS firstPlayed
       FROM (
         SELECT room_id, user_id, points, outcome FROM match_participants
         UNION ALL SELECT room_id, user_id, points, outcome FROM archived_participants
       ) p LEFT JOIN (
         SELECT room_id, started_at FROM match_records UNION ALL SELECT room_id, started_at FROM archived_matches
       ) m ON m.room_id = p.room_id
       GROUP BY p.user_id`,
    )
    .all() as RecordRow[]) {
    const found = account(row.userId);
    found.games = row.games;
    found.wins = row.wins;
    found.decided = row.decided;
    found.decidedPoints = row.decidedPoints;
    found.firstPlayed = row.firstPlayed;
  }
  for (const found of accounts.values()) found.name = found.names[0] ?? null;
  return [...accounts.values()];
}

const UUID_PREFIX = /^[0-9a-f-]{8,36}$/i;

/** Nulls always last, whichever way the list runs. */
function compare(a: number | string | null, b: number | string | null, dir: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a < b ? -1 : 1) * dir;
}

/**
 * One page of accounts: those whose name (any they have used) contains `q`,
 * ignoring case, or whose id starts with it; sorted, with the name and then
 * the id breaking ties so pages never overlap.
 */
export function pageAccounts(
  accounts: IndexedAccount[],
  query: PlayersQuery,
  indexedAt: number,
): AccountsPage {
  const q = query.q.trim().toLowerCase();
  const matching = q
    ? accounts.filter(
        (account) =>
          account.names.some((name) => name.toLowerCase().includes(q)) ||
          (UUID_PREFIX.test(q) && account.userId.toLowerCase().startsWith(q)),
      )
    : accounts;
  const dir = query.dir === 'asc' ? 1 : -1;
  const key = (account: IndexedAccount): number | string | null =>
    query.sort === 'lastSeen'
      ? account.lastSeen
      : query.sort === 'games'
        ? account.games
        : query.sort === 'wins'
          ? account.wins
          : query.sort === 'joined'
            ? account.firstPlayed
            : (account.name?.toLowerCase() ?? null);
  const sorted = [...matching].sort(
    (a, b) =>
      compare(key(a), key(b), dir) ||
      compare(a.name?.toLowerCase() ?? null, b.name?.toLowerCase() ?? null, 1) ||
      a.userId.localeCompare(b.userId),
  );
  const start = (query.page - 1) * PLAYERS_PAGE_SIZE;
  return {
    indexedAt,
    total: matching.length,
    accounts: sorted.slice(start, start + PLAYERS_PAGE_SIZE).map(({ names: _names, ...rest }) => rest),
  };
}
