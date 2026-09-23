/**
 * Rooms and games as the admin console sees them.
 *
 * Which rooms exist and what state each is in comes from the room index
 * (room-index.ts), which does its pass over every room off the game's thread.
 * A room's saved game is opened (through `Store.loadGame`, which checks its
 * hash) only for the rooms on the page being shown, never for every room on
 * every refresh. Journal rows are read only through their `phase` column and
 * public entry; their saved states are never opened here.
 */
import type { Store } from '../store.js';
import { ProtocolError, ROOM_CODE_LEASE_MS } from '../store.js';
import type { Game } from '../../../../packages/rules/src/game.js';
import type { RoomState } from '../../../../packages/protocol/src/index.js';
import { isPlayerColor, seatColors } from '../../../../packages/protocol/src/colors.js';
import type { PlayerColor } from '../../../../packages/protocol/src/colors.js';
import { isRoomReference, normalizeRoomReference } from '../../../../packages/protocol/src/room-reference.js';
import { AdminRequestError } from './api.js';
import type { AdminContext, ApiRequest } from './api.js';
import { GAMES_PAGE_SIZE, ROOM_STATUSES, indexRoom } from './room-index.js';
import type { RoomIndex } from './room-index.js';
import type {
  GameDetail,
  GameListItem,
  GamesPage,
  PrivateGameState,
  RoomStatus,
  SeatSummary,
} from './types.js';

/** A room id or room code in a URL path. */
export const ROOM_PARAM = '([A-Za-z0-9-]{4,36})';

const time = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

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

/**
 * Each seat's colour as the table sees it. The game resolves colours over the
 * seats at the table in the order they sat down (a started game's players, a
 * lobby's remaining seats), whatever order the game later plays them in, and a
 * seat that never picked a colour still gets one; this repeats that exactly.
 */
function tableColors(seats: SeatRow[], game: Game | undefined): Map<string, PlayerColor> {
  const table = seats.filter((seat) =>
    game ? game.players.some((player) => player.id === seat.id) : !seat.departed,
  );
  const colors = seatColors(table);
  return new Map(table.map((seat, index) => [seat.id, colors[index]!]));
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

function liveState(context: AdminContext, roomId?: string): Live {
  const standIns = roomId
    ? context.store.standInIds(roomId)
    : context.store.db
        .prepare('SELECT player_id FROM seat_standins')
        .all()
        .map((row) => row.player_id as string);
  return { connected: new Set(context.runtime.sockets().seats), standIns: new Set(standIns) };
}

/**
 * One page of rooms. Which rooms match, their order and the counts come from
 * the room index's latest pass (at most a few seconds old); the rows shown are
 * then read fresh, a few primary-key lookups each.
 */
export async function listGames(
  context: AdminContext,
  index: RoomIndex,
  query: URLSearchParams,
): Promise<GamesPage> {
  const status = query.get('status') ?? 'all';
  if (status !== 'all' && !ROOM_STATUSES.includes(status as RoomStatus))
    throw new AdminRequestError(400, 'INVALID_STATUS');
  const q = (query.get('q') ?? '').trim().slice(0, 64);
  const page = Number(query.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new AdminRequestError(400, 'INVALID_PAGE');
  const found = await index.list(context.now(), { status: status as RoomStatus | 'all', q, page });
  const { store } = context;
  const now = context.now();
  const live = liveState(context);
  const items = found.rooms.map((listed): GameListItem => {
    const room = indexRoom(store.db, now, ROOM_CODE_LEASE_MS, listed.id) ?? listed;
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
  return {
    items,
    total: found.total,
    page,
    pageSize: GAMES_PAGE_SIZE,
    counts: found.counts,
    indexedAt: found.indexedAt,
  };
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
  const room = indexRoom(store.db, context.now(), ROOM_CODE_LEASE_MS, roomId);
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
  const colors = tableColors(seats, game);
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
      return {
        ...seat,
        color: colors.get(seat.id) ?? null,
        colorChosen: colors.has(seat.id) && isPlayerColor(row?.color) && colors.get(seat.id) === row.color,
        ready: !!row?.ready,
      };
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
 * everyone still connected to the room is sent the finished game, and the
 * room index drops its pass so lists show the room as finished.
 */
export function endGame(context: AdminContext, index: RoomIndex, reference: string, request: ApiRequest) {
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
  index.invalidate();
  return { roomId, revision: result.revision, status: 'finished' as const };
}
