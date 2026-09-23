import type { MatchResults } from '../../../packages/protocol/src/results.js';
import type { DatabaseSync } from 'node:sqlite';
import type { HistoryEntry } from '../../../packages/protocol/src/index.js';
import { isRoomReference, isShortRoomCode } from '../../../packages/protocol/src/room-reference.js';
import { defaultProfile, parseProfile } from '../../../packages/protocol/src/profile.js';
import type { MatchOutcome, MatchPlayer, PlayerGames } from '../../../packages/protocol/src/player-hub.js';
import { score } from '../../../packages/rules/src/game.js';
import type { Game } from '../../../packages/rules/src/game.js';

export const MATCH_PAGE_SIZE = 20;
export const MATCH_BACKFILL_BATCH_SIZE = 8;
type Cursor = { at: number; id: string };
export function parseGamesCursor(value?: string): Cursor | undefined {
  if (value === undefined) return undefined;
  if (!value || value.length > 240 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('Invalid history cursor');
  const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid history cursor');
  const c = parsed as Record<string, unknown>;
  if (
    c.v !== 1 ||
    !Number.isSafeInteger(c.at) ||
    (c.at as number) < 0 ||
    typeof c.id !== 'string' ||
    !isRoomReference(c.id) ||
    isShortRoomCode(c.id)
  )
    throw new Error('Invalid history cursor');
  return { at: c.at as number, id: c.id };
}
const timestamp = (entry: string | undefined): number | null => {
  if (!entry) return null;
  const value = Date.parse((JSON.parse(entry) as HistoryEntry).at);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

/** Rebuildable account index. Game snapshots and their event journal remain authoritative. */
export class PlayerRecords {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS seats_account_history ON seats(user_id,room_id);
      CREATE TABLE IF NOT EXISTS match_records (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id), revision INTEGER NOT NULL,
        started_at INTEGER, finished_at INTEGER, sort_at INTEGER NOT NULL,
        turns INTEGER NOT NULL, winner TEXT, players TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS match_participants (
        room_id TEXT NOT NULL REFERENCES match_records(room_id) ON DELETE CASCADE,
        player_id TEXT NOT NULL, user_id TEXT NOT NULL, points INTEGER NOT NULL,
        outcome TEXT NOT NULL, resumable INTEGER NOT NULL,
        PRIMARY KEY(room_id,player_id)
      );
      CREATE INDEX IF NOT EXISTS match_participants_account ON match_participants(user_id,room_id);
      CREATE TABLE IF NOT EXISTS archived_matches (
        room_id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
        started_at INTEGER, finished_at INTEGER, sort_at INTEGER NOT NULL,
        turns INTEGER NOT NULL, winner TEXT, players TEXT NOT NULL,
        source_room_id TEXT NOT NULL REFERENCES rooms(id)
      );
      CREATE TABLE IF NOT EXISTS archived_participants (
        room_id TEXT NOT NULL REFERENCES archived_matches(room_id), player_id TEXT NOT NULL,
        user_id TEXT NOT NULL, points INTEGER NOT NULL, outcome TEXT NOT NULL, resumable INTEGER NOT NULL,
        PRIMARY KEY(room_id,player_id)
      );
      CREATE TABLE IF NOT EXISTS match_results (
        archive_id TEXT PRIMARY KEY REFERENCES archived_matches(room_id),
        source_room_id TEXT NOT NULL REFERENCES rooms(id), round INTEGER NOT NULL,
        summary TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS match_results_room ON match_results(source_room_id,round DESC);
      CREATE INDEX IF NOT EXISTS archived_participants_account ON archived_participants(user_id,room_id);
      CREATE INDEX IF NOT EXISTS archived_matches_order ON archived_matches(sort_at DESC,room_id DESC);
      CREATE INDEX IF NOT EXISTS match_records_order ON match_records(sort_at DESC,room_id DESC);
    `);
  }
  /** Called inside the same transaction as the game/event commit, never by a client-supplied result. */
  record(roomId: string, revision: number, game: Game, entry?: HistoryEntry) {
    const old = this.db
      .prepare('SELECT started_at,finished_at FROM match_records WHERE room_id=?')
      .get(roomId) as { started_at: number | null; finished_at: number | null } | undefined;
    const currentEntry = entry ? JSON.stringify(entry) : undefined;
    const startedAt =
      entry?.kind === 'start'
        ? timestamp(currentEntry)
        : old
          ? old.started_at
          : timestamp(
              this.db
                .prepare(
                  "SELECT public_entry FROM game_events WHERE room_id=? AND json_extract(public_entry,'$.kind')='start' ORDER BY revision LIMIT 1",
                )
                .get(roomId)?.public_entry as string | undefined,
            );
    // A legacy import has a save date, not necessarily a finish date. Do not invent one.
    const finishEntry =
      game.phase === 'finished' && old?.finished_at == null
        ? (currentEntry ??
          (this.db
            .prepare(
              "SELECT public_entry FROM game_events WHERE room_id=? AND phase='finished' ORDER BY revision LIMIT 1",
            )
            .get(roomId)?.public_entry as string | undefined))
        : undefined;
    const finish = finishEntry ? (JSON.parse(finishEntry) as HistoryEntry) : undefined;
    const finishedAt =
      game.phase === 'finished'
        ? (old?.finished_at ?? (finish?.kind === 'legacy' ? null : timestamp(finishEntry)))
        : null;
    const seats = this.db
      .prepare('SELECT id,user_id,profile,departed FROM seats WHERE room_id=?')
      .all(roomId) as {
      id: string;
      user_id: string | null;
      profile: string | null;
      departed: number;
    }[];
    const players: MatchPlayer[] = game.players.map((p) => {
      const seat = seats.find((s) => s.id === p.id);
      const profile = seat?.profile ? parseProfile(JSON.parse(seat.profile)) : defaultProfile(p.name);
      return {
        id: p.id,
        name: p.name,
        profile,
        points: score(game, p, !!game.winner),
        winner: game.winner === p.id,
      };
    });
    this.db
      .prepare(
        `
      INSERT INTO match_records(room_id,revision,started_at,finished_at,sort_at,turns,winner,players)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET
      revision=excluded.revision,started_at=excluded.started_at,finished_at=excluded.finished_at,
      sort_at=excluded.sort_at,turns=excluded.turns,winner=excluded.winner,players=excluded.players
    `,
      )
      .run(
        roomId,
        revision,
        startedAt,
        finishedAt,
        startedAt ?? 0,
        game.turn,
        game.winner,
        JSON.stringify(players),
      );
    this.db.prepare('DELETE FROM match_participants WHERE room_id=?').run(roomId);
    const insert = this.db.prepare(
      'INSERT INTO match_participants(room_id,player_id,user_id,points,outcome,resumable) VALUES(?,?,?,?,?,?)',
    );
    for (const player of game.players) {
      const seat = seats.find((s) => s.id === player.id);
      if (!seat?.user_id) continue;
      const outcome: MatchOutcome =
        game.finishReason === 'abandoned'
          ? 'abandoned'
          : player.resigned
            ? 'resigned'
            : game.winner === player.id
              ? 'won'
              : game.winner
                ? 'lost'
                : 'playing';
      insert.run(
        roomId,
        player.id,
        seat.user_id,
        score(game, player, true),
        outcome,
        Number(game.phase !== 'finished' && !player.resigned && !seat.departed),
      );
    }
  }
  /** Called only within the room reset transaction; historical results cannot be overwritten by a rematch. */
  archive(roomId: string, archiveId: string) {
    this.db
      .prepare(
        `INSERT INTO archived_matches
      SELECT ?,revision,started_at,finished_at,sort_at,turns,winner,players,room_id FROM match_records WHERE room_id=?`,
      )
      .run(archiveId, roomId);
    this.db
      .prepare(
        `INSERT INTO archived_participants
      SELECT ?,player_id,user_id,points,outcome,0 FROM match_participants WHERE room_id=?`,
      )
      .run(archiveId, roomId);
    this.db.prepare('DELETE FROM match_records WHERE room_id=?').run(roomId);
  }
  saveResults(results: MatchResults) {
    this.db
      .prepare('INSERT INTO match_results VALUES (?,?,?,?)')
      .run(results.id, results.roomId, results.round, JSON.stringify(results));
  }
  resultsForAccount(archiveId: string, userId: string): MatchResults | null {
    const row = this.db
      .prepare(
        `SELECT r.summary FROM match_results r
      JOIN archived_participants p ON p.room_id=r.archive_id
      WHERE r.archive_id=? AND p.user_id=? LIMIT 1`,
      )
      .get(archiveId, userId);
    return row ? (JSON.parse(row.summary as string) as MatchResults) : null;
  }
  previousResults(roomId: string, viewer: string): MatchResults | null {
    const row = this.db
      .prepare(
        `SELECT summary FROM match_results
      WHERE source_room_id=? ORDER BY round DESC LIMIT 1`,
      )
      .get(roomId);
    if (!row) return null;
    const result = JSON.parse(row.summary as string) as MatchResults;
    // viewer is the authenticated socket's seat, never a client supplied player ID.
    return result.game.players.some((p) => p.id === viewer) ? result : null;
  }
  /** Older saved matches are indexed once, on demand, without touching their game state or journal. */
  backfillBatch(userId: string, loadGame: (roomId: string) => Game | undefined, afterRoomId = '') {
    const missing = this.db
      .prepare(
        `
      SELECT DISTINCT g.room_id,coalesce((SELECT max(revision) FROM game_events e WHERE e.room_id=g.room_id),r.revision) AS revision
      FROM seats s JOIN games g ON g.room_id=s.room_id JOIN rooms r ON r.id=g.room_id
      LEFT JOIN match_records m ON m.room_id=g.room_id
      LEFT JOIN match_participants p ON p.room_id=g.room_id AND p.player_id=s.id AND p.user_id=s.user_id
      WHERE s.user_id=? AND s.room_id>? AND (m.room_id IS NULL OR m.revision<>coalesce((SELECT max(revision) FROM game_events e WHERE e.room_id=g.room_id),r.revision)
        OR (p.player_id IS NULL AND EXISTS(SELECT 1 FROM json_each(g.state,'$.players') j WHERE json_extract(j.value,'$.id')=s.id)))
      ORDER BY g.room_id LIMIT ?
    `,
      )
      .all(userId, afterRoomId, MATCH_BACKFILL_BATCH_SIZE + 1) as { room_id: string; revision: number }[];
    const batch = missing.slice(0, MATCH_BACKFILL_BATCH_SIZE);
    for (const row of batch) {
      const game = loadGame(row.room_id);
      if (game) this.record(row.room_id, row.revision, game);
    }
    return {
      complete: missing.length <= MATCH_BACKFILL_BATCH_SIZE,
      afterRoomId: batch.at(-1)?.room_id ?? afterRoomId,
    };
  }
  page(userId: string, now: number, cursor?: Cursor): PlayerGames {
    const sources = `WITH all_matches AS (
      SELECT * FROM match_records UNION ALL
      SELECT room_id,revision,started_at,finished_at,sort_at,turns,winner,players FROM archived_matches
    ), all_participants AS (SELECT * FROM match_participants UNION ALL SELECT * FROM archived_participants)`;
    const stats = this.db
      .prepare(
        `${sources}
      SELECT count(*) AS played,coalesce(sum(CASE WHEN p.outcome='won' THEN 1 ELSE 0 END),0) AS wins
      FROM all_participants p JOIN all_matches m ON m.room_id=p.room_id WHERE p.user_id=? AND m.winner IS NOT NULL
    `,
      )
      .get(userId) as { played: number; wins: number };
    const rows = this.db
      .prepare(
        `${sources}
      SELECT m.*,p.player_id,p.points,p.outcome,p.resumable,
      (SELECT code FROM room_codes c WHERE c.room_id=m.room_id AND c.expires_at>?) AS room_code
      FROM all_participants p JOIN all_matches m ON m.room_id=p.room_id WHERE p.user_id=?
      ${cursor ? 'AND (m.sort_at<? OR (m.sort_at=? AND m.room_id<?))' : ''}
      ORDER BY m.sort_at DESC,m.room_id DESC LIMIT ?
    `,
      )
      .all(now, userId, ...(cursor ? [cursor.at, cursor.at, cursor.id] : []), MATCH_PAGE_SIZE + 1) as {
      room_id: string;
      room_code: string | null;
      sort_at: number;
      started_at: number | null;
      finished_at: number | null;
      turns: number;
      players: string;
      player_id: string;
      points: number;
      outcome: MatchOutcome;
      resumable: number;
    }[];
    const page = rows.slice(0, MATCH_PAGE_SIZE),
      last = page.at(-1);
    return {
      stats: { played: stats.played, wins: stats.wins },
      games: page.map((m) => ({
        roomId: m.room_id,
        roomCode: m.room_code,
        startedAt: m.started_at,
        finishedAt: m.finished_at,
        turns: m.turns,
        outcome: m.outcome,
        points: m.points,
        resumable: !!m.resumable,
        players: (JSON.parse(m.players) as MatchPlayer[]).map((p) =>
          p.id === m.player_id ? { ...p, points: m.points } : p,
        ),
      })),
      nextCursor:
        rows.length > MATCH_PAGE_SIZE && last
          ? Buffer.from(JSON.stringify({ v: 1, at: last.sort_at, id: last.room_id })).toString('base64url')
          : null,
    };
  }
}
