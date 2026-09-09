-- Catanova accounts, seven-day guest profiles and private friend relationships.
-- Run the entire migration in the Supabase SQL editor. No service-role key is used by the app.
begin;
create schema if not exists catanova_private;
revoke all on schema catanova_private from public, anon, authenticated;

create table if not exists public.catanova_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar integer not null default 0 check (avatar between 0 and 11),
  avatar_source text not null default 'generated' check (avatar_source in ('generated','google')),
  google_avatar_url text,
  is_guest boolean not null,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);
create unique index if not exists catanova_username_unique on public.catanova_profiles(lower(username)) where username is not null;
create index if not exists catanova_guest_expiry on public.catanova_profiles(last_active_at) where is_guest;
create table if not exists catanova_private.expired_guests (
  id uuid primary key references auth.users(id) on delete cascade,
  expired_at timestamptz not null
);
create table if not exists catanova_private.request_limits (
  id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  requests integer not null check(requests > 0),
  primary key(id,bucket)
);
create table if not exists public.catanova_friendships (
  user_low uuid not null references public.catanova_profiles(id) on delete cascade,
  user_high uuid not null references public.catanova_profiles(id) on delete cascade,
  requester uuid not null references public.catanova_profiles(id) on delete cascade,
  status text not null check(status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_low,user_high),
  check(user_low < user_high),
  check(requester in (user_low,user_high))
);
-- All direct table reads/writes are denied. Only narrowly scoped auth.uid RPCs below are exposed.
-- No public profile-directory table policy: search RPC returns only the chosen public fields.
alter table public.catanova_profiles enable row level security;
alter table public.catanova_friendships enable row level security;
alter table catanova_private.expired_guests enable row level security;
alter table catanova_private.request_limits enable row level security;
revoke all on public.catanova_profiles, public.catanova_friendships from public, anon, authenticated;
revoke all on catanova_private.expired_guests from public, anon, authenticated;
revoke all on catanova_private.request_limits from public, anon, authenticated;

-- Client-side debounce is not an authorization boundary. Successful scoped operations consume
-- durable per-account budgets, including request/cancel cycles; callers cannot edit these counters.
create or replace function catanova_private.consume_request(p_bucket text,p_limit integer,p_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_requests integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into catanova_private.request_limits(id,bucket,window_start,requests)
    values(auth.uid(),p_bucket,now(),1)
    on conflict(id,bucket) do update set
      window_start=case when request_limits.window_start <= now()-make_interval(secs=>p_seconds) then now() else request_limits.window_start end,
      requests=case when request_limits.window_start <= now()-make_interval(secs=>p_seconds) then 1 else request_limits.requests+1 end
    returning requests into v_requests;
  if v_requests > p_limit then raise exception 'ACCOUNT_RATE_LIMIT'; end if;
end;
$$;

create or replace function catanova_private.cleanup_guests() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.catanova_profiles p set is_guest=false
  where p.is_guest and exists(select 1 from auth.users u where u.id=p.id and not coalesce(u.is_anonymous,false))
    and exists(select 1 from auth.identities i where i.user_id=p.id and i.provider='google'
      and i.created_at <= p.last_active_at + interval '7 days');
  with expired as (
    delete from public.catanova_profiles
    where is_guest and last_active_at <= now() - interval '7 days'
    returning id,last_active_at
  )
  insert into catanova_private.expired_guests(id,expired_at)
  select id,last_active_at + interval '7 days' from expired on conflict(id) do nothing;
end;
$$;

create or replace function catanova_private.require_account(p_touch boolean default false)
returns public.catanova_profiles language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := auth.uid(); v_guest boolean; v_created timestamptz; v_google boolean;
  v_photo text; v_profile public.catanova_profiles;
begin
  if v_id is null then raise exception 'AUTH_REQUIRED'; end if;
  -- auth.users and auth.identities are provider-owned; raw_user_meta_data is deliberately not trusted.
  select coalesce(u.is_anonymous,false), u.created_at,
    exists(select 1 from auth.identities i where i.user_id = u.id and i.provider = 'google')
    into v_guest,v_created,v_google from auth.users u where u.id = v_id;
  if not found or (not v_guest and not v_google) then raise exception 'AUTH_REQUIRED'; end if;
  perform catanova_private.cleanup_guests();
  if exists(select 1 from catanova_private.expired_guests where id = v_id) then raise exception 'GUEST_EXPIRED'; end if;
  select * into v_profile from public.catanova_profiles where id = v_id for update;
  if not found then
    if v_guest and v_created <= now() - interval '7 days' then raise exception 'GUEST_EXPIRED'; end if;
    insert into public.catanova_profiles(id,is_guest) values(v_id,v_guest) on conflict(id) do nothing;
    select * into v_profile from public.catanova_profiles where id = v_id for update;
  end if;
  if v_profile.is_guest and v_profile.last_active_at <= now() - interval '7 days' then raise exception 'GUEST_EXPIRED'; end if;
  select coalesce(i.identity_data->>'picture', i.identity_data->>'avatar_url') into v_photo
    from auth.identities i where i.user_id = v_id and i.provider = 'google' limit 1;
  if v_photo is not null and v_photo !~ '^https://lh[0-9]+[.]googleusercontent[.]com/' then v_photo := null; end if;
  -- Successful Google linking upgrades this same row and leaves its username/cosmetics unchanged.
  if v_profile.is_guest is distinct from v_guest or v_profile.google_avatar_url is distinct from v_photo or p_touch then
    update public.catanova_profiles set is_guest = v_guest, google_avatar_url = v_photo,
      last_active_at = case when p_touch then now() else last_active_at end
      where id = v_id returning * into v_profile;
  end if;
  return v_profile;
end;
$$;

create or replace function catanova_private.profile_json(p public.catanova_profiles) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p.username is null then null else jsonb_build_object(
    'name',p.username,'username',p.username,'avatar',p.avatar,'accent','sea','frame','rope',
    'avatarSource',case when p.avatar_source = 'google' and p.google_avatar_url is not null then 'google' else 'generated' end
  ) || case when p.avatar_source = 'google' and p.google_avatar_url is not null
      then jsonb_build_object('avatarUrl',p.google_avatar_url) else '{}'::jsonb end end;
$$;
create or replace function catanova_private.account_json(p public.catanova_profiles) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.id,'username',p.username,'isGuest',p.is_guest,
    'registered',p.username is not null,'profile',catanova_private.profile_json(p),
    'googleAvatarUrl',p.google_avatar_url,'lastActiveAt',p.last_active_at,
    'expiresAt',case when p.is_guest then p.last_active_at + interval '7 days' else null end);
$$;
create or replace function public.catanova_account_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.catanova_profiles;
begin p := catanova_private.require_account(false); return catanova_private.account_json(p); end;
$$;
create or replace function public.catanova_account_touch() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.catanova_profiles;
begin p := catanova_private.require_account(true); return catanova_private.account_json(p); end;
$$;

create or replace function public.catanova_username_available(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.catanova_profiles; v_name text := btrim(p_username);
begin
  p := catanova_private.require_account(false);
  perform catanova_private.consume_request('username_minute',60,60);
  if v_name is null or v_name !~ '^[A-Za-z0-9_]{3,20}$' then
    return jsonb_build_object('available',false,'reason','Use 3–20 letters, numbers or underscores');
  end if;
  if exists(select 1 from public.catanova_profiles where lower(username)=lower(v_name) and id<>p.id) then
    return jsonb_build_object('available',false,'reason','That username is taken');
  end if;
  return jsonb_build_object('available',true);
end;
$$;
create or replace function public.catanova_profile_save(p_username text,p_avatar integer,p_avatar_source text default 'generated') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.catanova_profiles; v_name text := btrim(p_username);
begin
  p := catanova_private.require_account(true);
  perform catanova_private.consume_request('profile_minute',20,60);
  if v_name is null or v_name !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'USERNAME_INVALID'; end if;
  if p_avatar is null or p_avatar < 0 or p_avatar > 11 then raise exception 'AVATAR_INVALID'; end if;
  if p_avatar_source is null or p_avatar_source not in ('generated','google') then raise exception 'AVATAR_INVALID'; end if;
  if p_avatar_source = 'google' and (p.is_guest or p.google_avatar_url is null) then raise exception 'GOOGLE_PHOTO_UNAVAILABLE'; end if;
  begin
    update public.catanova_profiles set username=v_name,avatar=p_avatar,avatar_source=p_avatar_source
      where id=p.id returning * into p;
  exception when unique_violation then raise exception 'USERNAME_TAKEN'; end;
  return catanova_private.account_json(p);
end;
$$;

create or replace function catanova_private.require_google() returns public.catanova_profiles
language plpgsql security definer set search_path = '' as $$
declare p public.catanova_profiles;
begin
  p := catanova_private.require_account(false);
  -- The JWT must also reflect the upgrade: an old anonymous token cannot acquire friend privileges.
  if p.is_guest or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'GOOGLE_REQUIRED'; end if;
  if p.username is null then raise exception 'ONBOARDING_REQUIRED'; end if;
  return p;
end;
$$;
create or replace function catanova_private.public_account(p public.catanova_profiles) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.id,'username',p.username,'isGuest',p.is_guest,'profile',catanova_private.profile_json(p));
$$;
create or replace function public.catanova_friends() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.catanova_profiles; v_result jsonb;
begin
  p := catanova_private.require_google();
  select jsonb_build_object(
    'friends',coalesce(jsonb_agg(catanova_private.public_account(other) order by lower(other.username)) filter(where f.status='accepted'),'[]'::jsonb),
    'incoming',coalesce(jsonb_agg(catanova_private.public_account(other) order by lower(other.username)) filter(where f.status='pending' and f.requester<>p.id),'[]'::jsonb),
    'outgoing',coalesce(jsonb_agg(catanova_private.public_account(other) order by lower(other.username)) filter(where f.status='pending' and f.requester=p.id),'[]'::jsonb)
  ) into v_result from public.catanova_friendships f
  join public.catanova_profiles other on other.id=case when f.user_low=p.id then f.user_high else f.user_low end
  where (f.user_low=p.id or f.user_high=p.id) and not other.is_guest and other.username is not null;
  return v_result;
end;
$$;
create or replace function public.catanova_friend_search(p_query text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.catanova_profiles; v_query text := lower(btrim(p_query)); v_result jsonb;
begin
  p := catanova_private.require_google();
  if v_query is null or v_query !~ '^[a-z0-9_]{3,20}$' then return '[]'::jsonb; end if;
  perform catanova_private.consume_request('search_minute',30,60);
  select coalesce(jsonb_agg(catanova_private.public_account(results.profile_row) order by lower((results.profile_row).username)),'[]'::jsonb)
    into v_result from (select other from public.catanova_profiles other
      where other.id<>p.id and other.username is not null
        and left(lower(other.username),length(v_query))=v_query
      order by lower(other.username) limit 10) results(profile_row);
  return v_result;
end;
$$;
create or replace function public.catanova_friend_action(p_action text,p_other uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.catanova_profiles; other public.catanova_profiles; f public.catanova_friendships;
  v_low uuid; v_high uuid;
begin
  p := catanova_private.require_google();
  if p_other is null or p_other=p.id then raise exception 'FRIEND_INVALID'; end if;
  if p_action is null or p_action not in ('request','accept','decline','cancel','remove') then raise exception 'FRIEND_INVALID'; end if;
  perform catanova_private.consume_request('friends_minute',12,60);
  perform catanova_private.consume_request('friends_hour',60,3600);
  -- Each user's count is serialized, including requests to different people.
  -- require_account has locked p already; acquire the counterpart with NOWAIT to prevent reverse-request deadlocks.
  begin select * into other from public.catanova_profiles where id=p_other for update nowait;
  exception when lock_not_available then raise exception 'ACCOUNT_BUSY'; end;
  if not found or other.is_guest or other.username is null then raise exception 'FRIEND_NOT_FOUND'; end if;
  v_low := least(p.id,p_other); v_high := greatest(p.id,p_other);
  select * into f from public.catanova_friendships where user_low=v_low and user_high=v_high for update;
  if p_action='request' then
    if f.status is not null then return public.catanova_friends(); end if;
    if (select count(*) from public.catanova_friendships where requester=p.id and status='pending') >= 20
      or (select count(*) from public.catanova_friendships where status='pending' and (user_low=p_other or user_high=p_other)) >= 40
      then raise exception 'FRIEND_LIMIT'; end if;
    insert into public.catanova_friendships(user_low,user_high,requester,status) values(v_low,v_high,p.id,'pending');
  elsif p_action='accept' then
    if f.status='accepted' then return public.catanova_friends(); end if;
    if f.status is distinct from 'pending' or f.requester=p.id then raise exception 'FRIEND_INVALID'; end if;
    if (select count(*) from public.catanova_friendships where status='accepted' and (user_low=p.id or user_high=p.id)) >= 100
      or (select count(*) from public.catanova_friendships where status='accepted' and (user_low=p_other or user_high=p_other)) >= 100
      then raise exception 'FRIEND_LIMIT'; end if;
    update public.catanova_friendships set status='accepted',updated_at=now() where user_low=v_low and user_high=v_high;
  else
    if f.status is null then return public.catanova_friends(); end if;
    if (p_action='decline' and (f.status<>'pending' or f.requester=p.id))
      or (p_action='cancel' and (f.status<>'pending' or f.requester<>p.id))
      or (p_action='remove' and f.status<>'accepted') then raise exception 'FRIEND_INVALID'; end if;
    delete from public.catanova_friendships where user_low=v_low and user_high=v_high;
  end if;
  update public.catanova_profiles set last_active_at=now() where id=p.id;
  return public.catanova_friends();
end;
$$;

-- Functions default to PUBLIC EXECUTE in Postgres: revoke it explicitly, including every helper.
revoke all on all functions in schema catanova_private from public, anon, authenticated;
revoke all on function public.catanova_account_get(), public.catanova_account_touch(),
  public.catanova_username_available(text), public.catanova_profile_save(text,integer,text),
  public.catanova_friends(), public.catanova_friend_search(text), public.catanova_friend_action(text,uuid)
  from public, anon, authenticated;
grant execute on function public.catanova_account_get(), public.catanova_account_touch(),
  public.catanova_username_available(text), public.catanova_profile_save(text,integer,text),
  public.catanova_friends(), public.catanova_friend_search(text), public.catanova_friend_action(text,uuid)
  to authenticated;
commit;
