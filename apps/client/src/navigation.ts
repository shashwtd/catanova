import type { Session } from '../../../packages/protocol/src/index.js';

export const validRoomCode = (value: string) => /^[A-Z2-9]{8}$/.test(value);
export function invitationCode(pathname: string, search: string): string | null {
  const path = /^\/room\/([^/]+)\/?$/.exec(pathname)?.[1];
  const value = path ?? new URLSearchParams(search).get('room');
  if (!value) return null;
  return value.trim().toUpperCase();
}
/** An explicit invite always takes precedence over a seat saved for a different room. */
export function shouldResume(saved: Session | undefined, invite: string | null): boolean {
  return !!saved && /^[a-f0-9]{64}$/.test(saved.token) && (!invite || saved.roomId === invite);
}
export const roomPath = (code: string) => `/room/${code}`;
