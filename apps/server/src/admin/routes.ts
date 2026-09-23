/**
 * The admin API. Reads are GET; ending a game, resolving feedback and
 * generating a report are POST and pass the listener's origin and CSRF checks
 * first.
 */
import { AdminRequestError } from './api.js';
import type { AdminContext, ApiRoute } from './api.js';
import type { RuntimeMetrics } from './metrics.js';
import { overview } from './overview.js';
import { ROOM_PARAM, endGame, gameDetail, gameHistory, listGames, privateGame } from './rooms.js';
import { playerDetail, searchPlayers } from './players.js';
import { feedbackRoutes } from './feedback.js';
import { RETENTION_DAYS } from './analysis-runner.js';
import type { Analysis } from './analysis-runner.js';
import type { RoomIndex } from './room-index.js';

function retentionDays(value: unknown): number {
  const days = typeof value === 'string' ? Number(value) : value;
  if (typeof days !== 'number' || !(RETENTION_DAYS as readonly number[]).includes(days))
    throw new AdminRequestError(400, 'INVALID_WINDOW', `Choose ${RETENTION_DAYS.join(', ')} days`);
  return days;
}

export function coreRoutes(
  context: AdminContext,
  metrics: RuntimeMetrics,
  analysis: Analysis,
  rooms: RoomIndex,
): ApiRoute[] {
  const room = (suffix = '') => new RegExp(`^/api/admin/games/${ROOM_PARAM}${suffix}$`);
  return [
    ...feedbackRoutes(context),
    { method: 'GET', path: /^\/api\/admin\/overview$/, handle: () => overview(context, metrics, rooms) },
    { method: 'GET', path: /^\/api\/admin\/games$/, handle: ({ query }) => listGames(context, rooms, query) },
    { method: 'GET', path: room(), handle: ({ params }) => gameDetail(context, params[0]!) },
    {
      method: 'GET',
      path: room('/history'),
      handle: ({ params, query }) => gameHistory(context, params[0]!, query),
    },
    {
      method: 'GET',
      path: room('/private'),
      handle: (request) => privateGame(context, request.params[0]!, request),
    },
    {
      method: 'POST',
      path: room('/end'),
      handle: (request) => endGame(context, rooms, request.params[0]!, request),
    },
    {
      method: 'GET',
      path: /^\/api\/admin\/players$/,
      handle: ({ query }) => searchPlayers(context, rooms, query),
    },
    {
      method: 'GET',
      path: /^\/api\/admin\/players\/([A-Za-z0-9_-]{1,128})$/,
      handle: ({ params }) => playerDetail(context, params[0]!),
    },
    {
      method: 'GET',
      path: /^\/api\/admin\/stats$/,
      handle: ({ query }) => analysis.stats(query.get('refresh') === '1'),
    },
    {
      method: 'GET',
      path: /^\/api\/admin\/reports\/retention$/,
      handle: ({ query }) => {
        const days = retentionDays(query.get('days') ?? '30');
        return { days, report: analysis.cachedRetention(days) };
      },
    },
    {
      // Generating reads every account's play pattern, so it is recorded like a private view.
      method: 'POST',
      path: /^\/api\/admin\/reports\/retention$/,
      handle: async (request) => {
        if (Object.keys(request.body).some((key) => key !== 'days'))
          throw new AdminRequestError(400, 'INVALID_BODY');
        const days = retentionDays(request.body.days);
        request.audit({ action: 'report.retention', target: null, detail: { days } });
        return { days, report: await analysis.retention(days) };
      },
    },
  ];
}
