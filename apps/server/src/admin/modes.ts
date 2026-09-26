/**
 * Game modes: who may pick each mode, and which accounts test them (apps/server/src/modes.ts). A change
 * commits with its audit row and applies at once, with no restart: the game reads the switches each time it
 * needs them, and every lobby with someone connected is sent its room again, so a host's mode picker appears
 * or goes while they watch. Games already started keep their mode whatever changes.
 */
import { CLASSIC, findRuleset } from '../../../../packages/rules/src/rulesets.js';
import { MODE_STATES } from '../modes.js';
import type { ModeState } from '../modes.js';
import { AdminRequestError } from './api.js';
import type { AdminContext, ApiRoute } from './api.js';
import { immediate } from './audit.js';
import type { AdminModes } from './types.js';

/** The account's latest name at a seat, or its profile's. Indexed lookups; testers are few. */
function accountName(context: AdminContext, userId: string): string | null {
  const { db } = context.store;
  const seat = db
    .prepare('SELECT name FROM seats WHERE user_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(userId) as { name: string } | undefined;
  if (seat) return seat.name;
  const profile = db
    .prepare("SELECT json_extract(profile, '$.name') AS name FROM profiles WHERE user_id = ?")
    .get(userId) as { name: string | null } | undefined;
  return profile?.name ?? null;
}

/** Whether this server has seen the account, as the player page decides it. */
function known(context: AdminContext, userId: string): boolean {
  const { store } = context;
  return (
    !!store.db.prepare('SELECT 1 FROM seats WHERE user_id = ? LIMIT 1').get(userId) ||
    !!store.db.prepare('SELECT 1 FROM profiles WHERE user_id = ?').get(userId) ||
    store.lastSeen(userId) !== null
  );
}

export function modesReport(context: AdminContext): AdminModes {
  const { modes } = context.store;
  return {
    modes: modes.settings().map((setting) => {
      const rules = findRuleset(setting.id)!;
      return { ...setting, name: rules.name, summary: rules.summary, seats: rules.seats, bots: rules.bots };
    }),
    testers: modes.testers().map((tester) => ({ ...tester, name: accountName(context, tester.userId) })),
    now: context.now(),
  };
}

/**
 * Sends every lobby with someone connected its room again, so a host sees what they may pick now. A game
 * under way is left alone: its mode was fixed when it started. Returns how many rooms were sent.
 */
export function pushLobbies(context: AdminContext): number {
  const seats = context.runtime.sockets().seats;
  if (!seats.length) return 0;
  const rooms = context.store.db
    .prepare(
      `SELECT DISTINCT s.room_id AS roomId FROM seats s
       WHERE s.id IN (SELECT value FROM json_each(?))
         AND NOT EXISTS (SELECT 1 FROM games g WHERE g.room_id = s.room_id)`,
    )
    .all(JSON.stringify(seats))
    .map((row) => row.roomId as string);
  for (const roomId of rooms) context.runtime.broadcast(roomId);
  return rooms.length;
}

/** The change is committed; a lobby that cannot be sent it now hears it on its next update. */
function pushAfterChange(context: AdminContext) {
  try {
    pushLobbies(context);
  } catch (error) {
    console.error('Could not send lobbies the changed game modes:', error);
  }
}

export function modeRoutes(context: AdminContext): ApiRoute[] {
  const { store } = context;
  return [
    { method: 'GET', path: /^\/api\/admin\/modes$/, handle: () => modesReport(context) },
    {
      method: 'POST',
      path: /^\/api\/admin\/modes\/([a-z0-9-]{1,64})$/,
      handle: (request) => {
        const { state } = request.body;
        if (Object.keys(request.body).length !== 1 || !MODE_STATES.includes(state as ModeState))
          throw new AdminRequestError(
            400,
            'INVALID_BODY',
            'Send { "state": "off" }, { "state": "testers" } or { "state": "everyone" }',
          );
        const id = request.params[0]!;
        if (findRuleset(id)?.id !== id)
          throw new AdminRequestError(404, 'MODE_NOT_FOUND', 'This build has no such game mode');
        if (id === CLASSIC.id)
          throw new AdminRequestError(409, 'MODE_ALWAYS_OPEN', 'Classic is always open to everyone');
        // The change and its audit row commit together; setting what the console already set changes nothing.
        const changed = immediate(store.db, () => {
          const current = store.modes.settings().find((setting) => setting.id === id)!;
          if (current.source === 'console' && current.state === state) return false;
          const { from, to } = store.modes.setState(id, state as ModeState, request.actor, context.now());
          request.audit({ action: 'mode.set', target: `mode:${id}`, detail: { from, to } });
          return true;
        });
        if (changed) pushAfterChange(context);
        return modesReport(context);
      },
    },
    {
      method: 'POST',
      path: /^\/api\/admin\/testers\/([A-Za-z0-9_-]{1,128})$/,
      handle: (request) => {
        const { tester } = request.body;
        if (typeof tester !== 'boolean' || Object.keys(request.body).length !== 1)
          throw new AdminRequestError(400, 'INVALID_BODY', 'Send { "tester": true } or { "tester": false }');
        // Account ids are matched whatever their case, as CATANOVA_MODE_TESTERS matches them.
        const userId = request.params[0]!.toLowerCase();
        const changed = immediate(store.db, () => {
          const current = store.modes.tester(userId);
          if (!tester && current?.source === 'environment')
            throw new AdminRequestError(
              409,
              'TESTER_IN_ENVIRONMENT',
              'This account is a tester in production.env, which the console cannot change',
            );
          // Already a tester, from the console or production.env: nothing to add.
          if (tester && current) return false;
          if (tester && !known(context, userId))
            throw new AdminRequestError(404, 'PLAYER_NOT_FOUND', 'No player here has this account id');
          if (!store.modes.setTester(userId, tester, request.actor, context.now())) return false;
          request.audit({
            action: tester ? 'mode.tester_add' : 'mode.tester_remove',
            target: `player:${userId}`,
            detail: { name: accountName(context, userId) },
          });
          return true;
        });
        if (changed) pushAfterChange(context);
        return modesReport(context);
      },
    },
  ];
}
