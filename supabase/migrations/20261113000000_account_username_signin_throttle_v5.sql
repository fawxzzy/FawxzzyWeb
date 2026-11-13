-- web-signin-lockout-v5 (MAZER-ACCT-026 "harden the username sign-in lockout") :: PROPOSED, NOT applied.
-- Additive. Leaves v2, v3, v4 (public + account_api), account_note_username_signin_success_v1 and every table untouched, so it
-- can be applied BEFORE the Edge Function that starts calling v5 (the Edge Function falls back to v4, then v3, then v2 while v5
-- is absent). Live already has v4 (applied from PR #129); v5 does not replace it.
--
-- Why (what remains weak in v4):
--   1. v4 still counts every REQUEST, successes included, toward the per-client (30) and global (500) counters, so a legitimate
--      user behind a busy address burns the shared budget. v5 counts only failed password checks.
--   2. a client key taken from a forgeable header lets one caller mint client keys at will (fixed in the Edge Function, same PR),
--      which defeats the per-client, per-pair and global caps. v5 adds a strict budget for the shared 'unknown' client bucket.
--   3. v4 uses one writer that also gates (the resolver increments client/global), so a check is not read-only. v5 splits
--      CHECK (read-only) from RECORD FAILURE (the only writer).

-- Adds:
--   public.account_resolve_username_signin_v5(text,text,text,text)       -> (resolved_user_id uuid, throttled boolean)   CHECK ONLY
--   public.account_note_username_signin_failure_v2(text,text,text)       -> void                                          RECORD FAILURE
--   account_api wrappers for both (PostgREST exposes only account_api to the Edge Function)
-- A verified sign-in resets the per-(username, client) counter through the EXISTING account_note_username_signin_success_v1
-- (called with the v5 pair key); nothing else changes on success.
--
-- Counters (all in account_private.username_signin_attempts, fixed 15 minute window from the first failure, FAILURES only):
--   pair      key = sha256('username-client-v5:<username>|<client>')   locks at 10 failures  (one client cannot lock others out)
--   aggregate key = sha256('username-aggregate-v5:<username>')         locks at 50 failures  (distributed guessing cap)
--   client    key = sha256('client-failure-v5:<client>')               locks at 30 failures  (10 for the shared 'unknown' bucket)
--   global    key = sha256('global-failure-v5') (computed here)        locks at 500 failures (circuit breaker)
-- The check function never writes. The failure function is the only writer. Requests that are throttled, requests that pass the
-- password check, and unknown/known usernames are treated identically: the lock state of a username depends only on the
-- failure counters for that username string, never on whether the username exists.
--
-- Not fixed here (stated, not hidden): about 17 distinct addresses at 30 failures each can still trip the global 500 breaker, and
-- 5 or more addresses at 10 failures each can still trip a username's aggregate cap; both end when the window ends and email
-- sign-in is unaffected. Check and record are separate calls, so concurrent in-flight requests can overshoot a limit by the
-- number of requests admitted before the first failure is recorded.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare
  required_function text;
  required_table text;
begin
  if current_setting('server_version_num')::integer < 140000 then
    raise exception 'preflight: PostgreSQL 14 or newer is required';
  end if;

  foreach required_function in array array[
    'public.account_resolve_username_signin_v3(text,text,text)',
    'account_api.account_resolve_username_signin_v3(text,text,text)',
    'public.account_note_username_signin_success_v1(text)',
    'account_api.account_note_username_signin_success_v1(text)'
  ] loop
    if to_regprocedure(required_function) is null then
      raise exception 'preflight: % is missing', required_function;
    end if;
  end loop;

  foreach required_table in array array[
    'account_private.username_signin_attempts',
    'account_private.username_signin_index'
  ] loop
    if to_regclass(required_table) is null then
      raise exception 'preflight: % is missing', required_table;
    end if;
  end loop;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'account_private'
      and table_name = 'username_signin_attempts'
      and (column_name, data_type) in (
        ('attempt_key', 'text'),
        ('window_started_at', 'timestamp with time zone'),
        ('attempt_count', 'integer')
      )
  ) <> 3 then
    raise exception 'preflight: account_private.username_signin_attempts does not have the expected columns';
  end if;

  if not has_schema_privilege(current_user, 'account_api', 'create')
     or not has_schema_privilege(current_user, 'public', 'create') then
    raise exception 'preflight: the applying role cannot create functions in public and account_api';
  end if;
end
$preflight$;

create or replace function public.account_resolve_username_signin_v5(
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
  cutoff timestamptz := clock_timestamp() - interval '15 minutes';
  global_key constant text := encode(sha256(convert_to('global-failure-v5', 'UTF8')), 'hex');
  unknown_client_key constant text := encode(sha256(convert_to('client-failure-v5:unknown', 'UTF8')), 'hex');
  pair_failures integer;
  aggregate_failures integer;
  client_failures integer;
  global_failures integer;
  client_limit integer;
begin
  -- CHECK ONLY: this function never writes. NULL arguments are invalid (coalesce(..., true)). The shared counter
  -- keys (the v2/v3/v4 global row of 64 zeros and the v5 global key) are never accepted as a caller key, and the
  -- three caller keys must differ so one failure can never be counted twice under a single row.
  if coalesce(p_normalized_username !~ '^[a-z0-9._-]{2,15}$', true)
     or coalesce(p_attempt_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_client_attempt_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_pair_attempt_key !~ '^[0-9a-f]{64}$', true)
     or p_attempt_key in (repeat('0', 64), global_key)
     or p_client_attempt_key in (repeat('0', 64), global_key)
     or p_pair_attempt_key in (repeat('0', 64), global_key)
     or p_attempt_key = p_client_attempt_key
     or p_attempt_key = p_pair_attempt_key
     or p_client_attempt_key = p_pair_attempt_key then
    return query select null::uuid, false;
    return;
  end if;

  select
    max(attempts.attempt_count) filter (where attempts.attempt_key = p_pair_attempt_key),
    max(attempts.attempt_count) filter (where attempts.attempt_key = p_attempt_key),
    max(attempts.attempt_count) filter (where attempts.attempt_key = p_client_attempt_key),
    max(attempts.attempt_count) filter (where attempts.attempt_key = global_key)
  into pair_failures, aggregate_failures, client_failures, global_failures
  from account_private.username_signin_attempts attempts
  where attempts.attempt_key in (p_pair_attempt_key, p_attempt_key, p_client_attempt_key, global_key)
    and attempts.window_started_at > cutoff;

  -- The single shared 'unknown' client bucket (no trustworthy address) gets a stricter budget.
  client_limit := case when p_client_attempt_key = unknown_client_key then 10 else 30 end;

  if coalesce(pair_failures, 0) >= 10
     or coalesce(aggregate_failures, 0) >= 50
     or coalesce(client_failures, 0) >= client_limit
     or coalesce(global_failures, 0) >= 500 then
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

revoke execute on function public.account_resolve_username_signin_v5(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.account_resolve_username_signin_v5(text, text, text, text)
  to service_role;

create or replace function public.account_note_username_signin_failure_v2(
  p_attempt_key text,
  p_client_attempt_key text,
  p_pair_attempt_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, account_private
as $$
declare
  now_value timestamptz := clock_timestamp();
  global_key constant text := encode(sha256(convert_to('global-failure-v5', 'UTF8')), 'hex');
  failure_key text;
begin
  -- Only well-formed per-username/per-client keys; never a shared global counter row; the three keys must differ.
  if coalesce(p_attempt_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_client_attempt_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_pair_attempt_key !~ '^[0-9a-f]{64}$', true)
     or p_attempt_key in (repeat('0', 64), global_key)
     or p_client_attempt_key in (repeat('0', 64), global_key)
     or p_pair_attempt_key in (repeat('0', 64), global_key)
     or p_attempt_key = p_client_attempt_key
     or p_attempt_key = p_pair_attempt_key
     or p_client_attempt_key = p_pair_attempt_key then
    return;
  end if;

  -- Expired rows are removed without waiting on rows another session holds, so cleanup can never join a lock cycle.
  delete from account_private.username_signin_attempts
  where window_started_at <= now_value - interval '15 minutes'
    and attempt_key in (
      select expired.attempt_key
      from account_private.username_signin_attempts expired
      where expired.window_started_at <= now_value - interval '15 minutes'
      for update skip locked
    );

  -- Every writer takes the row locks in this one fixed order (pair, aggregate, client, global), so concurrent failures
  -- for overlapping keys serialize instead of deadlocking.
  foreach failure_key in array array[p_pair_attempt_key, p_attempt_key, p_client_attempt_key, global_key] loop
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

revoke execute on function public.account_note_username_signin_failure_v2(text, text, text)
  from public, anon, authenticated;
grant execute on function public.account_note_username_signin_failure_v2(text, text, text)
  to service_role;

create or replace function account_api.account_resolve_username_signin_v5(
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
  from public.account_resolve_username_signin_v5(
    p_normalized_username,
    p_attempt_key,
    p_client_attempt_key,
    p_pair_attempt_key
  ) resolver;
$$;

revoke execute on function account_api.account_resolve_username_signin_v5(text, text, text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_signin_v5(text, text, text, text)
  to service_role;

create or replace function account_api.account_note_username_signin_failure_v2(
  p_attempt_key text,
  p_client_attempt_key text,
  p_pair_attempt_key text
)
returns void
language sql
security definer
set search_path = pg_catalog, account_api, public
as $$
  select public.account_note_username_signin_failure_v2(p_attempt_key, p_client_attempt_key, p_pair_attempt_key);
$$;

revoke execute on function account_api.account_note_username_signin_failure_v2(text, text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_note_username_signin_failure_v2(text, text, text)
  to service_role;

commit;
