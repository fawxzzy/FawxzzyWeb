-- web-signin-lockout-v4 :: PROPOSED, NOT applied. Additive; leaves v2, v3 and account_note_username_signin_success_v1 untouched
-- so it can be applied BEFORE the Edge Function that starts calling v4 (the Edge Function falls back to v3 while v4 is absent).
--
-- Why (see MAZER-ACCT-026 and reports/username-throttle-global-counter-20261112):
--   1. v3 incremented the single shared global counter BEFORE the per-client check, so one client sending about 500
--      well-formed requests made username sign-in answer "throttled" for everyone until the 15-minute window ended.
--   2. v3 counted every request toward a per-username counter, so 11 requests from anyone (right or wrong password)
--      locked that username, and the real owner, for 15 minutes.
--
-- Adds:
--   public.account_resolve_username_signin_v4(text,text,text,text) -> (resolved_user_id uuid, throttled boolean)
--   public.account_note_username_signin_failure_v1(text,text)      -> void
--   account_api wrappers for both (PostgREST exposes only account_api to the Edge Function)
--
-- v4 order of checks (each step runs only if the previous one passed):
--   1. per-client REQUEST counter, limit 30 per 15 minutes      (one client can only spend its own budget)
--   2. shared global REQUEST counter, limit 500 per 15 minutes  (counts only requests that passed step 1)
--   3. per-(username, client) FAILURE counter, locks at 10      (a stranger's failures never lock the owner)
--   4. per-username aggregate FAILURE counter, locks at 100     (distributed guessing cap; one address cannot reach it)
-- Steps 3 and 4 are CHECK ONLY. Counters grow only through account_note_username_signin_failure_v1, which the Edge
-- Function calls after a failed password check (known and unknown usernames alike, so a lockout reveals nothing).
-- A verified sign-in clears only that (username, client) counter through the existing success_v1 function.
-- Windows are 15 minutes. Throttling is decided before and independent of username existence.
--
-- Not fixed here (stated, not hidden): about 17 distinct addresses at 30 requests each can still trip the 500 global
-- limit, and 4 or more addresses can still reach the 100 per-username aggregate; both end when the window ends and
-- email sign-in is unaffected.

begin;

do $preflight$
begin
  if to_regprocedure('public.account_resolve_username_signin_v3(text,text,text)') is null then
    raise exception 'preflight: public.account_resolve_username_signin_v3(text,text,text) is missing';
  end if;
  if to_regprocedure('account_api.account_resolve_username_signin_v3(text,text,text)') is null then
    raise exception 'preflight: account_api.account_resolve_username_signin_v3(text,text,text) is missing';
  end if;
  if to_regprocedure('public.account_note_username_signin_success_v1(text)') is null then
    raise exception 'preflight: public.account_note_username_signin_success_v1(text) is missing';
  end if;
  if to_regprocedure('account_api.account_note_username_signin_success_v1(text)') is null then
    raise exception 'preflight: account_api.account_note_username_signin_success_v1(text) is missing';
  end if;
  if to_regclass('account_private.username_signin_attempts') is null then
    raise exception 'preflight: account_private.username_signin_attempts is missing';
  end if;
  if to_regclass('account_private.username_signin_index') is null then
    raise exception 'preflight: account_private.username_signin_index is missing';
  end if;
end
$preflight$;

create or replace function public.account_resolve_username_signin_v4(
  p_normalized_username text,
  p_attempt_key text,
  p_client_attempt_key text,
  p_pair_attempt_key text
)
returns table (resolved_user_id uuid, throttled boolean)
language plpgsql
security definer
set search_path = pg_catalog, account_private
as $$
declare
  now_value timestamptz := clock_timestamp();
  client_count integer;
  global_count integer;
  pair_count integer;
  aggregate_count integer;
begin
  -- NULL arguments are invalid (coalesce(..., true)). The shared global counter key (64 zeros) is never accepted as
  -- any caller-supplied key, and the three keys must differ so one request cannot be counted twice under one row.
  if coalesce(p_normalized_username !~ '^[a-z0-9._-]{2,15}$', true)
     or coalesce(p_attempt_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_client_attempt_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_pair_attempt_key !~ '^[0-9a-f]{64}$', true)
     or p_attempt_key = repeat('0', 64)
     or p_client_attempt_key = repeat('0', 64)
     or p_pair_attempt_key = repeat('0', 64)
     or p_attempt_key = p_client_attempt_key
     or p_attempt_key = p_pair_attempt_key
     or p_client_attempt_key = p_pair_attempt_key then
    return query select null::uuid, false;
    return;
  end if;

  delete from account_private.username_signin_attempts
  where window_started_at <= now_value - interval '15 minutes';

  -- 1. Per-client request counter first, so a client over its own limit never touches the shared counter.
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

  -- 2. Shared global request counter: only requests that passed the client limit are counted.
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

  -- 3. and 4. Failure counters, check only (rows older than the window were deleted above).
  select attempts.attempt_count
  into pair_count
  from account_private.username_signin_attempts attempts
  where attempts.attempt_key = p_pair_attempt_key;

  if coalesce(pair_count, 0) >= 10 then
    return query select null::uuid, true;
    return;
  end if;

  select attempts.attempt_count
  into aggregate_count
  from account_private.username_signin_attempts attempts
  where attempts.attempt_key = p_attempt_key;

  if coalesce(aggregate_count, 0) >= 100 then
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

revoke execute on function public.account_resolve_username_signin_v4(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.account_resolve_username_signin_v4(text, text, text, text)
  to service_role;

create or replace function public.account_note_username_signin_failure_v1(
  p_attempt_key text,
  p_pair_attempt_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, account_private
as $$
declare
  now_value timestamptz := clock_timestamp();
  failure_key text;
begin
  -- Only well-formed per-username keys; never the shared global counter row; the two keys must differ.
  if coalesce(p_attempt_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_pair_attempt_key !~ '^[0-9a-f]{64}$', true)
     or p_attempt_key = repeat('0', 64)
     or p_pair_attempt_key = repeat('0', 64)
     or p_attempt_key = p_pair_attempt_key then
    return;
  end if;

  foreach failure_key in array array[p_attempt_key, p_pair_attempt_key] loop
    insert into account_private.username_signin_attempts (
      attempt_key,
      window_started_at,
      attempt_count
    ) values (failure_key, now_value, 1)
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
          end;
  end loop;
end;
$$;

revoke execute on function public.account_note_username_signin_failure_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.account_note_username_signin_failure_v1(text, text)
  to service_role;

create or replace function account_api.account_resolve_username_signin_v4(
  p_normalized_username text,
  p_attempt_key text,
  p_client_attempt_key text,
  p_pair_attempt_key text
)
returns table (resolved_user_id uuid, throttled boolean)
language sql
security definer
set search_path = pg_catalog, account_api, public
as $$
  select resolver.resolved_user_id, resolver.throttled
  from public.account_resolve_username_signin_v4(
    p_normalized_username,
    p_attempt_key,
    p_client_attempt_key,
    p_pair_attempt_key
  ) resolver;
$$;

revoke execute on function account_api.account_resolve_username_signin_v4(text, text, text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_signin_v4(text, text, text, text)
  to service_role;

create or replace function account_api.account_note_username_signin_failure_v1(
  p_attempt_key text,
  p_pair_attempt_key text
)
returns void
language sql
security definer
set search_path = pg_catalog, account_api, public
as $$
  select public.account_note_username_signin_failure_v1(p_attempt_key, p_pair_attempt_key);
$$;

revoke execute on function account_api.account_note_username_signin_failure_v1(text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_note_username_signin_failure_v1(text, text)
  to service_role;

commit;
