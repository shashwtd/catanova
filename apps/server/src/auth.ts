import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { ProtocolError } from './store.js';
import { AccountService } from './accounts.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
export type Identity = {
  id: string;
  name: string;
  expiresAt: number;
  tokenExpiresAt?: number;
  profile?: Profile;
  isGuest?: boolean;
  guestExpiresAt?: number;
};
export type AuthConfig = { url: string; publishableKey: string };
export type VerifyIdentity = (token: string | undefined) => Promise<Identity>;
export function readAuthConfig(): AuthConfig | undefined {
  const url = process.env.SUPABASE_URL,
    publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url && !publishableKey) {
    if (
      process.env.REQUIRE_AUTH === 'true' ||
      (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_PLAYTEST !== 'true')
    )
      throw new Error('Google authentication requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
    return undefined;
  }
  if (!url || !publishableKey) throw new Error('Both Supabase URL and publishable key are required');
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  )
    throw new Error('Supabase must use HTTPS');
  if (publishableKey.startsWith('sb_secret_'))
    throw new Error('Use a Supabase publishable key, never a secret key');
  // Legacy anon keys are public; service-role JWTs must never reach runtime configuration.
  if (publishableKey.split('.').length === 3) {
    try {
      if (JSON.parse(Buffer.from(publishableKey.split('.')[1]!, 'base64url').toString()).role !== 'anon')
        throw new Error();
    } catch {
      throw new Error('Use a publishable key or legacy anon key');
    }
  }
  return { url: parsed.origin, publishableKey };
}
/**
 * Supabase reports an outage — a network failure, a timeout, a 5xx, rate
 * limiting — as an error in the result rather than by throwing. Those must not
 * read as "this session is invalid": players were being told to sign in again,
 * and their game connection gave up, whenever the sign-in service had a bad
 * minute.
 */
function serviceUnavailable(error: unknown): boolean {
  const e = error as { name?: string; status?: number } | null;
  return (
    !!e &&
    (e.name === 'AuthRetryableFetchError' ||
      e.status === 0 ||
      e.status === 429 ||
      (typeof e.status === 'number' && e.status >= 500))
  );
}
const OUTAGE_MEMORY_LIMIT = 4096;
/** The Auth server validates the token. No browser-provided user ID or decoded claim is trusted alone. */
export function createVerifier(config: AuthConfig): VerifyIdentity {
  const accounts = new AccountService(config);
  const supabase = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  // Identities this server verified recently, by a hash of the exact token.
  // Consulted only when the sign-in service cannot be reached, and only until
  // that token expires: a player whose connection drops during an outage can
  // take their seat back, but nobody new gets in on the strength of it.
  const verified = new Map<string, Identity>();
  const key = (token: string) => createHash('sha256').update(token).digest('hex');
  const remember = (token: string, identity: Identity) => {
    if (verified.size >= OUTAGE_MEMORY_LIMIT) {
      for (const [k, known] of verified) if (known.expiresAt <= Date.now()) verified.delete(k);
      if (verified.size >= OUTAGE_MEMORY_LIMIT) verified.delete(verified.keys().next().value!);
    }
    verified.set(key(token), identity);
  };
  const verifyOnline = async (token: string): Promise<Identity> => {
    let result;
    try {
      result = await supabase.auth.getUser(token);
    } catch {
      throw new ProtocolError('AUTH_UNAVAILABLE', 'Sign-in service unavailable; try again');
    }
    if (result.error && serviceUnavailable(result.error))
      throw new ProtocolError('AUTH_UNAVAILABLE', 'Sign-in service unavailable; try again');
    const user = result.data.user;
    if (result.error || !user) throw new ProtocolError('AUTH_REQUIRED', 'Please sign in again');
    if (
      !user.is_anonymous &&
      !(user.app_metadata.providers ?? [user.app_metadata.provider]).includes('google')
    )
      throw new ProtocolError('AUTH_REQUIRED', 'Use a Google account to sign in');
    let exp: unknown;
    try {
      exp = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).exp;
    } catch {
      throw new ProtocolError('AUTH_REQUIRED', 'Please sign in again');
    }
    if (typeof exp !== 'number' || exp * 1000 <= Date.now())
      throw new ProtocolError('AUTH_REQUIRED', 'Please sign in again');
    const account = await accounts.get(token);
    if (account.id !== user.id)
      throw new ProtocolError('AUTH_MISMATCH', 'Account identity did not match the verified session');
    if (!account.registered || !account.profile)
      throw new ProtocolError('ONBOARDING_REQUIRED', 'Choose your username before playing');
    const guestExpiresAt = account.expiresAt ? Date.parse(account.expiresAt) : undefined;
    if (exp * 1000 <= Date.now()) throw new ProtocolError('AUTH_REQUIRED', 'Please sign in again');
    if (guestExpiresAt !== undefined && guestExpiresAt <= Date.now())
      throw new ProtocolError('GUEST_EXPIRED', 'Your guest profile has expired');
    return {
      id: user.id,
      name: account.profile.name,
      profile: account.profile,
      isGuest: account.isGuest,
      tokenExpiresAt: exp * 1000,
      ...(guestExpiresAt === undefined ? {} : { guestExpiresAt }),
      expiresAt: Math.min(exp * 1000, guestExpiresAt ?? Infinity),
    };
  };
  return async (token) => {
    if (!token) throw new ProtocolError('AUTH_REQUIRED', 'Sign in to continue');
    try {
      const identity = await verifyOnline(token);
      remember(token, identity);
      return identity;
    } catch (error) {
      if (
        error instanceof ProtocolError &&
        ['AUTH_UNAVAILABLE', 'ACCOUNT_UNAVAILABLE'].includes(error.code)
      ) {
        const known = verified.get(key(token));
        if (known && known.expiresAt > Date.now()) return known;
      }
      throw error;
    }
  };
}
