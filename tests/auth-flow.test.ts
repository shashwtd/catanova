import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { beginGoogleSignIn, completeGoogleLink, LINK_KEY } from '../apps/client/src/auth-flow.js';

function session(id: string, anonymous: boolean): Session {
  return {
    access_token: `access-${id}`,
    refresh_token: `refresh-${id}`,
    user: { id, is_anonymous: anonymous },
  } as Session;
}
function fixture(initial: Session | null) {
  let current = initial;
  const data = new Map<string, string>(),
    calls: { kind: string; args?: unknown }[] = [];
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      linkIdentity: async (args: unknown) => {
        calls.push({ kind: 'link', args });
        return { error: null };
      },
      signInWithOAuth: async (args: unknown) => {
        calls.push({ kind: 'oauth', args });
        return { error: null };
      },
      refreshSession: async () => {
        calls.push({ kind: 'refresh' });
        if (current) current = session(current.user.id, false);
        return { data: { session: current }, error: null };
      },
      setSession: async (args: { access_token: string; refresh_token: string }) => {
        calls.push({ kind: 'restore', args });
        current = session(args.access_token.slice(7), true);
        return { data: { session: current }, error: null };
      },
      signOut: async (args: unknown) => {
        calls.push({ kind: 'signout', args });
        current = null;
        return { error: null };
      },
    },
  } as unknown as SupabaseClient;
  return {
    client,
    storage,
    calls,
    current: () => current,
    set: (next: Session | null) => {
      current = next;
    },
  };
}
test('Google sign-in links a live anonymous identity; permanent sign-in uses OAuth', async () => {
  const guest = fixture(session('guest', true));
  await beginGoogleSignIn(guest.client, guest.storage, 'https://game.test/auth/callback');
  assert.deepEqual(
    guest.calls.map((c) => c.kind),
    ['link'],
  );
  assert.equal(JSON.parse(guest.storage.getItem(LINK_KEY)!).id, 'guest');
  const user = fixture(session('permanent', false));
  user.storage.setItem(
    LINK_KEY,
    JSON.stringify({ id: 'abandoned-guest', access_token: 'old', refresh_token: 'old' }),
  );
  await beginGoogleSignIn(user.client, user.storage, 'https://game.test/auth/callback');
  assert.deepEqual(
    user.calls.map((c) => c.kind),
    ['oauth'],
  );
  assert.equal(user.storage.getItem(LINK_KEY), null);
});
test('an expired guest starts regular Google OAuth without linking the tombstoned identity', async () => {
  const f = fixture(session('expired', true));
  await beginGoogleSignIn(f.client, f.storage, 'https://game.test/auth/callback', true);
  assert.deepEqual(
    f.calls.map((c) => c.kind),
    ['signout', 'oauth'],
  );
  assert.deepEqual(f.calls[0]!.args, { scope: 'local' });
  assert.equal(f.storage.getItem(LINK_KEY), null);
});
test('a successful link keeps the same account ID and refreshes the anonymous JWT', async () => {
  const f = fixture(session('guest', true));
  await beginGoogleSignIn(f.client, f.storage, 'https://game.test/auth/callback');
  f.set(session('guest', false));
  const linked = await completeGoogleLink(f.client, f.storage, f.current(), false);
  assert.equal(linked!.user.id, 'guest');
  assert.equal(linked!.user.is_anonymous, false);
  assert.deepEqual(
    f.calls.map((c) => c.kind),
    ['link', 'refresh'],
  );
  assert.equal(f.storage.getItem(LINK_KEY), null);
});
test('a conflicting Google identity or failed callback restores the same guest without merging', async () => {
  for (const callbackError of [true, false]) {
    const f = fixture(session('guest', true));
    await beginGoogleSignIn(f.client, f.storage, 'https://game.test/auth/callback');
    f.set(session('different-google-owner', false));
    await assert.rejects(
      completeGoogleLink(f.client, f.storage, f.current(), callbackError),
      /guest account is unchanged/,
    );
    assert.equal(f.current()!.user.id, 'guest');
    assert.equal(f.storage.getItem(LINK_KEY), null);
    assert.deepEqual(
      f.calls.map((c) => c.kind),
      ['link', 'restore'],
    );
  }
});
test('link failure does not leave backup credentials around; failed restore signs out locally', async () => {
  const f = fixture(session('guest', true));
  f.client.auth.linkIdentity = async () =>
    ({ data: { provider: 'google', url: '' }, error: new Error('Manual linking is disabled') }) as never;
  await assert.rejects(
    beginGoogleSignIn(f.client, f.storage, 'https://game.test/auth/callback'),
    /Manual linking/,
  );
  assert.equal(f.storage.getItem(LINK_KEY), null);
  f.storage.setItem(
    LINK_KEY,
    JSON.stringify({ id: 'guest', access_token: 'access-guest', refresh_token: 'refresh-guest' }),
  );
  f.client.auth.setSession = async () =>
    ({ data: { session: null, user: null }, error: new Error('Session expired') }) as never;
  await assert.rejects(completeGoogleLink(f.client, f.storage, null, true), /not merged/);
  assert.equal(f.current(), null);
  assert.equal(f.storage.getItem(LINK_KEY), null);
});

test('link completion refreshes a stale anonymous claim and never adopts another account returned during refresh', async () => {
  const f = fixture(session('guest', true));
  await beginGoogleSignIn(f.client, f.storage, 'https://game.test/auth/callback');
  const linked = await completeGoogleLink(f.client, f.storage, f.current(), false);
  assert.equal(linked!.user.id, 'guest');
  assert.equal(linked!.user.is_anonymous, false);
  const changed = fixture(session('guest', true));
  await beginGoogleSignIn(changed.client, changed.storage, 'https://game.test/auth/callback');
  changed.set(session('guest', false));
  changed.client.auth.refreshSession = async () => {
    changed.set(session('other', false));
    return { data: { session: changed.current(), user: changed.current()!.user }, error: null };
  };
  await assert.rejects(
    completeGoogleLink(changed.client, changed.storage, changed.current(), false),
    /guest account is unchanged/,
  );
  assert.equal(changed.current()!.user.id, 'guest');
  assert.equal(changed.storage.getItem(LINK_KEY), null);
});
