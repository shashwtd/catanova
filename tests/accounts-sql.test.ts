import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
];
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const avatarPatch = readFileSync(
  new URL('../supabase/patches/20260911_game_avatars_only.sql', import.meta.url),
  'utf8',
);
async function fixture(t: { after: (run: () => Promise<void>) => void }) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,is_anonymous boolean,created_at timestamptz default now());
    create table auth.identities(user_id uuid references auth.users(id),provider text,identity_data jsonb,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create function auth.jwt() returns jsonb language sql as 'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';`);
  await db.exec(schema);
  for (const [i, id] of ids.entries()) {
    await db.query('insert into auth.users(id,is_anonymous) values($1,$2)', [id, i === 3]);
    if (i !== 3)
      await db.query('insert into auth.identities(user_id,provider,identity_data) values($1,$2,$3)', [
        id,
        'google',
        {
          full_name: 'Private Legal Name',
          picture: 'https://lh3.googleusercontent.com/a/verified',
          avatar_url: 'https://evil.example/spoofed',
        },
      ]);
  }
  return db;
}
async function asUser(
  db: PGlite,
  id: string,
  sql: string,
  values: unknown[] = [],
  anonymous = id === ids[3],
) {
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
    [id, JSON.stringify({ sub: id, is_anonymous: anonymous })],
  );
  await db.exec('set role authenticated');
  try {
    return await db.query<Record<string, any>>(sql, values);
  } finally {
    await db.exec('reset role');
  }
}
async function rpc(
  db: PGlite,
  id: string,
  name: string,
  values: unknown[] = [],
  anonymous = id === ids[3],
): Promise<any> {
  const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
  return (await asUser(db, id, `select public.${name}(${placeholders}) as value`, values, anonymous)).rows[0]!
    .value;
}
async function save(db: PGlite, id: string, name: string, source = 'generated') {
  return rpc(db, id, 'catanova_profile_save', [name, 3, source]);
}

test('fresh schema creates private RLS tables, scoped authenticated RPCs, and no anonymous or cross-account direct access', async (t) => {
  const db = await fixture(t);
  await save(db, ids[0]!, 'Captain');
  await save(db, ids[1]!, 'Builder');
  await assert.rejects(asUser(db, ids[0]!, 'select * from public.catanova_profiles'), /permission denied/);
  await assert.rejects(
    asUser(db, ids[0]!, 'delete from public.catanova_profiles where id=$1', [ids[1]]),
    /permission denied/,
  );
  await assert.rejects(asUser(db, ids[0]!, 'select catanova_private.cleanup_guests()'), /permission denied/);
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.catanova_account_get()'), /permission denied/);
  await db.exec('reset role');
  // Even an accidental future table grant remains protected by RLS's default deny.
  await db.exec(
    'grant select,insert,update,delete on public.catanova_profiles,public.catanova_friendships to authenticated',
  );
  assert.deepEqual((await asUser(db, ids[0]!, 'select * from public.catanova_profiles')).rows, []);
  assert.deepEqual((await asUser(db, ids[0]!, 'select * from public.catanova_friendships')).rows, []);
  await assert.rejects(
    asUser(
      db,
      ids[0]!,
      "insert into public.catanova_profiles(id,is_guest,username) values($1,false,'Stolen')",
      [ids[2]],
    ),
    /row-level security/,
  );
  const result = await asUser(
    db,
    ids[0]!,
    "update public.catanova_profiles set username='Stolen' where id=$1 returning id",
    [ids[1]],
  );
  assert.deepEqual(result.rows, []);
  assert.equal((await rpc(db, ids[1]!, 'catanova_account_get')).username, 'Builder');
});

test('username uniqueness is case-insensitive and atomic, validation is bounded, and availability is only advisory', async (t) => {
  const db = await fixture(t);
  assert.equal((await rpc(db, ids[0]!, 'catanova_account_get')).registered, false);
  assert.deepEqual(await rpc(db, ids[0]!, 'catanova_username_available', ['Captain']), { available: true });
  assert.deepEqual(await rpc(db, ids[1]!, 'catanova_username_available', ['captain']), { available: true });
  const account = await save(db, ids[0]!, ' Captain ');
  assert.equal(account.username, 'Captain');
  assert.equal(account.profile.name, 'Captain');
  await assert.rejects(save(db, ids[1]!, 'cApTaIn'), /USERNAME_TAKEN/);
  assert.equal((await rpc(db, ids[1]!, 'catanova_account_get')).registered, false);
  assert.equal((await rpc(db, ids[1]!, 'catanova_username_available', ['CAPTAIN'])).available, false);
  assert.equal((await rpc(db, ids[0]!, 'catanova_username_available', ['captain'])).available, true);
  for (const name of ['', 'ab', 'space name', 'x'.repeat(21), 'ééé'])
    await assert.rejects(save(db, ids[1]!, name), /USERNAME_INVALID/);
  await save(db, ids[0]!, 'Renamed');
  await save(db, ids[1]!, 'CAPTAIN');
  assert.equal((await rpc(db, ids[0]!, 'catanova_account_get')).username, 'Renamed');
});

test('guest expiry is exactly seven inactive days, cleanup releases the name without reviving an expired identity', async (t) => {
  const db = await fixture(t);
  await save(db, ids[3]!, 'Wanderer');
  await db.query(
    "update public.catanova_profiles set last_active_at=now()-interval '6 days 23 hours' where id=$1",
    [ids[3]],
  );
  const alive = await rpc(db, ids[3]!, 'catanova_account_get');
  assert.equal(alive.isGuest, true);
  assert.equal(Date.parse(alive.expiresAt) - Date.parse(alive.lastActiveAt), 7 * 86400000);
  const touched = await rpc(db, ids[3]!, 'catanova_account_touch');
  assert.ok(Date.parse(touched.lastActiveAt) > Date.parse(alive.lastActiveAt));
  await db.query("update public.catanova_profiles set last_active_at=now()-interval '7 days' where id=$1", [
    ids[3],
  ]);
  await assert.rejects(rpc(db, ids[3]!, 'catanova_account_touch'), /GUEST_EXPIRED/);
  assert.equal((await rpc(db, ids[0]!, 'catanova_username_available', ['wanderer'])).available, true);
  await save(db, ids[0]!, 'Wanderer');
  await assert.rejects(save(db, ids[3]!, 'NewGuestName'), /GUEST_EXPIRED/);
  assert.equal(
    (await db.query<{ n: number }>('select count(*)::int as n from auth.users where id=$1', [ids[3]]))
      .rows[0]!.n,
    1,
    'Auth row intentionally retained; no admin deletion is claimed',
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        'select count(*)::int as n from catanova_private.expired_guests where id=$1',
        [ids[3]],
      )
    ).rows[0]!.n,
    1,
  );
});

test('Google linking preserves chosen identity and uses provider membership without importing names or photos', async (t) => {
  const db = await fixture(t);
  const before = await save(db, ids[3]!, 'Wanderer');
  assert.deepEqual(
    (await save(db, ids[3]!, 'Wanderer', 'google')).profile,
    before.profile,
    'legacy photo selections become the saved game avatar',
  );
  await db.query('update auth.users set is_anonymous=false where id=$1', [ids[3]]);
  await db.query('insert into auth.identities(user_id,provider,identity_data) values($1,$2,$3)', [
    ids[3],
    'google',
    { picture: 'https://lh3.googleusercontent.com/a/linked' },
  ]);
  const linked = await rpc(db, ids[3]!, 'catanova_account_get', [], false);
  assert.equal(linked.id, before.id);
  assert.equal(linked.username, before.username);
  assert.equal(linked.profile.avatar, 3);
  assert.equal(linked.isGuest, false);
  assert.equal(linked.expiresAt, null);
  assert.ok(!('googleAvatarUrl' in linked));
  assert.ok(!('avatarUrl' in linked.profile) && !('avatarSource' in linked.profile));
  await assert.rejects(
    rpc(db, ids[3]!, 'catanova_friends', [], true),
    /GOOGLE_REQUIRED/,
    'an old anonymous JWT cannot use upgraded privileges',
  );
  const canonical = await rpc(db, ids[3]!, 'catanova_profile_save', ['Wanderer', 3, 'google'], false);
  assert.deepEqual(canonical.profile, before.profile);
  await db.query('update auth.identities set identity_data=$1 where user_id=$2', [
    { picture: 'https://evil.example/avatar' },
    ids[3],
  ]);
  assert.deepEqual((await rpc(db, ids[3]!, 'catanova_account_get', [], false)).profile, before.profile);
  await db.exec('alter table auth.identities drop column identity_data');
  assert.deepEqual(
    (await rpc(db, ids[3]!, 'catanova_profile_save', ['Wanderer', 3, 'google'], false)).profile,
    before.profile,
    'no provider photo/name metadata is needed',
  );
});

test('friend RPCs reject guests in either direction and expose only searched public profiles', async (t) => {
  const db = await fixture(t);
  await save(db, ids[0]!, 'Captain');
  await save(db, ids[1]!, 'Carver');
  await save(db, ids[3]!, 'CaperGuest');
  for (const [name, args] of [
    ['catanova_friends', []],
    ['catanova_friend_search', ['Cap']],
    ['catanova_friend_action', ['request', ids[0]]],
    ['catanova_friend_action', ['accept', ids[0]]],
  ] as const)
    await assert.rejects(rpc(db, ids[3]!, name, [...args]), /GOOGLE_REQUIRED/);
  await assert.rejects(rpc(db, ids[0]!, 'catanova_friend_action', ['request', ids[3]]), /FRIEND_NOT_FOUND/);
  const found = await rpc(db, ids[0]!, 'catanova_friend_search', ['Ca']);
  assert.deepEqual(found, []);
  const guests = await rpc(db, ids[0]!, 'catanova_friend_search', ['Cap']);
  assert.equal(guests.length, 1);
  assert.equal(guests[0].isGuest, true);
  assert.equal(guests[0].username, 'CaperGuest');
  assert.deepEqual(Object.keys(guests[0]).sort(), ['id', 'isGuest', 'profile', 'username']);
  assert.ok(!JSON.stringify(guests).includes('lastActiveAt') && !JSON.stringify(guests).includes('email'));
});

test('friend requests require explicit recipient acceptance, are idempotent and remain invisible to a third account', async (t) => {
  const db = await fixture(t);
  for (const [i, name] of ['Captain', 'Builder', 'Explorer'].entries()) await save(db, ids[i]!, name);
  const requested = await rpc(db, ids[0]!, 'catanova_friend_action', ['request', ids[1]]);
  assert.equal(requested.outgoing.length, 1);
  assert.equal(requested.friends.length, 0);
  assert.deepEqual(await rpc(db, ids[0]!, 'catanova_friend_action', ['request', ids[1]]), requested);
  assert.equal((await rpc(db, ids[1]!, 'catanova_friends')).incoming[0].id, ids[0]);
  await assert.rejects(rpc(db, ids[0]!, 'catanova_friend_action', ['accept', ids[1]]), /FRIEND_INVALID/);
  await assert.rejects(rpc(db, ids[2]!, 'catanova_friend_action', ['accept', ids[1]]), /FRIEND_INVALID/);
  assert.deepEqual(await rpc(db, ids[2]!, 'catanova_friends'), { friends: [], incoming: [], outgoing: [] });
  const accepted = await rpc(db, ids[1]!, 'catanova_friend_action', ['accept', ids[0]]);
  assert.equal(accepted.friends.length, 1);
  assert.equal(accepted.incoming.length, 0);
  assert.equal((await rpc(db, ids[0]!, 'catanova_friends')).friends[0].id, ids[1]);
  await rpc(db, ids[0]!, 'catanova_friend_action', ['remove', ids[1]]);
  assert.deepEqual(await rpc(db, ids[1]!, 'catanova_friends'), { friends: [], incoming: [], outgoing: [] });
  await rpc(db, ids[0]!, 'catanova_friend_action', ['request', ids[1]]);
  await assert.rejects(rpc(db, ids[1]!, 'catanova_friend_action', ['cancel', ids[0]]), /FRIEND_INVALID/);
  await rpc(db, ids[1]!, 'catanova_friend_action', ['decline', ids[0]]);
  assert.deepEqual(await rpc(db, ids[0]!, 'catanova_friends'), { friends: [], incoming: [], outgoing: [] });
});

test('a Google link completed before expiry survives delayed refresh, while a late link cannot revive expired guest identity', async (t) => {
  const db = await fixture(t);
  await save(db, ids[3]!, 'TimelyLink');
  await db.query("update public.catanova_profiles set last_active_at=now()-interval '8 days' where id=$1", [
    ids[3],
  ]);
  await db.query('update auth.users set is_anonymous=false where id=$1', [ids[3]]);
  await db.query(
    "insert into auth.identities(user_id,provider,identity_data,created_at) values($1,'google','{}',now()-interval '2 days')",
    [ids[3]],
  );
  const linked = await rpc(db, ids[3]!, 'catanova_account_get', [], false);
  assert.equal(linked.username, 'TimelyLink');
  assert.equal(linked.isGuest, false);
  const late = '00000000-0000-4000-8000-000000000099';
  await db.query('insert into auth.users(id,is_anonymous) values($1,true)', [late]);
  await save(db, late, 'LateLink');
  await db.query("update public.catanova_profiles set last_active_at=now()-interval '8 days' where id=$1", [
    late,
  ]);
  await db.query('update auth.users set is_anonymous=false where id=$1', [late]);
  await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'google','{}')", [
    late,
  ]);
  await assert.rejects(rpc(db, late, 'catanova_account_get'), /GUEST_EXPIRED/);
});

test('scoped durable request budgets bound friend request/cancel cycling and username search without exposing the counters', async (t) => {
  const db = await fixture(t);
  await save(db, ids[0]!, 'Captain');
  await save(db, ids[1]!, 'Builder');
  for (let i = 0; i < 6; i++) {
    await rpc(db, ids[0]!, 'catanova_friend_action', ['request', ids[1]]);
    await rpc(db, ids[0]!, 'catanova_friend_action', ['cancel', ids[1]]);
  }
  await assert.rejects(rpc(db, ids[0]!, 'catanova_friend_action', ['request', ids[1]]), /ACCOUNT_RATE_LIMIT/);
  assert.deepEqual((await rpc(db, ids[1]!, 'catanova_friends')).incoming, []);
  await assert.rejects(
    asUser(db, ids[0]!, 'select * from catanova_private.request_limits'),
    /permission denied/,
  );
  await assert.rejects(
    asUser(db, ids[0]!, "select catanova_private.consume_request('friends_minute',1000000,1)"),
    /permission denied/,
  );
  for (let i = 0; i < 30; i++)
    assert.equal((await rpc(db, ids[0]!, 'catanova_friend_search', ['Bui'])).length, 1);
  await assert.rejects(rpc(db, ids[0]!, 'catanova_friend_search', ['Bui']), /ACCOUNT_RATE_LIMIT/);
  await db.query(
    "update catanova_private.request_limits set window_start=now()-interval '61 seconds' where id=$1 and bucket in ('friends_minute','search_minute')",
    [ids[0]],
  );
  await rpc(db, ids[0]!, 'catanova_friend_action', ['request', ids[1]]);
  assert.equal((await rpc(db, ids[1]!, 'catanova_friends')).incoming.length, 1);
  assert.equal((await rpc(db, ids[0]!, 'catanova_friend_search', ['Bui'])).length, 1);
  await db.exec(schema);
  assert.equal(
    (await rpc(db, ids[0]!, 'catanova_friends')).outgoing.length,
    1,
    'idempotent rerun retains profiles and friendships',
  );
});

test('hosted avatar patch erases only old photo settings, keeps private permissions and is safe to rerun', async (t) => {
  const db = await fixture(t);
  await save(db, ids[0]!, 'Captain');
  await save(db, ids[1]!, 'Builder');
  await rpc(db, ids[0]!, 'catanova_friend_action', ['request', ids[1]]);
  await rpc(db, ids[1]!, 'catanova_friend_action', ['accept', ids[0]]);
  await db.exec(`alter table public.catanova_profiles drop constraint catanova_profiles_avatar_source_check;
    alter table public.catanova_profiles drop constraint catanova_profiles_no_google_photo;
    update public.catanova_profiles set avatar_source='google',google_avatar_url='https://lh3.googleusercontent.com/a/private';`);
  const before = (
    await db.query(
      'select id,username,avatar,is_guest,created_at,last_active_at from public.catanova_profiles order by id',
    )
  ).rows;
  const friendsBefore = (await db.query('select * from public.catanova_friendships')).rows;
  const authBefore = (await db.query('select * from auth.identities order by user_id')).rows;
  await db.exec(avatarPatch);
  await db.exec(avatarPatch);
  assert.deepEqual(
    (
      await db.query(
        'select id,username,avatar,is_guest,created_at,last_active_at from public.catanova_profiles order by id',
      )
    ).rows,
    before,
  );
  assert.deepEqual((await db.query('select * from public.catanova_friendships')).rows, friendsBefore);
  assert.deepEqual((await db.query('select * from auth.identities order by user_id')).rows, authBefore);
  assert.deepEqual(
    (await db.query('select distinct avatar_source,google_avatar_url from public.catanova_profiles')).rows,
    [{ avatar_source: 'generated', google_avatar_url: null }],
  );
  await assert.rejects(
    db.exec(
      "update public.catanova_profiles set google_avatar_url='https://lh3.googleusercontent.com/a/reintroduced'",
    ),
    /check constraint/,
  );
  await assert.rejects(
    db.exec("update public.catanova_profiles set avatar_source='google'"),
    /check constraint/,
  );
  const current = await rpc(db, ids[0]!, 'catanova_account_get');
  assert.equal(current.username, 'Captain');
  assert.ok(!('googleAvatarUrl' in current));
  assert.deepEqual(Object.keys(current.profile).sort(), ['accent', 'avatar', 'frame', 'name', 'username']);
  const friends = await rpc(db, ids[0]!, 'catanova_friends');
  assert.equal(friends.friends[0].username, 'Builder');
  assert.ok(!JSON.stringify(friends).includes('avatarUrl'));
  await assert.rejects(asUser(db, ids[0]!, 'select * from public.catanova_profiles'), /permission denied/);
  await assert.rejects(
    asUser(db, ids[0]!, 'select catanova_private.require_account(false)'),
    /permission denied/,
  );
  await db.exec('set role anon');
  await assert.rejects(
    db.exec("select public.catanova_profile_save('Intruder',0,'generated')"),
    /permission denied/,
  );
  await db.exec('reset role');
});
