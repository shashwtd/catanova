import type { Session } from '../../../packages/protocol/src/index.js';
import {
  isRoomReference,
  isShortRoomCode,
  normalizeRoomReference,
} from '../../../packages/protocol/src/room-reference.js';

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
export const PLAYER_HOME_PATH = '/play';
type NavigableRoom = { roomId: string; roomCode?: string };
/** The address bar is short; durable copy/share links still use roomPath(room.roomId). */
export function browserRoomPath(room: NavigableRoom): string {
  return roomPath(room.roomCode && isShortRoomCode(room.roomCode) ? room.roomCode : room.roomId);
}
export function roomNavigationState(room: NavigableRoom) {
  return { catanovaRoom: { id: normalizeRoomReference(room.roomId), path: browserRoomPath(room) } };
}
/** Back/forward and reload retain the permanent identity behind a reusable address-bar alias. */
export function navigationRoomReference(pathname: string, search: string, state: unknown): string | null {
  const invite = invitationCode(pathname, search);
  if (!invite) return null;
  const binding =
    state && typeof state === 'object' ? (state as { catanovaRoom?: unknown }).catanovaRoom : null;
  if (binding && typeof binding === 'object') {
    const { id, path } = binding as { id?: unknown; path?: unknown };
    if (
      typeof id === 'string' &&
      isRoomReference(id) &&
      !isShortRoomCode(id) &&
      path === roomPath(invite) &&
      pathname.replace(/\/$/, '') === path
    )
      return normalizeRoomReference(id);
  }
  return invite;
}
/** Authentication changes the home destination, never the meaning of an explicit invitation. */
export function accountHomePath(auth: { canPlay: boolean; config: { mode: string } | null }): string {
  return auth.canPlay && auth.config?.mode === 'authenticated' ? PLAYER_HOME_PATH : '/';
}
/** Only use a preview resolved from this exact reference for admission; never join a mutable alias later. */
export function previewJoinReference(
  reference: string,
  preview: { roomId: string; roomCode?: string } | null,
): string | null {
  const normalized = normalizeRoomReference(reference);
  if (!preview || !isRoomReference(preview.roomId)) return null;
  if (normalized !== normalizeRoomReference(preview.roomId) && normalized !== preview.roomCode) return null;
  return normalizeRoomReference(preview.roomId);
}

/** Account setup and explicit invitations finish before the ordinary signed-in home. */
export function showPlayerHome(
  auth: { canPlay: boolean; config: { mode: string } | null; account: { registered: boolean } | null },
  invite: string | null,
): boolean {
  return auth.canPlay && auth.config?.mode === 'authenticated' && !!auth.account?.registered && !invite;
}

/** OAuth may return only to the local player home or a room, never a stored external URL. */
export function safeEntryPath(value: string): string {
  if (/^\/play\/?(?:\?[^#]*)?$/.test(value)) return PLAYER_HOME_PATH;
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
