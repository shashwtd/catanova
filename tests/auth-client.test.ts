import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createBrowserAuthClient } from '../apps/client/src/auth-client.js';
import { beginGoogleSignIn, LINK_KEY } from '../apps/client/src/auth-flow.js';

const config = { url: 'https://saved-project.supabase.test', publishableKey: 'sb_publishable_test' };
const storageKey = 'sb-saved-project-auth-token';

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) });
    assert.ok(url.startsWith(`${config.url}/auth/v1/`));
    if (url.endsWith('/logout?scope=local')) return new Response(null, { status: 204 });
    if (url.includes('/user/identities/authorize?'))
      return Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?fixture=link' });
    assert.ok(url.endsWith('/signup') || url.includes('/token?grant_type='), `Unexpected request: ${url}`);
    const permanent = url.endsWith('grant_type=pkce');
    return Response.json({
      access_token: permanent ? 'google-session-token' : 'guest-session-token',
      refresh_token: 'saved-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {},
        is_anonymous: !permanent,
        created_at: '2026-09-10T00:00:00Z',
      },
    });
  };
  const legacy = createClient(config.url, config.publishableKey, {
    auth: {
      storage,
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    global: { fetch },
  });
  return { values, calls, legacy, transport: { storage, fetch } };
}

test('the smaller auth client resumes and refreshes a session saved by supabase-js', async (t) => {
  const f = fixture();
  t.after(() => f.legacy.auth.stopAutoRefresh());
  const signedIn = await f.legacy.auth.signInAnonymously();
  assert.equal(signedIn.error, null);
  const saved = f.values.get(storageKey);
  assert.ok(saved);
  f.calls.length = 0;
  const next = createBrowserAuthClient(config, f.transport);
  t.after(() => next.auth.stopAutoRefresh());
  const resumed = await next.auth.getSession();
  assert.equal(resumed.error, null);
  assert.equal(resumed.data.session?.access_token, signedIn.data.session?.access_token);
  assert.equal(resumed.data.session?.user.id, signedIn.data.user?.id);
  assert.equal(f.values.get(storageKey), saved);
  assert.equal(f.calls.length, 0, 'Restoring a valid session must not require another login request');
  const refreshed = await next.auth.refreshSession();
  assert.equal(refreshed.error, null);
  assert.equal(refreshed.data.session?.user.id, signedIn.data.user?.id);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.url, `${config.url}/auth/v1/token?grant_type=refresh_token`);
  assert.equal(f.calls[0]!.body.refresh_token, 'saved-refresh-token');
  assert.equal(f.calls[0]!.headers.get('apikey'), config.publishableKey);
  assert.equal(f.calls[0]!.headers.get('Authorization'), `Bearer ${config.publishableKey}`);
});

test('real auth client sends only the email identity scope override for both Google entry paths and keeps PKCE', async (t) => {
  for (const guest of [false, true]) {
    const f = fixture();
    t.after(() => f.legacy.auth.stopAutoRefresh());
    const client = createBrowserAuthClient(config, f.transport);
    t.after(() => client.auth.stopAutoRefresh());
    if (guest) await client.auth.signInAnonymously();
    f.calls.length = 0;
    let redirect: URL | undefined;
    const original = client.auth.signInWithOAuth.bind(client.auth);
    client.auth.signInWithOAuth = async (credentials) => {
      const result = await original({
        ...credentials,
        options: { ...credentials.options, skipBrowserRedirect: true },
      });
      if (result.data.url) redirect = new URL(result.data.url);
      return result;
    };
    await beginGoogleSignIn(client, f.transport.storage, 'https://game.test/auth/callback');
    const authorization = guest ? new URL(f.calls[0]!.url) : redirect!;
    assert.ok(authorization);
    assert.equal(authorization.pathname, guest ? '/auth/v1/user/identities/authorize' : '/auth/v1/authorize');
    assert.equal(authorization.searchParams.get('provider'), 'google');
    assert.equal(authorization.searchParams.get('scope'), 'openid email');
    assert.equal(
      authorization.searchParams.get('scopes'),
      null,
      'Additional scopes append to provider defaults',
    );
    assert.equal(authorization.searchParams.get('prompt'), 'select_account');
    assert.equal(authorization.searchParams.get('redirect_to'), 'https://game.test/auth/callback');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 's256');
    assert.ok(authorization.searchParams.get('code_challenge'));
    assert.ok(f.values.get(`${storageKey}-code-verifier`));
    if (guest) {
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0]!.headers.get('Authorization'), 'Bearer guest-session-token');
      assert.equal(
        JSON.parse(f.transport.storage.getItem(LINK_KEY)!).id,
        '00000000-0000-4000-8000-000000000001',
      );
    } else assert.equal(f.calls.length, 0);
  }
});

test('Google PKCE started before an update completes with the smaller auth client', async (t) => {
  const f = fixture();
  t.after(() => f.legacy.auth.stopAutoRefresh());
  const started = await f.legacy.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://game.test/auth/callback', skipBrowserRedirect: true },
  });
  assert.equal(started.error, null);
  const authorization = new URL(started.data.url!);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 's256');
  const verifier = JSON.parse(f.values.get(`${storageKey}-code-verifier`)!);
  assert.ok(verifier);
  const next = createBrowserAuthClient(config, f.transport);
  t.after(() => next.auth.stopAutoRefresh());
  const result = await next.auth.exchangeCodeForSession('returned-google-code');
  assert.equal(result.error, null);
  assert.equal(result.data.session?.user.is_anonymous, false);
  assert.equal(result.data.session?.access_token, 'google-session-token');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.url, `${config.url}/auth/v1/token?grant_type=pkce`);
  assert.equal(f.calls[0]!.body.auth_code, 'returned-google-code');
  assert.equal(f.calls[0]!.body.code_verifier, verifier);
  assert.equal(f.values.get(`${storageKey}-code-verifier`), undefined);
  assert.equal(JSON.parse(f.values.get(storageKey)!).access_token, 'google-session-token');
});

test('guest CAPTCHA still goes directly to Supabase once and saves the session under the existing key', async (t) => {
  const f = fixture();
  t.after(() => f.legacy.auth.stopAutoRefresh());
  const next = createBrowserAuthClient(config, f.transport);
  t.after(() => next.auth.stopAutoRefresh());
  const result = await next.auth.signInAnonymously({ options: { captchaToken: 'single-use-challenge' } });
  assert.equal(result.error, null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.url, `${config.url}/auth/v1/signup`);
  assert.deepEqual(f.calls[0]!.body.gotrue_meta_security, { captcha_token: 'single-use-challenge' });
  assert.equal(result.data.user?.is_anonymous, true);
  assert.equal(JSON.parse(f.values.get(storageKey)!).user.id, result.data.user?.id);
});
