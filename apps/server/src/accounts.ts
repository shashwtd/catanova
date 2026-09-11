import { ProtocolError } from './store.js';
import type { AuthConfig } from './auth.js';
import { parseProfile, validUsername } from '../../../packages/protocol/src/profile.js';
import type {
  Account,
  FriendsState,
  Profile,
  PublicAccount,
  UsernameAvailability,
} from '../../../packages/protocol/src/profile.js';

const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Please sign in again',
  GUEST_EXPIRED:
    'Your guest profile expired after seven inactive days. Start a new guest profile or sign in with Google.',
  ONBOARDING_REQUIRED: 'Choose your username before playing',
  USERNAME_INVALID: 'Use 3–20 letters, numbers or underscores',
  USERNAME_TAKEN: 'That username is taken. Try another one.',
  AVATAR_INVALID: 'Choose an available avatar',
  GOOGLE_REQUIRED: 'Link Google to use friends',
  FRIEND_INVALID: 'That friend request is no longer available',
  FRIEND_NOT_FOUND: 'That player needs a registered Google account before you can add them',
  FRIEND_LIMIT: 'Friend limit reached. Clear pending requests before adding more people.',
  ACCOUNT_BUSY: 'Another account update is finishing. Please try again.',
  ACCOUNT_RATE_LIMIT: 'Too many account requests. Wait a little before trying again.',
};
export function accountFailure(
  code: string,
  fallback = 'Account service unavailable; try again',
): ProtocolError {
  if (['PGRST202', '42883', '42P01', '3F000'].includes(code))
    return new ProtocolError('ACCOUNT_SETUP_REQUIRED', 'Accounts are not ready yet. Please try again later.');
  if (['PGRST301', 'PGRST302', 'bad_jwt'].includes(code))
    return new ProtocolError('AUTH_REQUIRED', messages.AUTH_REQUIRED!);
  return new ProtocolError(messages[code] ? code : 'ACCOUNT_UNAVAILABLE', messages[code] ?? fallback);
}
function accountProfile(value: unknown): Profile {
  try {
    return parseProfile(value);
  } catch {
    throw accountFailure('INVALID_RESPONSE');
  }
}
export function parseAccount(value: unknown): Account {
  if (!value || typeof value !== 'object') throw accountFailure('INVALID_RESPONSE');
  const a = value as Record<string, unknown>;
  const profile = a.profile === null ? null : accountProfile(a.profile);
  if (
    typeof a.id !== 'string' ||
    !a.id ||
    typeof a.isGuest !== 'boolean' ||
    typeof a.registered !== 'boolean' ||
    (a.username !== null && (typeof a.username !== 'string' || !validUsername(a.username))) ||
    a.registered !== (a.username !== null && profile !== null) ||
    (profile && (profile.name !== a.username || profile.username !== a.username)) ||
    typeof a.lastActiveAt !== 'string' ||
    !Number.isFinite(Date.parse(a.lastActiveAt)) ||
    (a.expiresAt !== null &&
      (typeof a.expiresAt !== 'string' || !Number.isFinite(Date.parse(a.expiresAt)))) ||
    a.isGuest !== (a.expiresAt !== null)
  )
    throw accountFailure('INVALID_RESPONSE');
  return {
    id: a.id,
    username: a.username as string | null,
    isGuest: a.isGuest,
    registered: a.registered,
    profile,
    lastActiveAt: a.lastActiveAt,
    expiresAt: a.expiresAt as string | null,
  };
}
function publicAccount(value: unknown): PublicAccount {
  if (!value || typeof value !== 'object') throw accountFailure('INVALID_RESPONSE');
  const a = value as Record<string, unknown>,
    profile = accountProfile(a.profile);
  if (
    typeof a.id !== 'string' ||
    !a.id ||
    typeof a.username !== 'string' ||
    !validUsername(a.username) ||
    typeof a.isGuest !== 'boolean' ||
    profile.name !== a.username ||
    profile.username !== a.username
  )
    throw accountFailure('INVALID_RESPONSE');
  return { id: a.id, username: a.username, isGuest: a.isGuest, profile };
}
function friendsState(value: unknown): FriendsState {
  if (!value || typeof value !== 'object') throw accountFailure('INVALID_RESPONSE');
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.friends) || !Array.isArray(v.incoming) || !Array.isArray(v.outgoing))
    throw accountFailure('INVALID_RESPONSE');
  return {
    friends: v.friends.map(publicAccount),
    incoming: v.incoming.map(publicAccount),
    outgoing: v.outgoing.map(publicAccount),
  };
}
/** Every call uses the caller's JWT. No service role, privileged client, or local-account fallback. */
export class AccountService {
  constructor(private readonly config: AuthConfig) {}
  private async rpc(name: string, token: string | undefined, args: Record<string, unknown> = {}) {
    if (!token) throw accountFailure('AUTH_REQUIRED');
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: this.config.publishableKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw accountFailure('ACCOUNT_UNAVAILABLE');
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw accountFailure('ACCOUNT_UNAVAILABLE');
    }
    if (!response.ok) {
      const error = value as { code?: string; message?: string };
      const known = Object.keys(messages).find((code) => error.message === code);
      throw accountFailure(
        known ?? error.code ?? (response.status === 401 ? 'AUTH_REQUIRED' : 'ACCOUNT_UNAVAILABLE'),
      );
    }
    return value;
  }
  async get(token: string | undefined) {
    return parseAccount(await this.rpc('catanova_account_get', token));
  }
  async touch(token: string | undefined) {
    return parseAccount(await this.rpc('catanova_account_touch', token));
  }
  async save(token: string | undefined, input: unknown) {
    const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const profile = parseProfile(value);
    return parseAccount(
      await this.rpc('catanova_profile_save', token, {
        p_username: profile.username ?? profile.name,
        p_avatar: profile.avatar,
        // Keep the old hosted RPC signature while always selecting the game avatar.
        p_avatar_source: 'generated',
      }),
    );
  }
  async username(token: string | undefined, username: string): Promise<UsernameAvailability> {
    const value = (await this.rpc('catanova_username_available', token, {
      p_username: username,
    })) as UsernameAvailability;
    if (
      typeof value?.available !== 'boolean' ||
      (value.reason !== undefined && typeof value.reason !== 'string')
    )
      throw accountFailure('INVALID_RESPONSE');
    return { available: value.available, ...(value.reason ? { reason: value.reason } : {}) };
  }
  async friends(token: string | undefined) {
    return friendsState(await this.rpc('catanova_friends', token));
  }
  async search(token: string | undefined, query: string) {
    const value = await this.rpc('catanova_friend_search', token, { p_query: query });
    if (!Array.isArray(value) || value.length > 10) throw accountFailure('INVALID_RESPONSE');
    return value.map(publicAccount);
  }
  async friendAction(token: string | undefined, action: string, other: string) {
    if (
      !['request', 'accept', 'decline', 'cancel', 'remove'].includes(action) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(other)
    )
      throw accountFailure('FRIEND_INVALID');
    return friendsState(
      await this.rpc('catanova_friend_action', token, { p_action: action, p_other: other }),
    );
  }
}
