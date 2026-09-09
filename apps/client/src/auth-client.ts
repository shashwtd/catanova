import { AuthClient } from '@supabase/auth-js';
import type { GoTrueClientOptions } from '@supabase/auth-js';

export type BrowserAuthClient = { auth: InstanceType<typeof AuthClient> };

/** Use the same auth engine without shipping unused database, storage or realtime clients. */
export function createBrowserAuthClient(
  config: { url: string; publishableKey: string },
  transport: Pick<GoTrueClientOptions, 'storage' | 'fetch'> = {},
): BrowserAuthClient {
  const base = new URL(config.url.endsWith('/') ? config.url : `${config.url}/`);
  return {
    auth: new AuthClient({
      ...transport,
      url: new URL('auth/v1', base).href,
      // Match supabase-js so saved sessions and in-flight Google PKCE verifiers survive an update.
      storageKey: `sb-${base.hostname.split('.')[0]}-auth-token`,
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
      },
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    }),
  };
}
