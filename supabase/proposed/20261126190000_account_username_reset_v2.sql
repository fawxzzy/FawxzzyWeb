-- PROPOSED, OWNER-GATED. NOT APPLIED. Lives in supabase/proposed/ (not supabase/migrations/) so no
-- migration runner or Git integration can apply it on merge. Apply only after the owner approves this
-- file by sha256 (see docs/shared-account-portal-phase1.md, "Reset password by username").
--
-- Username password reset v2: v1 plus a per-ACCOUNT send window, so a repeat request from a DIFFERENT
-- browser inside the email provider's own one-recovery-email-per-minute limit is answered "wait" instead
-- of "sent" (the provider refuses silently, so nothing goes out and the form used to say it did).
--
--   account_api.account_resolve_username_reset_v2(
--     p_normalized_username text, p_client_key text, p_pair_key text
--   ) returns table (resolved_user_id uuid, throttled boolean, wait_seconds integer)
--
-- * Same contract as v1 (service_role only; inner function in account_private, which PostgREST does not
--   expose; same three request counters with the same limits, same reset-only shared row) plus:
-- * Send window, 60 seconds, anchored at the request that claimed it and NOT extended by requests it
--   turns away, so nobody can keep an owner waiting by hammering the window. Keyed by the account id of
--   the username (sha256 computed here, so no username, email or account id is stored or logged); a
--   username with no account is keyed by sha256 of the name instead, in the same table and the same
--   steps, so a caller sees the identical "wait" for a known and an unknown username (no existence
--   oracle). A request the window turns away returns wait_seconds > 0, resolved_user_id NULL,
--   throttled false, and is NOT counted against the per-(username, client) counter, so waiting never
--   uses up the "one request plus one resend" send cap of v1.
-- * Order (each step runs only if the previous one passed):
--     1. per-client counter, limit 20 per 15 minutes                     -> throttled
--     2. account lookup (sign-in index probe, same work for every name)
--     3. send window held for this account/name?                          -> wait_seconds
--     4. per-(username, client) counter, limit 5 per 15 minutes           -> throttled
--     5. reset-only shared counter, limit 100 per 15 minutes              -> throttled
--     6. claim the send window (atomic; losing a race answers wait_seconds)
--     7. v1 send cap: only the first 2 requests per (username, client) per 15 minutes get the account
--        back; later ones answer resolved_user_id NULL (decoy), exactly like v1.
-- * Rows reuse account_private.username_signin_attempts (cleaned after 15 minutes by every resolver
--   call). A stale send-window row (older than 60 s) is simply taken over by the next claim.
-- * Additive: creates two functions and touches nothing that exists. v1 stays in place, so the
--   currently deployed Edge Function keeps working until the new one is deployed, and a function
--   rollback needs no SQL change. Apply this file BEFORE deploying the new function.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $preflight$
begin
  if to_regnamespace('account_api') is null then
    raise exception 'USERNAME_RESET_V2_PREFLIGHT_ACCOUNT_API_MISSING';
  end if;
  if to_regclass('account_private.username_signin_index') is null then
    raise exception 'USERNAME_RESET_V2_PREFLIGHT_SIGNIN_INDEX_MISSING';
  end if;
  if to_regclass('account_private.username_signin_attempts') is null then
    raise exception 'USERNAME_RESET_V2_PREFLIGHT_ATTEMPTS_TABLE_MISSING';
  end if;
  if to_regprocedure('account_api.account_resolve_username_reset_v1(text, text, text)') is null
     or to_regprocedure('account_private.resolve_username_reset_v1(text, text, text)') is null then
    raise exception 'USERNAME_RESET_V2_PREFLIGHT_V1_MISSING';
  end if;
  if to_regprocedure('account_private.resolve_username_reset_v2(text, text, text)') is not null
     or to_regprocedure('account_api.account_resolve_username_reset_v2(text, text, text)') is not null then
    raise exception 'USERNAME_RESET_V2_PREFLIGHT_ALREADY_PRESENT';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'USERNAME_RESET_V2_PREFLIGHT_SHA256_MISSING';
  end if;
  if not has_schema_privilege('service_role', 'account_api', 'usage') then
    raise exception 'USERNAME_RESET_V2_PREFLIGHT_SERVICE_ROLE_HAS_NO_ACCOUNT_API_USAGE';
  end if;
end;
$preflight$;

create function account_private.resolve_username_reset_v2(
  p_normalized_username text,
  p_client_key text,
  p_pair_key text
)
returns table (resolved_user_id uuid, throttled boolean, wait_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_value timestamptz := pg_catalog.clock_timestamp();
  -- sha256('username-reset-global-v1'): the reset-only shared counter row (the same row v1 uses).
  global_key constant text := '608c73fae58fb41e5747af73c685cc415a7940212c5b616c6d47942f97e2fc5e';
  -- The provider sends at most one recovery email per account per minute.
  send_window constant interval := interval '60 seconds';
  client_count integer;
  pair_count integer;
  global_count integer;
  account_id uuid;
  send_key text;
  held_since timestamptz;
  claimed_key text;
begin
  -- NULL arguments are invalid (coalesce(..., true)). Caller keys are never a shared counter row
  -- (reset or sign-in) and must differ, so one request cannot be counted twice under one row.
  if coalesce(p_normalized_username !~ '^[a-z0-9._-]{2,15}$', true)
     or coalesce(p_client_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_pair_key !~ '^[0-9a-f]{64}$', true)
     or p_client_key in (global_key, pg_catalog.repeat('0', 64))
     or p_pair_key in (global_key, pg_catalog.repeat('0', 64))
     or p_client_key = p_pair_key then
    return query select null::uuid, false, 0;
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
    return query select null::uuid, true, 0;
    return;
  end if;

  -- 2. The index probe runs for every request (same work for known and unknown names). The send-window
  -- key is derived from the account id when there is one, else from the name, in one namespace, so
  -- the steps below are identical for both.
  select username_index.user_id
  into account_id
  from account_private.username_signin_index username_index
  where username_index.normalized_username = p_normalized_username;

  send_key := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        'username-reset-send-v2:' ||
          case when account_id is null then 'name:' || p_normalized_username else 'account:' || account_id::text end,
        'utf8'
      )
    ),
    'hex'
  );

  -- 3. Is this account's send window held? Read only: a request turned away here changes nothing, so it
  -- neither extends the window nor uses up the send cap in step 7.
  select attempts.window_started_at
  into held_since
  from account_private.username_signin_attempts attempts
  where attempts.attempt_key = send_key;

  if held_since is not null and held_since > now_value - send_window then
    return query select
      null::uuid,
      false,
      greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', held_since + send_window - now_value))::integer);
    return;
  end if;

  -- 4. Per-(username, client) request counter. Counted for unknown usernames exactly like known ones.
  insert into account_private.username_signin_attempts (attempt_key, window_started_at, attempt_count)
  values (p_pair_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into pair_count;

  if pair_count > 5 then
    return query select null::uuid, true, 0;
    return;
  end if;

  -- 5. Reset-only shared counter: only requests that passed steps 1 and 4.
  insert into account_private.username_signin_attempts (attempt_key, window_started_at, attempt_count)
  values (global_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into global_count;

  if global_count > 100 then
    return query select null::uuid, true, 0;
    return;
  end if;

  -- 6. Claim the send window. Atomic: the row lock makes a concurrent request wait for this one, then
  -- find the window fresh (the update is skipped, no row comes back) and answer wait_seconds.
  insert into account_private.username_signin_attempts as attempts (attempt_key, window_started_at, attempt_count)
  values (send_key, now_value, 1)
  on conflict (attempt_key) do update
    set window_started_at = excluded.window_started_at,
        attempt_count = 1
    where attempts.window_started_at <= now_value - send_window
  returning attempts.attempt_key into claimed_key;

  if claimed_key is null then
    select attempts.window_started_at
    into held_since
    from account_private.username_signin_attempts attempts
    where attempts.attempt_key = send_key;

    return query select
      null::uuid,
      false,
      greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', coalesce(held_since, now_value) + send_window - now_value))::integer);
    return;
  end if;

  -- 7. Past the per-(username, client) send cap the account is withheld (decoy), as in v1.
  return query select case when pair_count > 2 then null::uuid else account_id end, false, 0;
end;
$$;

revoke all on function account_private.resolve_username_reset_v2(text, text, text)
  from public, anon, authenticated;
grant execute on function account_private.resolve_username_reset_v2(text, text, text)
  to service_role;

create function account_api.account_resolve_username_reset_v2(
  p_normalized_username text,
  p_client_key text,
  p_pair_key text
)
returns table (resolved_user_id uuid, throttled boolean, wait_seconds integer)
language sql
security definer
set search_path = ''
as $$
  select resolver.resolved_user_id, resolver.throttled, resolver.wait_seconds
  from account_private.resolve_username_reset_v2(p_normalized_username, p_client_key, p_pair_key) resolver;
$$;

revoke all on function account_api.account_resolve_username_reset_v2(text, text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_reset_v2(text, text, text)
  to service_role;

do $postcheck$
begin
  if has_function_privilege('anon', 'account_api.account_resolve_username_reset_v2(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'account_api.account_resolve_username_reset_v2(text, text, text)', 'execute')
     or has_function_privilege('anon', 'account_private.resolve_username_reset_v2(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'account_private.resolve_username_reset_v2(text, text, text)', 'execute') then
    raise exception 'USERNAME_RESET_V2_POSTCHECK_REACHABLE_BY_CLIENT_ROLE';
  end if;
  if not has_function_privilege('service_role', 'account_api.account_resolve_username_reset_v2(text, text, text)', 'execute') then
    raise exception 'USERNAME_RESET_V2_POSTCHECK_SERVICE_ROLE_CANNOT_EXECUTE';
  end if;
  if to_regprocedure('account_api.account_resolve_username_reset_v1(text, text, text)') is null then
    raise exception 'USERNAME_RESET_V2_POSTCHECK_V1_GONE';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
