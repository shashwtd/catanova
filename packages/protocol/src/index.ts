export const PROTOCOL_VERSION = 1;
export type Session = { token: string; name: string; roomId?: string; joined?: boolean };
export type RoomState = {
  roomId: string;
  revision: number;
  counter: number;
  players: { id: string; name: string; connected: boolean }[];
};
export type ClientMessage =
  | { type: 'create' | 'join' | 'resume'; version: number; token: string; name: string; roomId?: string }
  | { type: 'increment'; commandId: string; expectedRevision: number }
  | { type: 'ping'; nonce: string };
export type ServerMessage =
  | { type: 'welcome'; playerId: string; state: RoomState; version: number }
  | { type: 'state'; state: RoomState }
  | { type: 'ack'; commandId: string; revision: number; counter: number; duplicate: boolean }
  | { type: 'pong'; nonce: string }
  | { type: 'error'; code: string; message: string; commandId?: string };

/** Bounds and a strict operation whitelist keep untrusted messages out of the store. */
export function parseClientMessage(input: string): ClientMessage {
  const m: unknown = JSON.parse(input);
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Expected an object');
  const v = m as Record<string, unknown>;
  if (v.type === 'create' || v.type === 'join' || v.type === 'resume') {
    if (v.version !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
    if (typeof v.token !== 'string' || !/^[a-f0-9]{64}$/.test(v.token)) throw new Error('Invalid seat token');
    if (typeof v.name !== 'string' || v.name.trim().length < 1 || v.name.trim().length > 32) throw new Error('Name must contain 1–32 characters');
    if (v.type !== 'create' && (typeof v.roomId !== 'string' || !/^[A-Z2-9]{8}$/.test(v.roomId))) throw new Error('Invalid room code');
    return { type: v.type, version: v.version, token: v.token, name: v.name.trim(), ...(typeof v.roomId === 'string' ? { roomId: v.roomId } : {}) };
  }
  if (v.type === 'increment') {
    if (typeof v.commandId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(v.commandId)) throw new Error('Invalid command ID');
    if (!Number.isSafeInteger(v.expectedRevision) || (v.expectedRevision as number) < 0) throw new Error('Invalid revision');
    return { type: 'increment', commandId: v.commandId, expectedRevision: v.expectedRevision as number };
  }
  if (v.type === 'ping' && typeof v.nonce === 'string' && v.nonce.length <= 80) return { type: 'ping', nonce: v.nonce };
  throw new Error('Unknown or invalid operation');
}
