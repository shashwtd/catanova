import type { Session } from '../../../packages/protocol/src/index.js';
import { isRoomReference, normalizeRoomReference } from '../../../packages/protocol/src/room-reference.js';

export const validRoomCode = (value: string) => isRoomReference(normalizeRoomReference(value));
export function invitationCode(pathname: string, search: string): string | null {
  const path = /^\/room\/([^/]+)\/?$/.exec(pathname)?.[1];
  const value = path ?? new URLSearchParams(search).get('room');
  if (!value) return null;
  return normalizeRoomReference(value);
}
/** An explicit invite always takes precedence over a seat saved for a different room. */
export function shouldResume(saved: Session | undefined, invite: string | null): boolean {
  return (
    !!saved &&
    /^[a-f0-9]{64}$/.test(saved.token) &&
    (!invite || (!!saved.roomId && normalizeRoomReference(saved.roomId) === normalizeRoomReference(invite)))
  );
}
export const roomPath = (reference: string) => `/room/${normalizeRoomReference(reference)}`;

/** OAuth may return only to a local room route, never a stored external URL. */
export function safeEntryPath(value: string): string {
  const match = /^\/room\/([^/?#]+)\/?(?:\?[^#]*)?$/.exec(value);
  if (!match || !validRoomCode(match[1]!)) return '/';
  return roomPath(match[1]!);
}

/** Permanent invitation IDs belong in links, not in the room-code label. */
export function visibleRoomCode(
  room: { roomId: string; roomCode?: string } | null,
  reference?: string | null,
): string | null {
  const value = room?.roomCode ?? room?.roomId ?? reference;
  return value && value.length <= 8 && validRoomCode(value) ? normalizeRoomReference(value) : null;
}
