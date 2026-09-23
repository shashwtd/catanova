/**
 * Accounts as this server knows them: the seats they sat in, the matches they
 * finished, and when they were last here. Read-only. Unlike the player's own
 * history endpoint, nothing here backfills match records; a match played
 * before per-account records existed shows up once its player opens their own
 * history.
 */
import type { AdminContext } from './api.js';
import { AdminRequestError } from './api.js';
import type { PlayerDetail, PlayerMatch, PlayerSummary } from './types.js';

const UUID_PREFIX = /^[0-9a-f-]{8,36}$/i;

const ALL_MATCHES = `WITH all_matches AS (
    SELECT room_id, room_id AS source_room_id, started_at, finished_at, sort_at, turns, winner, players, 0 AS archived
    FROM match_records
    UNION ALL
    SELECT room_id, source_room_id, started_at, finished_at, sort_at, turns, winner, players, 1 FROM archived_matches
  ), all_participants AS (
    SELECT room_id, player_id, user_id, points, outcome FROM match_participants
    UNION ALL SELECT room_id, player_id, user_id, points, outcome FROM archived_participants
  )`;

function record(context: AdminContext, userId: string) {
  const rows = context.store.db
    .prepare(
      `${ALL_MATCHES} SELECT p.outcome AS outcome, count(*) AS n FROM all_participants p WHERE p.user_id = ? GROUP BY p.outcome`,
    )
    .all(userId) as { outcome: string; n: number }[];
  const count = (outcome: string) => rows.find((row) => row.outcome === outcome)?.n ?? 0;
  return {
    matches: rows.reduce((sum, row) => sum + row.n, 0),
    won: count('won'),
    lost: count('lost'),
    resigned: count('resigned'),
    abandoned: count('abandoned'),
    playing: count('playing'),
  };
}

export function searchPlayers(context: AdminContext, query: URLSearchParams): { players: PlayerSummary[] } {
  const q = (query.get('q') ?? '').trim();
  if (q.length < 2 || q.length > 64)
    throw new AdminRequestError(400, 'INVALID_QUERY', 'Search with 2 to 64 characters');
  const { store } = context;
  const escaped = q.replace(/[\\%_]/g, (c) => '\\' + c);
  const like = `%${escaped}%`;
  // An id is matched by prefix only; an empty pattern matches nothing.
  const idLike = UUID_PREFIX.test(q) ? `${escaped.toLowerCase()}%` : '';
  // Seats carry every account that ever sat down; the local profile table covers
  // accounts that only ever saved a profile.
  const ids = store.db
    .prepare(
      `SELECT user_id AS userId, max(rowid) AS latest FROM seats
       WHERE user_id IS NOT NULL AND (name LIKE ? ESCAPE '\\' OR user_id LIKE ? ESCAPE '\\')
       GROUP BY user_id
       UNION
       SELECT user_id, 0 FROM profiles
       WHERE json_extract(profile, '$.name') LIKE ? ESCAPE '\\' OR user_id LIKE ? ESCAPE '\\'
       ORDER BY latest DESC LIMIT 200`,
    )
    .all(like, idLike, like, idLike)
    .map((row) => row.userId as string);
  const players = [...new Set(ids)].slice(0, 50).map((userId): PlayerSummary => {
    const latest = store.db
      .prepare('SELECT name, account_type FROM seats WHERE user_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(userId) as { name: string; account_type: string | null } | undefined;
    const profile = latest
      ? undefined
      : (store.db
          .prepare("SELECT json_extract(profile, '$.name') AS name FROM profiles WHERE user_id = ?")
          .get(userId) as { name: string } | undefined);
    const summary = record(context, userId);
    return {
      userId,
      name: latest?.name ?? profile?.name ?? 'Unknown',
      accountType: latest?.account_type ?? null,
      lastSeen: store.lastSeen(userId),
      matches: summary.matches,
      wins: summary.won,
      currentRoom: store.watchableRoomOf(userId),
    };
  });
  return { players };
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
  if (!names.length && !profile) throw new AdminRequestError(404, 'PLAYER_NOT_FOUND', 'No such account here');
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
  const matches = matchRows.map((row): PlayerMatch => ({
    matchId: row.matchId,
    roomId: row.roomId,
    roomCode: row.roomCode,
    archived: !!row.archived,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    turns: row.turns,
    outcome: row.outcome,
    points: row.points,
    players: (JSON.parse(row.players) as { id: string; name: string; points: number; winner: boolean }[]).map(
      (player) => ({
        name: player.name,
        points: player.id === row.playerId ? row.points : player.points,
        winner: player.winner,
      }),
    ),
  }));
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
  return {
    userId,
    names: names.length ? names : [profile!.name],
    accountType: accountType ?? null,
    lastSeen: store.lastSeen(userId),
    sharesLastSeen: store.accountPrivacy(userId).shareLastSeen,
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
  };
}
