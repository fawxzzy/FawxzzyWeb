-- PROPOSED, OWNER-GATED. NOT APPLIED. Lives in supabase/proposed/ (not supabase/migrations/) so no
-- migration runner or Git integration can apply it on merge. Apply only after the owner approves this
-- file by sha256 (see docs/shared-account-portal-phase1.md, "Reset password by username").
--
-- Username password reset v1 (design direction #9): signed out, the reset request takes a USERNAME,
-- never a typed email. The Edge Function username-password-reset maps the username to the account
-- through this function, sends the provider's recovery email to the address on the account, and
-- answers the browser with one fixed response whether or not the username exists.
--
--   account_api.account_resolve_username_reset_v1(
--     p_normalized_username text, p_client_key text, p_pair_key text
--   ) returns table (resolved_user_id uuid, throttled boolean)
--
-- * service_role only (the Edge Function). Never anon or authenticated; the inner function lives in
--   account_private, which PostgREST does not expose.
-- * Every request counts, BEFORE and independent of whether the username exists, so a throttled
--   answer reveals nothing. Order (each step runs only if the previous one passed):
--     1. per-client request counter,              limit 20 per 15 minutes
--     2. per-(username, client) request counter,  limit 5 per 15 minutes
--     3. reset-only shared request counter,       limit 100 per 15 minutes (its own row; never the
--        username sign-in global row repeat('0', 64), so reset traffic cannot throttle sign-in)
-- * No per-username aggregate lock: signed out, this is the only reset path, so a cap any stranger
--   could fill from several addresses would lock the owner out of recovery. Mail volume per account is
--   already capped by the provider (one recovery email per account per 60 seconds) and step 3.
-- * Counters reuse account_private.username_signin_attempts (same 15-minute window; the sign-in
--   functions already delete rows older than 15 minutes, and so does this one). Keys are sha256 hex
--   computed by the Edge Function from namespaced strings ("username-reset-client-v1:...",
--   "username-reset-pair-v1:..."), so they never collide with sign-in keys.
-- * Additive: creates two functions, changes nothing that exists.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $preflight$
begin
  if to_regnamespace('account_api') is null then
    raise exception 'USERNAME_RESET_PREFLIGHT_ACCOUNT_API_MISSING';
  end if;
  if to_regclass('account_private.username_signin_index') is null then
    raise exception 'USERNAME_RESET_PREFLIGHT_SIGNIN_INDEX_MISSING';
  end if;
  if to_regclass('account_private.username_signin_attempts') is null then
    raise exception 'USERNAME_RESET_PREFLIGHT_ATTEMPTS_TABLE_MISSING';
  end if;
  if to_regprocedure('account_private.resolve_username_reset_v1(text, text, text)') is not null
     or to_regprocedure('account_api.account_resolve_username_reset_v1(text, text, text)') is not null then
    raise exception 'USERNAME_RESET_PREFLIGHT_ALREADY_PRESENT';
  end if;
  if not has_schema_privilege('service_role', 'account_api', 'usage') then
    raise exception 'USERNAME_RESET_PREFLIGHT_SERVICE_ROLE_HAS_NO_ACCOUNT_API_USAGE';
  end if;
end;
$preflight$;

create function account_private.resolve_username_reset_v1(
  p_normalized_username text,
  p_client_key text,
  p_pair_key text
)
returns table (resolved_user_id uuid, throttled boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_value timestamptz := pg_catalog.clock_timestamp();
  -- sha256('username-reset-global-v1'): the reset-only shared counter row.
  global_key constant text := '608c73fae58fb41e5747af73c685cc415a7940212c5b616c6d47942f97e2fc5e';
  client_count integer;
  pair_count integer;
  global_count integer;
begin
  -- NULL arguments are invalid (coalesce(..., true)). Caller keys are never a shared counter row
  -- (reset or sign-in) and must differ, so one request cannot be counted twice under one row.
  if coalesce(p_normalized_username !~ '^[a-z0-9._-]{2,15}$', true)
     or coalesce(p_client_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_pair_key !~ '^[0-9a-f]{64}$', true)
     or p_client_key in (global_key, pg_catalog.repeat('0', 64))
     or p_pair_key in (global_key, pg_catalog.repeat('0', 64))
     or p_client_key = p_pair_key then
    return query select null::uuid, false;
    return;
  end if;

  delete from account_private.username_signin_attempts
  where window_started_at <= now_value - interval '15 minutes';

  -- 1. Per-client request counter first, so a client over its own limit touches nothing shared.
  insert into account_private.username_signin_attempts (attempt_key, window_started_at, attempt_count)
  values (p_client_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into client_count;

  if client_count > 20 then
    return query select null::uuid, true;
    return;
  end if;

  -- 2. Per-(username, client) request counter. Counted for unknown usernames exactly like known ones.
  insert into account_private.username_signin_attempts (attempt_key, window_started_at, attempt_count)
  values (p_pair_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into pair_count;

  if pair_count > 5 then
    return query select null::uuid, true;
    return;
  end if;

  -- 3. Reset-only shared counter: only requests that passed steps 1 and 2.
  insert into account_private.username_signin_attempts (attempt_key, window_started_at, attempt_count)
  values (global_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into global_count;

  if global_count > 100 then
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

revoke all on function account_private.resolve_username_reset_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function account_private.resolve_username_reset_v1(text, text, text)
  to service_role;

create function account_api.account_resolve_username_reset_v1(
  p_normalized_username text,
  p_client_key text,
  p_pair_key text
)
returns table (resolved_user_id uuid, throttled boolean)
language sql
security definer
set search_path = ''
as $$
  select resolver.resolved_user_id, resolver.throttled
  from account_private.resolve_username_reset_v1(p_normalized_username, p_client_key, p_pair_key) resolver;
$$;

revoke all on function account_api.account_resolve_username_reset_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_reset_v1(text, text, text)
  to service_role;

do $postcheck$
begin
  if has_function_privilege('anon', 'account_api.account_resolve_username_reset_v1(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'account_api.account_resolve_username_reset_v1(text, text, text)', 'execute')
     or has_function_privilege('anon', 'account_private.resolve_username_reset_v1(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'account_private.resolve_username_reset_v1(text, text, text)', 'execute') then
    raise exception 'USERNAME_RESET_POSTCHECK_REACHABLE_BY_CLIENT_ROLE';
  end if;
  if not has_function_privilege('service_role', 'account_api.account_resolve_username_reset_v1(text, text, text)', 'execute') then
    raise exception 'USERNAME_RESET_POSTCHECK_SERVICE_ROLE_CANNOT_EXECUTE';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
