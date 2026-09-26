import type { MatchResults } from './results.js';
import { isRoomReference, normalizeRoomReference } from './room-reference.js';
export {
  isRoomReference,
  normalizeRoomReference,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
} from './room-reference.js';
import { parseProfile } from './profile.js';
import type { Profile } from './profile.js';
import { parseRoomSettings } from './settings.js';
import type { RoomSettings, TurnClock } from './settings.js';
import { isReaction } from './reactions.js';
import type { ReactionName } from './reactions.js';
import type { BotLevel } from './bots.js';
import { isPlayerColor } from './colors.js';
import type { PlayerColor } from './colors.js';
import type { FriendPresenceChange } from './player-hub.js';
export { REACTIONS, REACTION_LIST, isReaction } from './reactions.js';
export type { ReactionName } from './reactions.js';
export { BOT_LEVELS, BOT_LEVEL_LABEL, BOT_NAMES, botName, isBotLevel, randomBotLevel } from './bots.js';
export type { BotLevel } from './bots.js';
export { roomHostId } from './room-host.js';
export {
  PLAYER_COLORS,
  PLAYER_COLOR_LIST,
  PLAYER_COLOR_LABEL,
  DEFAULT_SEAT_COLORS,
  availableColors,
  isPlayerColor,
  seatColors,
} from './colors.js';
export type { PlayerColor } from './colors.js';
import { parseGameAction } from '../../rules/src/game.js';
import { isRulesetId } from '../../rules/src/rulesets.js';
import type { GameAction, GameView } from '../../rules/src/game.js';
import type { Board } from '../../rules/src/board.js';
export const PROTOCOL_VERSION = 1;
export type Session = {
  token: string;
  name: string;
  roomId?: string;
  joined?: boolean;
  profile?: Profile;
  spectating?: boolean;
};
export type HistoryEntry = {
  revision: number;
  actor: string | null;
  kind: string;
  turn: number;
  at: string;
  lines: string[];
  automatic?: boolean;
};
export type GameStatistics = {
  round: number;
  revision: number;
  diceCounts: number[];
  rolls: number;
};
export type RoomPlayer = {
  id: string;
  name: string;
  connected: boolean;
  /** A seat played by the server's own decision agent rather than a person. */
  bot?: boolean;
  botLevel?: string;
  profile?: Profile;
  /** What this seat asked to be. Absent means "whatever is free". */
  color?: PlayerColor;
  /** A bot is playing this seat while its player is away. They keep their
   *  pieces, their hand and their points; only the turns are being covered. */
  standIn?: true;
  ready?: boolean;
  disconnectedAt?: number;
  resignAt?: number;
  /** The seat's account when it is signed in with Google, so the people at the
   *  table, or watching it, can send a friend request. Absent for guests, bots
   *  and players without an account, and never in an invite preview. */
  accountId?: string;
};
export type RoomState = {
  previousResults?: MatchResults;
  spectating?: boolean;
  roomId: string;
  roomCode?: string;
  revision: number;
  counter: number;
  game?: GameView;
  board?: Board;
  players: RoomPlayer[];
  historyRevision?: number;
  round?: number;
  settings?: RoomSettings;
  /**
   * The modes the host may pick, as ruleset ids, Classic first. Sent to the host alone, and only when there is
   * more than Classic to pick: absent, the host may pick Classic only.
   */
  modes?: string[];
  turnClock?: TurnClock;
  serverNow?: number;
  paused?: boolean;
  launch?: { id: string; startedAt: number; deadlineAt: number; readyPlayers: string[] };
};
export type RoomPreview = {
  canResume?: boolean;
  roomId: string;
  roomCode?: string;
  board: Board;
  players: Omit<RoomPlayer, 'connected' | 'accountId'>[];
  started: boolean;
  settings?: RoomSettings;
};
export type ClientMessage =
  | {
      type: 'create' | 'join' | 'resume' | 'spectate';
      version: number;
      token: string;
      name: string;
      roomId?: string;
      accessToken?: string;
      preloadGame?: boolean;
      /**
       * The rulesets this tab can draw, by id, like `preloadGame` a capability rather than a new protocol
       * version. A tab from before modes sends none and can draw Classic only; the server keeps it out of any
       * other mode's room (CLIENT_UPDATE_REQUIRED).
       */
      rulesets?: string[];
      profile?: Profile;
    }
  | { type: 'increment'; commandId: string; expectedRevision: number }
  | { type: 'leave'; commandId: string; expectedRevision: number }
  | { type: 'action'; commandId: string; expectedRevision: number; action: GameAction }
  | {
      type: 'lobby';
      commandId: string;
      expectedRevision: number;
      ready: boolean;
      profile?: Profile;
      kickPlayerId?: string;
      /** Ask for a bot. The server draws which one; the client never picks. */
      addBot?: true;
      /** Ask to play in this colour. Refused if somebody else already holds it. */
      color?: PlayerColor;
    }
  | { type: 'settings'; commandId: string; expectedRevision: number; settings: RoomSettings }
  | { type: 'launchReady'; id: string; success: boolean }
  | { type: 'react'; reaction: ReactionName }
  | { type: 'sync' }
  | { type: 'history'; before?: number }
  | { type: 'statistics' }
  | { type: 'ping'; nonce: string }
  /** A fresh sign-in token for the socket already open, so it need not reconnect every hour. */
  | { type: 'auth'; accessToken: string }
  /** Open a presence socket: a signed-in tab outside any room, so friends see it online. */
  | { type: 'presence'; version: number; accessToken: string };
export type ServerMessage =
  | { type: 'welcome'; playerId: string; state: RoomState; version: number }
  | { type: 'state'; state: RoomState }
  | {
      type: 'ack';
      commandId: string;
      revision: number;
      counter: number;
      duplicate: boolean;
      released?: boolean;
    }
  | { type: 'history'; entries: HistoryEntry[]; before?: number; hasMore: boolean }
  | { type: 'statistics'; statistics: GameStatistics }
  | { type: 'pong'; nonce: string; revision?: number; serverNow?: number }
  | { type: 'reaction'; playerId: string; name: string; reaction: ReactionName; at: number }
  | { type: 'error'; code: string; message: string; commandId?: string }
  /** Whether a refreshed token was accepted; if not, the client simply offers it again later. */
  | { type: 'auth'; ok: boolean; expiresAt?: number }
  /** A presence socket was accepted. */
  | { type: 'presence'; ok: true }
  /** A friend came online, went offline or changed where they can be watched. */
  | { type: 'friend'; friend: FriendPresenceChange };

/**
 * The rulesets a tab says it can draw, as ids. Never a reason to refuse a handshake: a client from a later
 * release must still reconnect after a rollback, whatever it lists. Anything that is not a ruleset id, and any
 * repeat, is dropped, and at most 32 are kept; a value that is not a list is ignored altogether.
 */
const drawableRulesets = (value: unknown[]) => [...new Set(value.filter(isRulesetId))].slice(0, 32);

/** Bounds and a strict operation whitelist keep untrusted messages out of the store. */
export function parseClientMessage(input: string): ClientMessage {
  const m: unknown = JSON.parse(input);
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Expected an object');
  const v = m as Record<string, unknown>;
  if (v.type === 'create' || v.type === 'join' || v.type === 'resume' || v.type === 'spectate') {
    if (v.version !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
    if (typeof v.token !== 'string' || !/^[a-f0-9]{64}$/.test(v.token)) throw new Error('Invalid seat token');
    if (typeof v.name !== 'string' || v.name.trim().length < 1 || v.name.trim().length > 32)
      throw new Error('Name must contain 1–32 characters');
    const roomId = typeof v.roomId === 'string' ? normalizeRoomReference(v.roomId) : undefined;
    if ((v.type !== 'create' || v.roomId !== undefined) && !isRoomReference(roomId))
      throw new Error('Invalid room code');
    if (v.accessToken !== undefined && (typeof v.accessToken !== 'string' || v.accessToken.length > 16000))
      throw new Error('Invalid authentication');
    return {
      type: v.type,
      version: v.version,
      token: v.token,
      name: v.name.trim(),
      ...(roomId ? { roomId } : {}),
      ...(typeof v.accessToken === 'string' ? { accessToken: v.accessToken } : {}),
      ...(v.profile === undefined ? {} : { profile: parseProfile(v.profile) }),
      ...(v.preloadGame === true ? { preloadGame: true } : {}),
      ...(Array.isArray(v.rulesets) ? { rulesets: drawableRulesets(v.rulesets) } : {}),
    };
  }
  if (
    v.type === 'increment' ||
    v.type === 'action' ||
    v.type === 'leave' ||
    v.type === 'lobby' ||
    v.type === 'settings'
  ) {
    if (typeof v.commandId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(v.commandId))
      throw new Error('Invalid command ID');
    if (!Number.isSafeInteger(v.expectedRevision) || (v.expectedRevision as number) < 0)
      throw new Error('Invalid revision');
    const base = { commandId: v.commandId, expectedRevision: v.expectedRevision as number };
    if (v.type === 'settings') return { type: 'settings', ...base, settings: parseRoomSettings(v.settings) };
    if (v.type === 'lobby') {
      if (typeof v.ready !== 'boolean') throw new Error('Invalid ready state');
      if (
        v.addBot !== undefined &&
        (v.addBot !== true || v.profile !== undefined || v.kickPlayerId !== undefined)
      )
        throw new Error('Invalid bot request');
      if (
        v.color !== undefined &&
        (!isPlayerColor(v.color) || v.addBot !== undefined || v.kickPlayerId !== undefined)
      )
        throw new Error('Invalid colour');
      if (
        v.kickPlayerId !== undefined &&
        (typeof v.kickPlayerId !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(v.kickPlayerId) ||
          v.profile !== undefined)
      )
        throw new Error('Invalid player removal');
      return {
        type: 'lobby',
        ...base,
        ready: v.ready,
        ...(typeof v.kickPlayerId === 'string' ? { kickPlayerId: v.kickPlayerId } : {}),
        ...(v.addBot === true ? { addBot: true as const } : {}),
        ...(isPlayerColor(v.color) ? { color: v.color } : {}),
        ...(v.profile === undefined ? {} : { profile: parseProfile(v.profile) }),
      };
    }
    return v.type === 'action'
      ? { type: 'action', ...base, action: parseGameAction(v.action) }
      : { type: v.type, ...base };
  }
  // A reaction changes no game state, so it carries no command id and no
  // revision: it is chat, not a move, and a dropped one costs nothing.
  if (v.type === 'react') {
    // Older open tabs may still send faces retired from the picker. Broadcast
    // a supported equivalent rather than breaking their connection or renderer.
    const reaction = v.reaction === 'nervous' ? 'sad' : v.reaction === 'bored' ? 'eyeroll' : v.reaction;
    if (!isReaction(reaction)) throw new Error('Unknown reaction');
    return { type: 'react', reaction };
  }
  if (v.type === 'launchReady') {
    if (typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(v.id) || typeof v.success !== 'boolean')
      throw new Error('Invalid loading response');
    return { type: 'launchReady', id: v.id, success: v.success };
  }
  if (v.type === 'statistics') return { type: 'statistics' };
  if (v.type === 'sync') return { type: 'sync' };
  if (v.type === 'history') {
    if (v.before !== undefined && (!Number.isSafeInteger(v.before) || (v.before as number) < 0))
      throw new Error('Invalid history cursor');
    return { type: 'history', ...(v.before === undefined ? {} : { before: v.before as number }) };
  }
  if (v.type === 'ping' && typeof v.nonce === 'string' && v.nonce.length <= 80)
    return { type: 'ping', nonce: v.nonce };
  if (v.type === 'auth') {
    if (typeof v.accessToken !== 'string' || !v.accessToken || v.accessToken.length > 16000)
      throw new Error('Invalid authentication');
    return { type: 'auth', accessToken: v.accessToken };
  }
  if (v.type === 'presence') {
    if (v.version !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
    if (typeof v.accessToken !== 'string' || !v.accessToken || v.accessToken.length > 16000)
      throw new Error('Invalid authentication');
    return { type: 'presence', version: v.version, accessToken: v.accessToken };
  }
  throw new Error('Unknown or invalid operation');
}
