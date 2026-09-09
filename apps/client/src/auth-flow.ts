import type { SupabaseClient, Session } from '@supabase/supabase-js';

export const LINK_KEY = 'catanova.auth.link';
type GuestLink = { id: string; access_token: string; refresh_token: string };
export async function beginGoogleSignIn(
  client: SupabaseClient,
  storage: Storage,
  redirectTo: string,
  expiredGuest = false,
) {
  if (expiredGuest) {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    storage.removeItem(LINK_KEY);
  }
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const options = { redirectTo, queryParams: { prompt: 'select_account' } };
  if (data.session?.user.is_anonymous && !expiredGuest) {
    const { user, access_token, refresh_token } = data.session;
    storage.setItem(LINK_KEY, JSON.stringify({ id: user.id, access_token, refresh_token }));
    // Linking keeps the existing auth ID and all account/room ownership.
    const result = await client.auth.linkIdentity({ provider: 'google', options });
    if (result.error) {
      storage.removeItem(LINK_KEY);
      throw result.error;
    }
  } else {
    storage.removeItem(LINK_KEY);
    const result = await client.auth.signInWithOAuth({ provider: 'google', options });
    if (result.error) throw result.error;
  }
}
export async function completeGoogleLink(
  client: SupabaseClient,
  storage: Storage,
  session: Session | null,
  callbackError: boolean,
): Promise<Session | null> {
  const raw = storage.getItem(LINK_KEY);
  if (!raw) return session;
  let pending: GuestLink;
  try {
    pending = JSON.parse(raw) as GuestLink;
  } catch {
    storage.removeItem(LINK_KEY);
    throw new Error('Google linking could not be restored. Please sign in again.');
  }
  if (!pending.id || !pending.access_token || !pending.refresh_token) {
    storage.removeItem(LINK_KEY);
    throw new Error('Google linking could not be restored. Please sign in again.');
  }
  async function restoreGuest(): Promise<never> {
    const restored = await client.auth.setSession({
      access_token: pending.access_token,
      refresh_token: pending.refresh_token,
    });
    storage.removeItem(LINK_KEY);
    if (restored.error || restored.data.session?.user.id !== pending.id) {
      await client.auth.signOut({ scope: 'local' });
      throw new Error(
        'Google linking failed. Your existing guest account was not merged. Please sign in again.',
      );
    }
    throw new Error(
      'Google could not be linked. Your guest account is unchanged. Choose a Google account that is not already linked to another player.',
    );
  }
  if (callbackError || session?.user.id !== pending.id) return restoreGuest();
  // The refreshed JWT drops its old anonymous claim before friend RPCs are enabled.
  const refreshed = await client.auth.refreshSession();
  if (!refreshed.error && refreshed.data.session?.user.id !== pending.id) return restoreGuest();
  storage.removeItem(LINK_KEY);
  if (refreshed.error) throw new Error('Google is linked. Refresh your session to continue.');
  if (refreshed.data.session!.user.is_anonymous)
    throw new Error('Google was not linked. Your guest account is unchanged.');
  return refreshed.data.session;
}
