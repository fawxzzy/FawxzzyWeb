-- PROPOSED, OWNER-GATED. NOT APPLIED. Lives in supabase/proposed/ (not supabase/migrations/) so no
-- migration runner or Git integration can apply it on merge. Apply only after the owner approves this
-- file by sha256 (see docs/shared-account-portal-phase1.md, "Change username / change email").
--
-- Change username v1 (account portal, design point 12): a signed-in person renames themselves from
-- account.fawxzzy.com/account after re-entering their password in the portal.
--
--   account_api.account_change_username(p_username text) returns text
--     'changed' | 'same' | 'taken' | 'invalid' | 'rate'
--
-- * Same rules as sign-up: 2-15 of A-Z a-z 0-9 . _ - ; "taken" is case-insensitive and trimmed across
--   every app namespace (the same claim the live BEFORE trigger account_guard_username_claim judges).
-- * Rate limited per account: at most 10 attempts per 15 minutes and 3 successful changes per 24 hours.
-- * The live guard stays the authority: this function takes the same per-claim advisory locks in the
--   same (lexical) order, pre-checks for a friendly 'taken', and still maps the guard's 23505
--   ACCOUNT_USERNAME_TAKEN to 'taken' if a racing sign-up wins.
-- * The existing AFTER trigger sync_username_signin_index moves username sign-in to the new name in
--   the same transaction. Mazer profile names (mazer.mazer_profiles) are NOT changed here.
-- * Callable only by the authenticated role, for auth.uid() only. Never by anon. The inner function and
--   the attempts table are not reachable through the API.
-- * Grants USAGE on schema account_api to authenticated (today only service_role has it). The preflight
--   proves no existing account_api function, table, view or sequence becomes reachable by that grant.
--   A function added LATER in account_api is executable by PUBLIC unless its migration revokes it
--   (per-schema default privileges cannot remove the global PUBLIC default); the repo test
--   tests/account-change.test.mjs fails any migration that creates an account_api function without
--   revoking execute from public.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $preflight$
declare
  leaked text;
begin
  if to_regnamespace('account_api') is null then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_ACCOUNT_API_MISSING';
  end if;
  if to_regnamespace('account_private') is null then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_ACCOUNT_PRIVATE_MISSING';
  end if;
  if to_regprocedure('account_api.account_change_username(text)') is not null
     or to_regprocedure('account_private.change_username_v1(uuid, text)') is not null
     or to_regclass('account_private.username_change_attempts') is not null then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_ALREADY_PRESENT';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'account_guard_username_claim' and tgenabled <> 'D'
  ) then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_USERNAME_GUARD_TRIGGER_MISSING_OR_DISABLED';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'account_private' and p.proname = 'guard_username_claim'
      and p.prosrc like '%GUARD_INERT_AFTER_ROLLBACK%'
  ) then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_USERNAME_GUARD_IS_INERT';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'sync_username_signin_index' and tgenabled <> 'D'
  ) then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_SIGNIN_INDEX_TRIGGER_MISSING_OR_DISABLED';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_AUTH_UID_MISSING';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_API_ROLES_MISSING';
  end if;
  if has_schema_privilege('anon', 'account_api', 'usage') then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_ANON_ALREADY_HAS_ACCOUNT_API_USAGE';
  end if;
  -- The rollback revokes this USAGE again, so it must not exist before (exact rollback).
  if has_schema_privilege('authenticated', 'account_api', 'usage') then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_AUTHENTICATED_ALREADY_HAS_ACCOUNT_API_USAGE';
  end if;

  -- Granting USAGE to authenticated must not expose anything that already exists in account_api.
  select string_agg(p.oid::regprocedure::text, ', ') into leaked
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'account_api' and has_function_privilege('authenticated', p.oid, 'execute');
  if leaked is not null then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_ACCOUNT_API_FUNCTION_EXECUTABLE_BY_AUTHENTICATED: %', leaked;
  end if;
  select string_agg(c.oid::regclass::text, ', ') into leaked
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'account_api'
    and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
    and (has_table_privilege('authenticated', c.oid, 'select')
      or has_table_privilege('authenticated', c.oid, 'insert')
      or has_table_privilege('authenticated', c.oid, 'update')
      or has_table_privilege('authenticated', c.oid, 'delete'));
  if leaked is not null then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_ACCOUNT_API_RELATION_REACHABLE_BY_AUTHENTICATED: %', leaked;
  end if;

  -- Applier privileges (no role switch anywhere in this file).
  if not pg_has_role(current_user, 'postgres', 'usage') then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_APPLIER_CANNOT_OWN_AS_POSTGRES';
  end if;
  if not has_schema_privilege(current_user, 'account_private', 'create')
     or not has_schema_privilege(current_user, 'account_api', 'create') then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_APPLIER_NO_CREATE';
  end if;
  if not has_table_privilege('postgres', 'auth.users', 'select')
     or not has_table_privilege('postgres', 'auth.users', 'update') then
    raise exception 'CHANGE_USERNAME_PREFLIGHT_OWNER_NEEDS_SELECT_UPDATE_ON_AUTH_USERS';
  end if;
end;
$preflight$;

create table account_private.username_change_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  outcome text not null check (outcome in ('changed', 'same', 'taken')),
  attempted_at timestamptz not null default now()
);
-- No foreign key to auth.users: the applier is not known to hold REFERENCES on it. Rows older than
-- 24 hours are pruned per account on each call; rows of a deleted account are inert.
create index username_change_attempts_user_time on account_private.username_change_attempts (user_id, attempted_at);
alter table account_private.username_change_attempts enable row level security;
revoke all on table account_private.username_change_attempts from public, anon, authenticated;
alter table account_private.username_change_attempts owner to postgres;

create function account_private.change_username_v1(p_user_id uuid, p_username text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_name text := trim(coalesce(p_username, ''));
  next_claim text := lower(trim(coalesce(p_username, '')));
  current_meta jsonb;
  current_name text;
  current_claim text;
  lock_claim text;
begin
  if p_user_id is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_CHANGE_NOT_SIGNED_IN';
  end if;
  if char_length(next_name) not between 2 and 15 or next_name !~ '^[A-Za-z0-9._-]+$' then
    return 'invalid';
  end if;

  -- One change at a time per account, so the rate counts below cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('account_username_change:' || p_user_id::text, 0));

  if (select count(*) from account_private.username_change_attempts a
      where a.user_id = p_user_id and a.attempted_at > now() - interval '15 minutes') >= 10
     or (select count(*) from account_private.username_change_attempts a
         where a.user_id = p_user_id and a.outcome = 'changed' and a.attempted_at > now() - interval '24 hours') >= 3 then
    return 'rate';
  end if;

  delete from account_private.username_change_attempts a
  where a.user_id = p_user_id and a.attempted_at < now() - interval '24 hours';

  select u.raw_user_meta_data into current_meta from auth.users u where u.id = p_user_id;
  if not found then
    raise exception using errcode = '42501', message = 'ACCOUNT_CHANGE_NOT_SIGNED_IN';
  end if;
  current_name := trim(coalesce(current_meta ->> 'username', ''));
  current_claim := lower(current_name);

  if current_name = next_name then
    insert into account_private.username_change_attempts (user_id, outcome) values (p_user_id, 'same');
    return 'same';
  end if;

  -- Same lock keys and order as account_guard_username_claim and sync_username_signin_index.
  for lock_claim in
    select claim from unnest(array[current_claim, next_claim]) claim
    where claim is not null and claim <> ''
    group by claim order by claim
  loop
    perform pg_advisory_xact_lock(hashtextextended('account_username:' || lock_claim, 0));
  end loop;

  if next_claim <> current_claim and exists (
    select 1 from auth.users other_user
    where lower(trim(coalesce(other_user.raw_user_meta_data ->> 'username', ''))) = next_claim
      and other_user.id is distinct from p_user_id
  ) then
    insert into account_private.username_change_attempts (user_id, outcome) values (p_user_id, 'taken');
    return 'taken';
  end if;

  begin
    update auth.users u
    set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
          || jsonb_build_object('username', next_name)
          -- A display name that simply mirrored the username follows it; a custom one is kept.
          || case
               when u.raw_user_meta_data ->> 'display_name' is null
                 or lower(trim(u.raw_user_meta_data ->> 'display_name')) = current_claim
               then jsonb_build_object('display_name', next_name)
               else '{}'::jsonb
             end,
        updated_at = now()
    where u.id = p_user_id;
  exception when unique_violation then
    -- The guard (or a unique index) saw a claim this pre-check could not: a racing sign-up won.
    insert into account_private.username_change_attempts (user_id, outcome) values (p_user_id, 'taken');
    return 'taken';
  end;

  insert into account_private.username_change_attempts (user_id, outcome) values (p_user_id, 'changed');
  return 'changed';
end;
$$;

revoke all on function account_private.change_username_v1(uuid, text) from public, anon, authenticated;
alter function account_private.change_username_v1(uuid, text) owner to postgres;

create function account_api.account_change_username(p_username text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select account_private.change_username_v1(auth.uid(), p_username)
$$;

revoke all on function account_api.account_change_username(text) from public, anon;
alter function account_api.account_change_username(text) owner to postgres;
grant execute on function account_api.account_change_username(text) to authenticated;
grant usage on schema account_api to authenticated;

do $postcheck$
begin
  if not has_function_privilege('authenticated', 'account_api.account_change_username(text)', 'execute') then
    raise exception 'CHANGE_USERNAME_POSTCHECK_AUTHENTICATED_CANNOT_CALL';
  end if;
  if has_function_privilege('anon', 'account_api.account_change_username(text)', 'execute') then
    raise exception 'CHANGE_USERNAME_POSTCHECK_ANON_CAN_CALL';
  end if;
  if has_function_privilege('authenticated', 'account_private.change_username_v1(uuid, text)', 'execute') then
    raise exception 'CHANGE_USERNAME_POSTCHECK_INNER_FUNCTION_EXPOSED';
  end if;
  if has_table_privilege('authenticated', 'account_private.username_change_attempts', 'select') then
    raise exception 'CHANGE_USERNAME_POSTCHECK_ATTEMPTS_TABLE_EXPOSED';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'account_api' and has_function_privilege('authenticated', p.oid, 'execute')) <> 1 then
    raise exception 'CHANGE_USERNAME_POSTCHECK_UNEXPECTED_ACCOUNT_API_EXECUTE';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
