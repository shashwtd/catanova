import type {
  Account,
  FriendsState,
  PublicAccount,
  Profile,
  UsernameAvailability,
} from '../../../packages/protocol/src/profile.js';

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
      signal: AbortSignal.timeout(12000),
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
  get: (token: string | undefined) => accountRequest<Account>(token, '/api/account'),
  touch: (token: string | undefined) => accountRequest<Account>(token, '/api/account/activity', 'POST'),
  save: (token: string | undefined, profile: Profile) =>
    accountRequest<Account>(token, '/api/account/profile', 'PUT', profile),
  username: (token: string | undefined, name: string) =>
    accountRequest<UsernameAvailability>(token, `/api/account/username?name=${encodeURIComponent(name)}`),
  friends: (token: string | undefined) => accountRequest<FriendsState>(token, '/api/friends'),
  search: (token: string | undefined, query: string) =>
    accountRequest<PublicAccount[]>(token, `/api/friends/search?q=${encodeURIComponent(query)}`),
  friendAction: (
    token: string | undefined,
    action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove',
    other: string,
  ) => accountRequest<FriendsState>(token, '/api/friends', 'POST', { action, other }),
};
