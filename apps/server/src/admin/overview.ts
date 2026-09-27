/**
 * Overview: the page to glance at. Who is online and where, how many are
 * playing, the games being played, games and new players today and this week,
 * how the server is doing now (its history comes from /api/admin/metrics), the
 * host's reports and the newest errors. System has the detail.
 *
 * On the game's thread: who is online (an indexed lookup per person), and the
 * few live games shown (a primary-key read of each). Anything that grows with
 * the database, the room counts and the day's and week's games, comes from
 * the room index's worker, and the page still loads if that is unavailable.
 */
import { ROOM_CODE_LEASE_MS } from '../store.js';
import { score } from '../../../../packages/rules/src/game.js';
import { rulesetOf } from '../../../../packages/rules/src/rulesets.js';
import { AdminRequestError } from './api.js';
import type { AdminContext } from './api.js';
import { serverErrors } from './errors.js';
import type { RuntimeMetrics } from './metrics.js';
import { whoIsOnline } from './online.js';
import { indexRoom } from './room-index.js';
import type { RoomIndex } from './room-index.js';
import { liveState, openGame, roundStartedAt, seatRows, tableSeats } from './rooms.js';
import { hostReports, memoryLimit } from './system.js';
import type { AdminOverview, LiveGame } from './types.js';

/** Games listed on Overview; the Games tab has the rest. */
export const OVERVIEW_LIVE_GAMES = 8;
/** Errors listed on Overview; System has the rest. */
export const OVERVIEW_ERRORS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start of the viewer's day and week, which only the browser knows (it
 * sends its own midnight and Monday). Without them, UTC's. A value outside
 * the last eight days is refused rather than counted.
 */
export function activityWindow(query: URLSearchParams, now: number): { day: number; week: number } {
  const utcDay = Math.floor(now / DAY_MS) * DAY_MS;
  const utcWeek = utcDay - ((new Date(utcDay).getUTCDay() + 6) % 7) * DAY_MS;
  const read = (name: string, fallback: number) => {
    const raw = query.get(name);
    if (raw === null) return fallback;
    if (!/^\d{1,15}$/.test(raw)) throw new AdminRequestError(400, 'INVALID_WINDOW', `Invalid ${name}`);
    const value = Number(raw);
    if (value < now - 8 * DAY_MS || value > now + 60_000)
      throw new AdminRequestError(400, 'INVALID_WINDOW', `${name} must be within the last eight days`);
    return value;
  };
  const day = read('day', utcDay);
  const week = read('week', utcWeek);
  if (week > day) throw new AdminRequestError(400, 'INVALID_WINDOW', 'The week must start before the day');
  return { day, week };
}

export async function overview(
  context: AdminContext,
  metrics: RuntimeMetrics,
  index: RoomIndex,
  query: URLSearchParams,
): Promise<AdminOverview> {
  const { store, runtime, config } = context;
  const now = context.now();
  const { day, week } = activityWindow(query, now);
  const [summary, live, activity] = await Promise.allSettled([
    index.summary(now),
    index.live(now, OVERVIEW_LIVE_GAMES),
    index.activity(now, day, week),
  ]);
  const failed = (result: PromiseRejectedResult) =>
    result.reason instanceof Error ? result.reason.message : 'Unavailable';
  const connections = liveState(context);
  const liveGames: LiveGame[] = [];
  if (live.status === 'fulfilled')
    for (const listed of live.value.rooms) {
      // Read fresh: a game in the pass may have ended since.
      const room = indexRoom(store.db, now, ROOM_CODE_LEASE_MS, listed.id);
      if (!room || (room.status !== 'live' && room.status !== 'paused')) continue;
      const { game } = openGame(store, room.id);
      if (!game || game.phase === 'finished') continue;
      liveGames.push({
        roomId: room.id,
        roomCode: room.code,
        status: room.status,
        turn: game.turn,
        phase: game.phase,
        target: game.victoryPoints ?? rulesetOf(game).victoryPoints.default,
        startedAt: roundStartedAt(store, room.id),
        lastActivity: room.lastActivity,
        dice: game.dice ? [game.dice[0], game.dice[1]] : null,
        players: tableSeats(seatRows(store, room.id), game, connections).map((seat) => {
          const player = game.players.find((candidate) => candidate.id === seat.id)!;
          return { ...seat, points: score(game, player, false) };
        }),
      });
    }
  const sockets = runtime.sockets();
  const memory = process.memoryUsage();
  const { window, windowSeconds } = metrics.snapshot();
  const errors = serverErrors.list();
  return {
    now,
    revision: config.revision,
    uptimeSeconds: Math.round(process.uptime()),
    online: whoIsOnline(store, runtime, now),
    rooms:
      summary.status === 'fulfilled'
        ? {
            live: summary.value.counts.live,
            paused: summary.value.counts.paused,
            lobbies: summary.value.counts.lobby,
            countedAt: summary.value.indexedAt,
          }
        : { error: failed(summary) },
    activity: activity.status === 'fulfilled' ? activity.value : { error: failed(activity) },
    liveGames,
    performance: {
      window,
      windowSeconds,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      memoryLimitBytes: memoryLimit().limit,
      sockets: sockets.total,
    },
    status: await hostReports(config.statusDir),
    errors: { recent: errors.slice(0, OVERVIEW_ERRORS), total: errors.length },
    rejections: context.rejections().length,
  };
}
