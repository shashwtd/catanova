import type {
  Account,
  PublicAccount,
  Profile,
  UsernameAvailability,
} from '../../../packages/protocol/src/profile.js';
import type { FriendPresenceState, PlayerGames } from '../../../packages/protocol/src/player-hub.js';
import type { RoomInvite, RoomInvitesState } from '../../../packages/protocol/src/room-invites.js';

export class AccountApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function accountRequest<T>(
  token: string | undefined,
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!token) throw new AccountApiError('AUTH_REQUIRED', 'Please sign in again');
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    });
  } catch {
    throw new AccountApiError('ACCOUNT_UNAVAILABLE', 'Could not reach your account. Try again.');
  }
  const value = await response.json().catch(() => null);
  if (!response.ok)
    throw new AccountApiError(
      value?.code ?? 'ACCOUNT_UNAVAILABLE',
      value?.error ?? 'Your account is unavailable. Try again.',
    );
  if (!value) throw new AccountApiError('ACCOUNT_UNAVAILABLE', 'Your account is unavailable. Try again.');
  return value as T;
}
export const accountApi = {
  roomInvites: (token: string | undefined, signal?: AbortSignal) =>
    accountRequest<RoomInvitesState>(token, '/api/account/room-invites', 'GET', undefined, signal),
  sendRoomInvite: (token: string | undefined, roomId: string, other: string, signal?: AbortSignal) =>
    accountRequest<RoomInvite>(token, '/api/account/room-invites', 'POST', { roomId, other }, signal),
  dismissRoomInvite: (token: string | undefined, id: string, signal?: AbortSignal) =>
    accountRequest<{ dismissed: true }>(token, '/api/account/room-invites', 'DELETE', { id }, signal),
  get: (token: string | undefined) => accountRequest<Account>(token, '/api/account'),
  touch: (token: string | undefined) => accountRequest<Account>(token, '/api/account/activity', 'POST'),
  presence: (token: string | undefined, signal?: AbortSignal) =>
    accountRequest<{ online: true }>(token, '/api/account/presence', 'POST', undefined, signal),
  games: (token: string | undefined, cursor?: string, signal?: AbortSignal) =>
    accountRequest<PlayerGames>(
      token,
      `/api/account/games${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      undefined,
      signal,
    ),
  save: (token: string | undefined, profile: Profile) =>
    accountRequest<Account>(token, '/api/account/profile', 'PUT', profile),
  username: (token: string | undefined, name: string) =>
    accountRequest<UsernameAvailability>(token, `/api/account/username?name=${encodeURIComponent(name)}`),
  friends: (token: string | undefined, signal?: AbortSignal) =>
    accountRequest<FriendPresenceState>(token, '/api/friends', 'GET', undefined, signal),
  search: (token: string | undefined, query: string) =>
    accountRequest<PublicAccount[]>(token, `/api/friends/search?q=${encodeURIComponent(query)}`),
  friendAction: (
    token: string | undefined,
    action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove',
    other: string,
    signal?: AbortSignal,
  ) => accountRequest<FriendPresenceState>(token, '/api/friends', 'POST', { action, other }, signal),
};
