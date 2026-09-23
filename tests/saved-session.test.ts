import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAuthClient } from '../apps/client/src/auth-client.js';
import { beginGoogleSignIn } from '../apps/client/src/auth-flow.js';
import { hasSavedSession, savedSessionKey } from '../apps/client/src/saved-session.js';

const auth = { url: 'https://saved-project.supabase.test', publishableKey: 'sb_publishable_test' };
function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  };
}
const session = JSON.stringify({ access_token: 'access', refresh_token: 'refresh', user: { id: 'u1' } });

test('"/" waits for sign-in exactly when the auth client has a session saved', async (t) => {
  const storage = memoryStorage();
  const fetch: typeof globalThis.fetch = async (input) =>
    String(input).endsWith('/logout?scope=local')
      ? new Response(null, { status: 204 })
      : Response.json({
          access_token: 'guest-session-token',
          refresh_token: 'saved-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', is_anonymous: true },
        });
  const client = createBrowserAuthClient(auth, { storage, fetch });
  t.after(() => client.auth.stopAutoRefresh());
  assert.equal(hasSavedSession(storage, null), false, 'a first visit gets the landing at once');
  await beginGoogleSignIn(client, storage, 'https://game.test/auth/callback').catch(() => {});
  assert.equal(hasSavedSession(storage, null), false, 'a half-finished Google sign-in is not a session');
  assert.equal((await client.auth.signInAnonymously()).error, null);
  assert.ok(storage.getItem(savedSessionKey(auth.url)), 'the key is the one the auth client writes');
  assert.equal(hasSavedSession(storage, null), true, 'known before /api/config answers');
  assert.equal(hasSavedSession(storage, { auth }), true);
  assert.equal((await client.auth.signOut({ scope: 'local' })).error, null);
  assert.equal(hasSavedSession(storage, null), false, 'signing out restores the instant landing');
  assert.equal(hasSavedSession(storage, { auth }), false);
});

test('only a restorable session for the configured project holds back the landing', () => {
  const other = memoryStorage({ 'sb-other-project-auth-token': session });
  assert.equal(hasSavedSession(other, null), true, 'the project is unknown until the config arrives');
  assert.equal(hasSavedSession(other, { auth }), false, 'another project’s session does not sign anyone in');
  assert.equal(
    hasSavedSession(memoryStorage({ [savedSessionKey(auth.url)]: session }), { auth: null }),
    false,
  );
  for (const value of ['', 'null', '{"access_token":"a"}', '{broken'])
    assert.equal(hasSavedSession(memoryStorage({ [savedSessionKey(auth.url)]: value }), null), false, value);
  const blocked = {
    get length(): number {
      throw new DOMException('Storage is disabled', 'SecurityError');
    },
    key: () => null,
    getItem: () => null,
  };
  assert.equal(hasSavedSession(blocked, null), false);
  assert.equal(savedSessionKey('http://127.0.0.1:54321'), 'sb-127-auth-token');
});
