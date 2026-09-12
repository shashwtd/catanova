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
import { parseGameAction } from '../../rules/src/game.js';
import type { GameAction, GameView } from '../../rules/src/game.js';
import type { Board } from '../../rules/src/board.js';
export const PROTOCOL_VERSION = 1;
export type Session = { token: string; name: string; roomId?: string; joined?: boolean; profile?: Profile };
export type HistoryEntry = {
  revision: number;
  actor: string | null;
  kind: string;
  turn: number;
  at: string;
  lines: string[];
  automatic?: boolean;
};
export type RoomPlayer = {
  id: string;
  name: string;
  connected: boolean;
  profile?: Profile;
  ready?: boolean;
  disconnectedAt?: number;
  resignAt?: number;
};
export type RoomState = {
  roomId: string;
  roomCode?: string;
  revision: number;
  counter: number;
  game?: GameView;
  board?: Board;
  players: RoomPlayer[];
  historyRevision?: number;
  settings?: RoomSettings;
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
  players: Omit<RoomPlayer, 'connected'>[];
  started: boolean;
  settings?: RoomSettings;
};
export type ClientMessage =
  | {
      type: 'create' | 'join' | 'resume';
      version: number;
      token: string;
      name: string;
      roomId?: string;
      accessToken?: string;
      preloadGame?: boolean;
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
    }
  | { type: 'settings'; commandId: string; expectedRevision: number; settings: RoomSettings }
  | { type: 'launchReady'; id: string; success: boolean }
  | { type: 'sync' }
  | { type: 'history'; before?: number }
  | { type: 'ping'; nonce: string };
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
  | { type: 'pong'; nonce: string; revision?: number; serverNow?: number }
  | { type: 'error'; code: string; message: string; commandId?: string };

/** Bounds and a strict operation whitelist keep untrusted messages out of the store. */
export function parseClientMessage(input: string): ClientMessage {
  const m: unknown = JSON.parse(input);
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Expected an object');
  const v = m as Record<string, unknown>;
  if (v.type === 'create' || v.type === 'join' || v.type === 'resume') {
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
        ...(v.profile === undefined ? {} : { profile: parseProfile(v.profile) }),
      };
    }
    return v.type === 'action'
      ? { type: 'action', ...base, action: parseGameAction(v.action) }
      : { type: v.type, ...base };
  }
  if (v.type === 'launchReady') {
    if (typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(v.id) || typeof v.success !== 'boolean')
      throw new Error('Invalid loading response');
    return { type: 'launchReady', id: v.id, success: v.success };
  }
  if (v.type === 'sync') return { type: 'sync' };
  if (v.type === 'history') {
    if (v.before !== undefined && (!Number.isSafeInteger(v.before) || (v.before as number) < 0))
      throw new Error('Invalid history cursor');
    return { type: 'history', ...(v.before === undefined ? {} : { before: v.before as number }) };
  }
  if (v.type === 'ping' && typeof v.nonce === 'string' && v.nonce.length <= 80)
    return { type: 'ping', nonce: v.nonce };
  throw new Error('Unknown or invalid operation');
}
