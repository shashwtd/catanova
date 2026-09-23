/**
 * Rooms and games as the admin console sees them.
 *
 * Status comes from cheap columns: whether a `games` row exists, the phase
 * recorded on the room's newest journal row, and the presence row's pause
 * mark. A room's saved game is opened (through `Store.loadGame`, which checks
 * its hash) only for the rooms on the page being shown, never for every room
 * on every refresh. Journal rows are read only through their `phase` column
 * and public entry; their saved states are never opened here.
 */
import type { Store } from '../store.js';
import { ProtocolError, ROOM_CODE_LEASE_MS } from '../store.js';
import type { Game } from '../../../../packages/rules/src/game.js';
import type { RoomState } from '../../../../packages/protocol/src/index.js';
import {
  isRoomReference,
  isShortRoomCode,
  normalizeRoomReference,
} from '../../../../packages/protocol/src/room-reference.js';
import { AdminRequestError } from './api.js';
import type { AdminContext, ApiRequest } from './api.js';
import type {
  GameDetail,
  GameListItem,
  GamesPage,
  PrivateGameState,
  RoomStatus,
  SeatSummary,
} from './types.js';

export const GAMES_PAGE_SIZE = 25;
export const ROOM_STATUSES: RoomStatus[] = ['lobby', 'live', 'paused', 'finished', 'empty'];
/** A room id or room code in a URL path. */
export const ROOM_PARAM = '([A-Za-z0-9-]{4,36})';

export type IndexedRoom = {
  id: string;
  revision: number;
  code: string | null;
  seats: number;
  humans: number;
  hasGame: boolean;
  paused: boolean;
  phase: string | null;
  turn: number | null;
  lastActivity: number | null;
  status: RoomStatus;
};

const time = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Every room (or just `only`) with its status, most recently active first.
 * One pass; no saved game is opened.
 */
export function indexRooms(store: Store, now: number, only?: string): IndexedRoom[] {
  const rows = store.db
    .prepare(
      `SELECT r.id AS id, r.revision AS revision,
         (SELECT c.code FROM room_codes c WHERE c.room_id = r.id AND c.expires_at > ?) AS code,
         (SELECT c.expires_at FROM room_codes c WHERE c.room_id = r.id) AS codeExpires,
         (SELECT count(*) FROM seats s WHERE s.room_id = r.id AND s.departed = 0) AS seats,
         (SELECT count(*) FROM seats s WHERE s.room_id = r.id AND s.departed = 0 AND s.bot = 0) AS humans,
         EXISTS (SELECT 1 FROM games g WHERE g.room_id = r.id) AS hasGame,
         (SELECT json_extract(p.state, '$.pausedAt') FROM room_presence p WHERE p.room_id = r.id) AS pausedAt
       FROM rooms r WHERE ? IS NULL OR r.id = ?`,
    )
    .all(now, only ?? null, only ?? null) as {
    id: string;
    revision: number;
    code: string | null;
    codeExpires: number | null;
    seats: number;
    humans: number;
    hasGame: number;
    pausedAt: number | null;
  }[];
  // The newest journal row of a room with a game describes that game: its phase
  // column, and its public entry's time and turn.
  const head = store.db.prepare(
    `SELECT phase, json_extract(public_entry, '$.at') AS at, json_extract(public_entry, '$.turn') AS turn
     FROM game_events WHERE room_id = ? ORDER BY revision DESC LIMIT 1`,
  );
  return rows
    .map((row): IndexedRoom => {
      const event = row.hasGame
        ? (head.get(row.id) as { phase: string | null; at: string | null; turn: number | null } | undefined)
        : undefined;
      const phase = event?.phase ?? null;
      const paused = row.pausedAt !== null;
      // Room codes are renewed on every admission and move, so their lease dates the room's last activity.
      const touched = row.codeExpires === null ? null : row.codeExpires - ROOM_CODE_LEASE_MS;
      const eventAt = time(event?.at);
      return {
        id: row.id,
        revision: row.revision,
        code: row.code,
        seats: row.seats,
        humans: row.humans,
        hasGame: !!row.hasGame,
        paused,
        phase,
        turn: typeof event?.turn === 'number' ? event.turn : null,
        lastActivity: touched === null ? eventAt : eventAt === null ? touched : Math.max(touched, eventAt),
        status: row.hasGame
          ? phase === 'finished'
            ? 'finished'
            : paused
              ? 'paused'
              : 'live'
          : row.humans > 0
            ? 'lobby'
            : 'empty',
      };
    })
    .sort((a, b) => (b.lastActivity ?? -1) - (a.lastActivity ?? -1) || a.id.localeCompare(b.id));
}

export function countStatuses(rooms: IndexedRoom[]): Record<RoomStatus, number> {
  const counts = Object.fromEntries(ROOM_STATUSES.map((status) => [status, 0])) as Record<RoomStatus, number>;
  for (const room of rooms) counts[room.status]++;
  return counts;
}

type SeatRow = {
  id: string;
  name: string;
  bot: number;
  bot_level: string | null;
  departed: number;
  user_id: string | null;
  account_type: string | null;
  color: string | null;
  ready: number;
};

function seatRows(store: Store, roomId: string): SeatRow[] {
  return store.db
    .prepare(
      'SELECT id, name, bot, bot_level, departed, user_id, account_type, color, ready FROM seats WHERE room_id = ? ORDER BY rowid',
    )
    .all(roomId) as SeatRow[];
}

/** Opens a room's game, turning an unreadable save into a visible error rather than a failed page. */
function openGame(store: Store, roomId: string): { game?: Game; error?: string } {
  try {
    const game = store.loadGame(roomId);
    return game ? { game } : {};
  } catch (error) {
    return { error: error instanceof ProtocolError ? error.code : 'UNREADABLE' };
  }
}

type Live = { connected: ReadonlySet<string>; standIns: ReadonlySet<string> };

function summarize(id: string, seat: SeatRow | undefined, game: Game | undefined, live: Live): SeatSummary {
  const player = game?.players.find((candidate) => candidate.id === id);
  return {
    id,
    name: seat?.name ?? player?.name ?? 'Unknown seat',
    bot: !!seat?.bot,
    botLevel: seat?.bot ? (seat.bot_level ?? 'steady') : null,
    connected: !!seat?.bot || live.connected.has(id),
    standIn: live.standIns.has(id),
    resigned: !!player?.resigned,
    departed: !!seat?.departed,
    userId: seat?.user_id ?? null,
    accountType: seat?.account_type ?? null,
  };
}

/** A started game's players in turn order; a lobby's seats still in it. */
function tableSeats(seats: SeatRow[], game: Game | undefined, live: Live): SeatSummary[] {
  const ids = game
    ? game.players.map((player) => player.id)
    : seats.filter((s) => !s.departed).map((s) => s.id);
  return ids.map((id) =>
    summarize(
      id,
      seats.find((seat) => seat.id === id),
      game,
      live,
    ),
  );
}

function firstEventAt(store: Store, roomId: string): number | null {
  const row = store.db
    .prepare(
      "SELECT json_extract(public_entry, '$.at') AS at FROM game_events WHERE room_id = ? ORDER BY revision LIMIT 1",
    )
    .get(roomId) as { at: string | null } | undefined;
  return time(row?.at);
}

function roomsNamed(store: Store, q: string): Set<string> {
  const escaped = q.replace(/[\\%_]/g, (c) => '\\' + c);
  return new Set(
    store.db
      .prepare("SELECT DISTINCT room_id FROM seats WHERE name LIKE ? ESCAPE '\\' LIMIT 500")
      .all(`%${escaped}%`)
      .map((row) => row.room_id as string),
  );
}

function liveState(context: AdminContext, roomId?: string): Live {
  const standIns = roomId
    ? context.store.standInIds(roomId)
    : context.store.db
        .prepare('SELECT player_id FROM seat_standins')
        .all()
        .map((row) => row.player_id as string);
  return { connected: new Set(context.runtime.sockets().seats), standIns: new Set(standIns) };
}

export function listGames(context: AdminContext, query: URLSearchParams): GamesPage {
  const status = query.get('status') ?? 'all';
  if (status !== 'all' && !ROOM_STATUSES.includes(status as RoomStatus))
    throw new AdminRequestError(400, 'INVALID_STATUS');
  const q = (query.get('q') ?? '').trim().slice(0, 64);
  const page = Number(query.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new AdminRequestError(400, 'INVALID_PAGE');
  const { store } = context;
  let rooms = indexRooms(store, context.now());
  if (q) {
    const reference = normalizeRoomReference(q);
    const named = roomsNamed(store, q);
    const idPrefix = /^[0-9a-f-]{4,36}$/i.test(q) ? q.toLowerCase() : null;
    rooms = rooms.filter(
      (room) =>
        (isShortRoomCode(reference) && room.code === reference) ||
        (idPrefix !== null && room.id.startsWith(idPrefix)) ||
        named.has(room.id),
    );
  }
  const counts = countStatuses(rooms);
  const filtered = status === 'all' ? rooms : rooms.filter((room) => room.status === status);
  const live = liveState(context);
  const items: GameListItem[] = filtered
    .slice((page - 1) * GAMES_PAGE_SIZE, page * GAMES_PAGE_SIZE)
    .map((room) => {
      const { game, error } = room.hasGame ? openGame(store, room.id) : {};
      return {
        roomId: room.id,
        roomCode: room.code,
        status: room.status,
        phase: game?.phase ?? room.phase,
        turn: game?.turn ?? room.turn,
        revision: room.revision,
        createdAt: firstEventAt(store, room.id),
        lastActivity: room.lastActivity,
        players: tableSeats(seatRows(store, room.id), game, live),
        ...(error ? { error } : {}),
      };
    });
  return { items, total: filtered.length, page, pageSize: GAMES_PAGE_SIZE, counts };
}

/** A room code or room id as typed, always resolved to the permanent id. */
export function resolveRoom(store: Store, reference: string): string {
  const normalized = normalizeRoomReference(reference);
  if (!isRoomReference(normalized)) throw new AdminRequestError(404, 'ROOM_NOT_FOUND', 'Room not found');
  return store.resolveRoom(normalized);
}

export function gameDetail(context: AdminContext, reference: string): GameDetail {
  const { store } = context;
  const roomId = resolveRoom(store, reference);
  const [room] = indexRooms(store, context.now(), roomId);
  if (!room) throw new AdminRequestError(404, 'ROOM_NOT_FOUND', 'Room not found');
  const { game, error } = room.hasGame ? openGame(store, roomId) : {};
  const standIns = store.db
    .prepare(
      'SELECT player_id AS playerId, since, level, style IS NOT NULL AS styled FROM seat_standins WHERE room_id = ?',
    )
    .all(roomId) as { playerId: string; since: number; level: string; styled: number }[];
  const live = liveState(context, roomId);
  const seats = seatRows(store, roomId);
  const table = tableSeats(seats, game, live);
  // Seats that left before this game started still belong in the record, after the table.
  const others = seats
    .filter((seat) => !table.some((listed) => listed.id === seat.id))
    .map((seat) => summarize(seat.id, seat, undefined, live));
  let snapshot: RoomState | null = null;
  if (!error) {
    try {
      // Exactly what a spectator is sent: the public board, players and filtered game.
      const state = store.snapshot(roomId, '@spectator') as unknown as RoomState;
      snapshot = {
        ...state,
        spectating: true,
        players: state.players.map((player) => ({
          ...player,
          connected: !!player.bot || live.connected.has(player.id),
        })),
      };
    } catch {
      snapshot = null;
    }
  }
  let statistics: GameDetail['statistics'] = null;
  try {
    const value = store.statistics(roomId);
    statistics = { rolls: value.rolls, diceCounts: value.diceCounts };
  } catch {
    statistics = null;
  }
  const code = store.roomCode(roomId) ?? null;
  const rounds = store.db
    .prepare(
      `SELECT room_id AS archiveId, started_at AS startedAt, finished_at AS finishedAt, turns, winner, players
       FROM archived_matches WHERE source_room_id = ? ORDER BY sort_at DESC LIMIT 20`,
    )
    .all(roomId) as {
    archiveId: string;
    startedAt: number | null;
    finishedAt: number | null;
    turns: number;
    winner: string | null;
    players: string;
  }[];
  const settings = store.db.prepare('SELECT settings FROM room_settings WHERE room_id = ?').get(roomId) as
    { settings: string } | undefined;
  return {
    roomId,
    roomCode: code,
    status: room.status,
    revision: room.revision,
    round: store.round(roomId),
    createdAt: firstEventAt(store, roomId),
    lastActivity: room.lastActivity,
    snapshot,
    seats: [...table, ...others].map((seat) => {
      const row = seats.find((candidate) => candidate.id === seat.id);
      return { ...seat, color: row?.color ?? null, ready: !!row?.ready };
    }),
    standIns: standIns.map((row) => ({ ...row, styled: !!row.styled })),
    presence: {
      paused: room.paused,
      absent: (snapshot?.players ?? []).flatMap((player) =>
        player.disconnectedAt !== undefined && player.resignAt !== undefined
          ? [{ playerId: player.id, disconnectedAt: player.disconnectedAt, resignAt: player.resignAt }]
          : [],
      ),
    },
    clock: store.clock(roomId) ?? null,
    statistics,
    history: store.history(roomId),
    rounds: rounds.map((round) => {
      const players = JSON.parse(round.players) as { id: string; name: string }[];
      return {
        archiveId: round.archiveId,
        startedAt: round.startedAt,
        finishedAt: round.finishedAt,
        turns: round.turns,
        winner: players.find((player) => player.id === round.winner)?.name ?? null,
      };
    }),
    settings: settings ? (JSON.parse(settings.settings) as Record<string, unknown>) : null,
    integrityError: error ?? null,
    canEnd: !!game && game.phase !== 'finished',
    confirmation: code ?? roomId,
  };
}

export function gameHistory(context: AdminContext, reference: string, query: URLSearchParams) {
  const roomId = resolveRoom(context.store, reference);
  const before = query.get('before');
  if (before !== null && !/^\d{1,12}$/.test(before)) throw new AdminRequestError(400, 'INVALID_CURSOR');
  return context.store.history(roomId, before === null ? undefined : Number(before));
}

/** Hands, deck and dice deck. The view is written to the audit log before anything is returned. */
export function privateGame(context: AdminContext, reference: string, request: ApiRequest): PrivateGameState {
  const { store } = context;
  const roomId = resolveRoom(store, reference);
  const game = store.loadGame(roomId);
  if (!game) throw new AdminRequestError(404, 'NO_GAME', 'This room has no game');
  const revision = store.db.prepare('SELECT revision FROM rooms WHERE id = ?').get(roomId)!
    .revision as number;
  request.audit({
    action: 'game.view_private',
    target: roomId,
    detail: { roomCode: store.roomCode(roomId) ?? null, revision, phase: game.phase, turn: game.turn },
  });
  return { roomId, revision, game };
}

/**
 * Close a stuck or abandoned game with no winner. The typed confirmation must
 * match the room's code (or its id, once the code has lapsed), checked here
 * whatever the page did. The change and its audit row commit together; then
 * everyone still connected to the room is sent the finished game.
 */
export function endGame(context: AdminContext, reference: string, request: ApiRequest) {
  const { store, runtime } = context;
  const roomId = resolveRoom(store, reference);
  if (Object.keys(request.body).some((key) => key !== 'confirm'))
    throw new AdminRequestError(400, 'INVALID_BODY', 'Only a confirmation is accepted');
  const confirmation = store.roomCode(roomId) ?? roomId;
  const typed = typeof request.body.confirm === 'string' ? request.body.confirm.trim() : '';
  if (normalizeRoomReference(typed) !== normalizeRoomReference(confirmation))
    throw new AdminRequestError(400, 'CONFIRMATION_MISMATCH', `Type ${confirmation} to confirm`);
  const result = store.adminEndGame(
    roomId,
    `admin-end-${request.requestId}`,
    ({ revision, previous, game }) =>
      request.audit({
        action: 'game.end',
        target: roomId,
        detail: {
          roomCode: confirmation === roomId ? null : confirmation,
          revision,
          previousPhase: previous.phase,
          turn: game.turn,
          players: game.players.map((player) => player.name),
        },
      }),
  );
  runtime.broadcast(roomId);
  return { roomId, revision: result.revision, status: 'finished' as const };
}
