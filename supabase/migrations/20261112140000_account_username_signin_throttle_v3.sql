-- web-signin-lockout-v3 :: APPLY FIXED (proposed, NOT applied). Differences from 01-apply.sql: null-safe, global-key-safe input validation in v3 only.
-- Additive. Leaves account_resolve_username_signin_v2 (public + account_api) untouched so this
-- can be applied BEFORE the Edge Function / web deploy that starts calling v3.
--
-- Adds:
--   public.account_resolve_username_signin_v3(text,text,text) -> (resolved_user_id uuid, throttled boolean)
--   public.account_note_username_signin_success_v1(text)      -> void
--   account_api wrappers for both (PostgREST exposes only account_api to the Edge Function)
--
-- Same hashing/attempt-key scheme, windows (15 min) and limits (10 per username, 30 per client,
-- 500 global) as v2. v3 differences: always returns exactly one row for valid input and says
-- throttled = true when any limit is exceeded, so a lockout is distinguishable from a wrong
-- password. Throttling is evaluated before and independent of username existence, so the signal
-- does not reveal whether a username exists. The success function deletes ONLY the per-username
-- counter row after a verified password sign-in, so only failures accumulate toward the limit.

begin;

do $preflight$
begin
  if to_regprocedure('public.account_resolve_username_signin_v2(text,text,text)') is null then
    raise exception 'preflight: public.account_resolve_username_signin_v2(text,text,text) is missing';
  end if;
  if to_regprocedure('account_api.account_resolve_username_signin_v2(text,text,text)') is null then
    raise exception 'preflight: account_api.account_resolve_username_signin_v2(text,text,text) is missing';
  end if;
  if to_regclass('account_private.username_signin_attempts') is null then
    raise exception 'preflight: account_private.username_signin_attempts is missing';
  end if;
  if to_regclass('account_private.username_signin_index') is null then
    raise exception 'preflight: account_private.username_signin_index is missing';
  end if;
end
$preflight$;

create or replace function public.account_resolve_username_signin_v3(
  p_normalized_username text,
  p_attempt_key text,
  p_client_attempt_key text
)
returns table (resolved_user_id uuid, throttled boolean)
language plpgsql
security definer
set search_path = pg_catalog, account_private
as $$
declare
  now_value timestamptz := clock_timestamp();
  current_count integer;
  client_count integer;
  global_count integer;
begin
  -- FIXED: NULL arguments are invalid (coalesce(..., true)); the original raised a not-null violation on the counter insert.
  -- FIXED: the shared global counter key (64 zeros) is not accepted as a username or client key.
  if coalesce(p_normalized_username !~ '^[a-z0-9._-]{2,15}$', true)
     or coalesce(p_attempt_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_client_attempt_key !~ '^[0-9a-f]{64}$', true)
     or p_attempt_key = repeat('0', 64)
     or p_client_attempt_key = repeat('0', 64) then
    return query select null::uuid, false;
    return;
  end if;

  delete from account_private.username_signin_attempts
  where window_started_at <= now_value - interval '15 minutes';

  insert into account_private.username_signin_attempts (
    attempt_key,
    window_started_at,
    attempt_count
  ) values (repeat('0', 64), now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into global_count;

  if global_count > 500 then
    return query select null::uuid, true;
    return;
  end if;

  insert into account_private.username_signin_attempts (
    attempt_key,
    window_started_at,
    attempt_count
  ) values (p_client_attempt_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into client_count;

  if client_count > 30 then
    return query select null::uuid, true;
    return;
  end if;

  insert into account_private.username_signin_attempts (
    attempt_key,
    window_started_at,
    attempt_count
  ) values (p_attempt_key, now_value, 1)
  on conflict (attempt_key) do update
    set window_started_at = case
          when account_private.username_signin_attempts.window_started_at <= now_value - interval '15 minutes'
            then now_value
          else account_private.username_signin_attempts.window_started_at
        end,
        attempt_count = case
          when account_private.username_signin_attempts.window_started_at <= now_value - interval '15 minutes'
            then 1
          else account_private.username_signin_attempts.attempt_count + 1
        end
  returning attempt_count into current_count;

  if current_count > 10 then
    return query select null::uuid, true;
    return;
  end if;

  return query
  select
    (
      select username_index.user_id
      from account_private.username_signin_index username_index
      where username_index.normalized_username = p_normalized_username
    ),
    false;
end;
$$;

revoke execute on function public.account_resolve_username_signin_v3(text, text, text)
  from public, anon, authenticated;
grant execute on function public.account_resolve_username_signin_v3(text, text, text)
  to service_role;

create or replace function public.account_note_username_signin_success_v1(
  p_attempt_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, account_private
as $$
begin
  -- Only a well-formed per-username key; never the shared global counter row.
  if p_attempt_key !~ '^[0-9a-f]{64}$' or p_attempt_key = repeat('0', 64) then
    return;
  end if;

  delete from account_private.username_signin_attempts
  where attempt_key = p_attempt_key;
end;
$$;

revoke execute on function public.account_note_username_signin_success_v1(text)
  from public, anon, authenticated;
grant execute on function public.account_note_username_signin_success_v1(text)
  to service_role;

create or replace function account_api.account_resolve_username_signin_v3(
  p_normalized_username text,
  p_attempt_key text,
  p_client_attempt_key text
)
returns table (resolved_user_id uuid, throttled boolean)
language sql
security definer
set search_path = pg_catalog, account_api, public
as $$
  select resolver.resolved_user_id, resolver.throttled
  from public.account_resolve_username_signin_v3(
    p_normalized_username,
    p_attempt_key,
    p_client_attempt_key
  ) resolver;
$$;

revoke execute on function account_api.account_resolve_username_signin_v3(text, text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_signin_v3(text, text, text)
  to service_role;

create or replace function account_api.account_note_username_signin_success_v1(
  p_attempt_key text
)
returns void
language sql
security definer
set search_path = pg_catalog, account_api, public
as $$
  select public.account_note_username_signin_success_v1(p_attempt_key);
$$;

revoke execute on function account_api.account_note_username_signin_success_v1(text)
  from public, anon, authenticated;
grant execute on function account_api.account_note_username_signin_success_v1(text)
  to service_role;

commit;
