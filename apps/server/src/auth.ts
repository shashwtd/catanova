import { createClient } from '@supabase/supabase-js';
import { ProtocolError } from './store.js';
export type Identity = { id: string; name: string; expiresAt: number };
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
/** The Auth server validates the token. No browser-provided user ID or decoded claim is trusted alone. */
export function createVerifier(config: AuthConfig): VerifyIdentity {
  const supabase = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  return async (token) => {
    if (!token) throw new ProtocolError('AUTH_REQUIRED', 'Sign in with Google to continue');
    let result;
    try {
      result = await supabase.auth.getUser(token);
    } catch {
      throw new ProtocolError('AUTH_UNAVAILABLE', 'Sign-in service unavailable; try again');
    }
    const user = result.data.user;
    if (result.error || !user) throw new ProtocolError('AUTH_REQUIRED', 'Please sign in again');
    if (
      user.is_anonymous ||
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
    return {
      id: user.id,
      name: String(user.user_metadata.full_name ?? user.user_metadata.name ?? 'Player').slice(0, 32),
      expiresAt: exp * 1000,
    };
  };
}
