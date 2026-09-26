/**
 * Accounts as this server knows them: the seats they sat in, the matches they
 * finished, and when they were last here. Read-only. Unlike the player's own
 * history endpoint, nothing here backfills match records; a match played
 * before per-account records existed shows up once its player opens their own
 * history.
 *
 * Points are always what the table saw: victory point cards count once a
 * winner revealed them, never in a game still being played.
 */
import type { AdminContext } from './api.js';
import { AdminRequestError } from './api.js';
import { PLAYERS_PAGE_SIZE, PLAYER_SORTS } from './accounts-index.js';
import { whoIsOnline } from './online.js';
import type { RoomIndex } from './room-index.js';
import type { PlayerDetail, PlayerMatch, PlayerSort, PlayersPage, PlayerSummary } from './types.js';

const ALL_MATCHES = `WITH all_matches AS (
    SELECT room_id, room_id AS source_room_id, started_at, finished_at, sort_at, turns, winner, players, 0 AS archived
    FROM match_records
    UNION ALL
    SELECT room_id, source_room_id, started_at, finished_at, sort_at, turns, winner, players, 1 FROM archived_matches
  ), all_participants AS (
    SELECT room_id, player_id, user_id, points, outcome FROM match_participants
    UNION ALL SELECT room_id, player_id, user_id, points, outcome FROM archived_participants
  )`;

/** Wins over games with a winner, and the points those games ended with; null before any. */
const rates = (wins: number, decided: number, points: number) => ({
  winRate: decided ? Math.round((wins / decided) * 1000) / 1000 : null,
  averagePoints: decided ? Math.round((points / decided) * 10) / 10 : null,
});

function record(context: AdminContext, userId: string) {
  const rows = context.store.db
    .prepare(
      `${ALL_MATCHES} SELECT p.outcome AS outcome, count(*) AS n, sum(p.points) AS points, min(m.started_at) AS first
       FROM all_participants p LEFT JOIN all_matches m ON m.room_id = p.room_id
       WHERE p.user_id = ? GROUP BY p.outcome`,
    )
    .all(userId) as { outcome: string; n: number; points: number; first: number | null }[];
  const count = (outcome: string) => rows.find((row) => row.outcome === outcome)?.n ?? 0;
  const decided = rows.filter((row) => ['won', 'lost', 'resigned'].includes(row.outcome));
  const firsts = rows.map((row) => row.first).filter((first): first is number => first !== null);
  return {
    matches: rows.reduce((sum, row) => sum + row.n, 0),
    won: count('won'),
    lost: count('lost'),
    resigned: count('resigned'),
    abandoned: count('abandoned'),
    playing: count('playing'),
    ...rates(
      count('won'),
      decided.reduce((sum, row) => sum + row.n, 0),
      decided.reduce((sum, row) => sum + row.points, 0),
    ),
    firstPlayed: firsts.length ? Math.min(...firsts) : null,
  };
}

/** Sort, direction, page and search from the query, each checked. */
function playersQuery(query: URLSearchParams) {
  const sort = (query.get('sort') ?? 'lastSeen') as PlayerSort;
  if (!PLAYER_SORTS.includes(sort)) throw new AdminRequestError(400, 'INVALID_SORT');
  const dir = query.get('dir') ?? (sort === 'name' ? 'asc' : 'desc');
  if (dir !== 'asc' && dir !== 'desc') throw new AdminRequestError(400, 'INVALID_SORT');
  const page = Number(query.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new AdminRequestError(400, 'INVALID_PAGE');
  const q = (query.get('q') ?? '').trim();
  if (q.length > 64) throw new AdminRequestError(400, 'INVALID_QUERY', 'Search with at most 64 characters');
  return { sort, dir: dir as 'asc' | 'desc', page, q };
}

/**
 * Every known account, one sorted page at a time, optionally searched by any
 * name it has used or the start of its id. The list and its sorting come from
 * the room index's worker; the page's 25 rows then get who is online and the
 * game each is in, a few indexed lookups each.
 */
export async function listPlayers(
  context: AdminContext,
  index: RoomIndex,
  query: URLSearchParams,
): Promise<PlayersPage> {
  const { sort, dir, page, q } = playersQuery(query);
  const { store, runtime } = context;
  const now = context.now();
  const found = await index.players(now, { q, sort, dir, page });
  const online = whoIsOnline(store, runtime, now);
  const here = new Set(online.people.flatMap((person) => (person.userId ? [person.userId] : [])));
  const items = found.accounts.map((account): PlayerSummary => ({
    userId: account.userId,
    name: account.name,
    accountType: account.accountType,
    lastSeen: account.lastSeen,
    firstPlayed: account.firstPlayed,
    games: account.games,
    wins: account.wins,
    ...rates(account.wins, account.decided, account.decidedPoints),
    online: here.has(account.userId),
    currentRoom: store.watchableRoomOf(account.userId),
  }));
  return {
    items,
    total: found.total,
    page,
    pageSize: PLAYERS_PAGE_SIZE,
    sort,
    dir,
    q,
    indexedAt: found.indexedAt,
    presence: online.accounts,
  };
}

export function playerDetail(context: AdminContext, userId: string): PlayerDetail {
  const { store } = context;
  const names = store.db
    .prepare(
      'SELECT name, max(rowid) AS latest FROM seats WHERE user_id = ? GROUP BY name ORDER BY latest DESC',
    )
    .all(userId)
    .map((row) => row.name as string);
  const profile = store.db
    .prepare("SELECT json_extract(profile, '$.name') AS name FROM profiles WHERE user_id = ?")
    .get(userId) as { name: string } | undefined;
  // An account that only ever opened the player hub has no name here, but it was here.
  if (!names.length && !profile && store.lastSeen(userId) === null)
    throw new AdminRequestError(404, 'PLAYER_NOT_FOUND', 'No such account here');
  const accountType = store.db
    .prepare(
      'SELECT account_type FROM seats WHERE user_id = ? AND account_type IS NOT NULL ORDER BY rowid DESC LIMIT 1',
    )
    .get(userId)?.account_type as string | undefined;
  const matchRows = store.db
    .prepare(
      `${ALL_MATCHES}
       SELECT m.room_id AS matchId, m.source_room_id AS roomId, m.archived AS archived, m.started_at AS startedAt,
         m.finished_at AS finishedAt, m.turns AS turns, m.winner AS winner, m.players AS players,
         p.player_id AS playerId, p.points AS points, p.outcome AS outcome,
         (SELECT code FROM room_codes c WHERE c.room_id = m.source_room_id AND c.expires_at > ?) AS roomCode
       FROM all_participants p JOIN all_matches m ON m.room_id = p.room_id
       WHERE p.user_id = ? ORDER BY m.sort_at DESC, m.room_id DESC LIMIT 50`,
    )
    .all(context.now(), userId) as {
    matchId: string;
    roomId: string;
    archived: number;
    startedAt: number | null;
    finishedAt: number | null;
    turns: number;
    winner: string | null;
    players: string;
    playerId: string;
    points: number;
    outcome: string;
    roomCode: string | null;
  }[];
  const matches = matchRows.map((row): PlayerMatch => {
    // The points the table saw, the player's own included. A participation row
    // also counts victory point cards the table never saw revealed.
    const players = JSON.parse(row.players) as {
      id: string;
      name: string;
      points: number;
      winner: boolean;
    }[];
    return {
      matchId: row.matchId,
      roomId: row.roomId,
      roomCode: row.roomCode,
      archived: !!row.archived,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      turns: row.turns,
      outcome: row.outcome,
      points: players.find((player) => player.id === row.playerId)?.points ?? row.points,
      players: players.map((player) => ({ name: player.name, points: player.points, winner: player.winner })),
    };
  });
  const seats = store.db
    .prepare(
      `SELECT s.room_id AS roomId, s.name AS name, s.departed AS departed,
         (SELECT code FROM room_codes c WHERE c.room_id = s.room_id AND c.expires_at > ?) AS roomCode
       FROM seats s WHERE s.user_id = ? ORDER BY s.rowid DESC LIMIT 20`,
    )
    .all(context.now(), userId)
    .map((row) => ({
      roomId: row.roomId as string,
      roomCode: (row.roomCode as string | null) ?? null,
      name: row.name as string,
      departed: !!row.departed,
    }));
  const online = whoIsOnline(store, context.runtime, context.now());
  return {
    userId,
    names: names.length ? names : profile ? [profile.name] : [],
    accountType: accountType ?? null,
    lastSeen: store.lastSeen(userId),
    sharesLastSeen: store.accountPrivacy(userId).shareLastSeen,
    online: online.people.find((person) => person.userId === userId) ?? null,
    presence: online.accounts,
    currentRoom: store.watchableRoomOf(userId),
    record: record(context, userId),
    matches,
    seats,
    feedback: store.db
      .prepare('SELECT id, at, category, status FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 10')
      .all(userId)
      .map((row) => ({
        id: row.id as number,
        at: row.at as number,
        category: row.category as string,
        status: row.status as string,
      })),
    tester: store.modes.tester(userId),
  };
}
