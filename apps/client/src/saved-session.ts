/** Where supabase-js keeps a session; auth-client.ts configures the auth client with this key. */
export function savedSessionKey(authUrl: string) {
  const base = new URL(authUrl.endsWith('/') ? authUrl : `${authUrl}/`);
  return `sb-${base.hostname.split('.')[0]}-auth-token`;
}
const SESSION_KEY = /^sb-.+-auth-token$/;
function restorable(value: string | null) {
  try {
    return typeof JSON.parse(value ?? 'null')?.refresh_token === 'string';
  } catch {
    return false;
  }
}
/**
 * A browser holding a saved session is about to open its player's hub, so "/" waits
 * for sign-in instead of flashing the public landing. Until the runtime config names
 * the project, a saved session for any project counts; afterwards only its own does.
 */
export function hasSavedSession(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
  config: { auth: { url: string } | null } | null,
) {
  try {
    if (config) return !!config.auth && restorable(storage.getItem(savedSessionKey(config.auth.url)));
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key && SESSION_KEY.test(key) && restorable(storage.getItem(key))) return true;
    }
  } catch {
    // Storage can be unavailable (privacy modes); treat the visitor as signed out.
  }
  return false;
}
