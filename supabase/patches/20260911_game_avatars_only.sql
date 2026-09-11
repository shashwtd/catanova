-- Existing hosted projects: run this file once in the Supabase SQL editor.
-- Safe to rerun. It changes no username, avatar index, account ID, timestamp or friendship.
-- Only deprecated photo settings are erased. Supabase Auth identities are left intact.
-- The app already strips legacy photo fields, so deploy the server before applying this patch.
begin;
-- Preserve every account, chosen username/avatar, timestamp and friendship; discard only old photo settings.
update public.catanova_profiles set avatar_source='generated',google_avatar_url=null
  where avatar_source<>'generated' or google_avatar_url is not null;
alter table public.catanova_profiles drop constraint if exists catanova_profiles_avatar_source_check;
alter table public.catanova_profiles add constraint catanova_profiles_avatar_source_check check (avatar_source='generated');
alter table public.catanova_profiles drop constraint if exists catanova_profiles_no_google_photo;
alter table public.catanova_profiles add constraint catanova_profiles_no_google_photo check (google_avatar_url is null);

create or replace function catanova_private.require_account(p_touch boolean default false)
returns public.catanova_profiles language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := auth.uid(); v_guest boolean; v_created timestamptz; v_google boolean;
  v_profile public.catanova_profiles;
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
  -- Google proves identity only. Linking preserves this row and its chosen game identity.
  if v_profile.is_guest is distinct from v_guest or p_touch then
    update public.catanova_profiles set is_guest = v_guest,
      last_active_at = case when p_touch then now() else last_active_at end
      where id = v_id returning * into v_profile;
  end if;
  return v_profile;
end;
$$;

create or replace function catanova_private.profile_json(p public.catanova_profiles) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p.username is null then null else jsonb_build_object(
    'name',p.username,'username',p.username,'avatar',p.avatar,'accent','sea','frame','rope'
  ) end;
$$;

create or replace function catanova_private.account_json(p public.catanova_profiles) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.id,'username',p.username,'isGuest',p.is_guest,
    'registered',p.username is not null,'profile',catanova_private.profile_json(p),
    'lastActiveAt',p.last_active_at,
    'expiresAt',case when p.is_guest then p.last_active_at + interval '7 days' else null end);
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
  begin
    -- Retain this argument for old clients, but never select or load a provider photo.
    update public.catanova_profiles set username=v_name,avatar=p_avatar,avatar_source='generated',google_avatar_url=null
      where id=p.id returning * into p;
  exception when unique_violation then raise exception 'USERNAME_TAKEN'; end;
  return catanova_private.account_json(p);
end;
$$;

-- Keep the scoped API privileges and default-deny profile table boundary.
alter table public.catanova_profiles enable row level security;
revoke all on public.catanova_profiles from public, anon, authenticated;
revoke all on function catanova_private.require_account(boolean),
  catanova_private.profile_json(public.catanova_profiles), catanova_private.account_json(public.catanova_profiles)
  from public, anon, authenticated;
revoke all on function public.catanova_profile_save(text,integer,text) from public, anon, authenticated;
grant execute on function public.catanova_profile_save(text,integer,text) to authenticated;
commit;
