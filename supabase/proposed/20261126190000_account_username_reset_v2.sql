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
--   ) returns table (resolved_user_id uuid, throttled boolean, wait_seconds integer, claimed_at timestamptz)
--   account_api.account_release_username_reset_v2(
--     p_normalized_username text, p_claimed_at timestamptz
--   ) returns boolean
--
-- * Same contract as v1 (service_role only; inner functions in account_private, which PostgREST does not
--   expose; same three request counters with the same limits, same reset-only shared row) plus:
-- * Send window, 65 seconds: the provider's own limit is one minute counted from ITS send, which comes a
--   little after our claim (account lookup + provider round trip), so the window carries 5 s of margin.
--   Anchored at the request that claimed it and NOT extended by requests it turns away, so nobody can
--   keep an owner waiting by hammering the window. Keyed by the account id of the username (sha256
--   computed here, so no username, email or account id is stored or logged); a username with no
--   account is keyed by sha256 of the name instead, in the same table and the same steps, so a caller
--   sees the identical "wait" for a known and an unknown username (no existence oracle). A request the
--   window turns away returns wait_seconds > 0 (1..65), resolved_user_id NULL, throttled false, and
--   counts only against the per-client counter (step 1); it is NOT counted against the
--   per-(username, client) counter or the shared row, so waiting never uses up the "one request plus
--   one resend" send cap of v1.
-- * A claim is only a RESERVATION for one provider call, never a lock the caller can hold:
--     - decoy requests (past the v1 send cap, no email goes out) never claim the window;
--     - the Edge Function releases the claim (account_release_username_reset_v2, by the claimed_at the
--       resolver returned) when the provider refuses the call (captcha failed, 4xx other than 429, 5xx,
--       network error), because then no email went out. A 2xx and a 429 keep it (a 429 means the
--       provider holds its own window for the account). So a script with the public key and no valid
--       captcha can hold a username's window only for the length of one in-flight provider call
--       (about a second), and only 2 claims per client address per 15 minutes (the v1 send cap).
--     - if the release never arrives (function instance killed), the window ends by itself after 65 s.
--   Remaining abuse: a caller who passes the captcha really does send the owner one email, and the
--   provider's own minute then applies to the owner anyway.
-- * Order (each step runs only if the previous one passed):
--     1. per-client counter, limit 20 per 15 minutes                     -> throttled
--     2. account lookup (sign-in index probe, same work for every name)
--     3. send window held for this account/name?                          -> wait_seconds
--     4. per-(username, client) counter, limit 5 per 15 minutes           -> throttled
--     5. reset-only shared counter, limit 100 per 15 minutes              -> throttled
--     6. v1 send cap: only the first 2 requests per (username, client) per 15 minutes are real; later
--        ones answer resolved_user_id NULL (decoy), exactly like v1, and do NOT claim the window
--     7. claim the send window (atomic; losing a race answers wait_seconds)
-- * Late clocks: now is read once per call, so a request that STARTED later than another but committed
--   first can compute a wait a little over the window; the answer is clamped to the window length here
--   and again in the Edge Function.
-- * Rows reuse account_private.username_signin_attempts (cleaned after 15 minutes by every resolver
--   call). A stale send-window row (older than the window) is simply taken over by the next claim.
-- * Additive: creates four functions and touches nothing that exists. v1 stays in place, so the
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
     or to_regprocedure('account_api.account_resolve_username_reset_v2(text, text, text)') is not null
     or to_regprocedure('account_private.release_username_reset_v2(text, timestamptz)') is not null
     or to_regprocedure('account_api.account_release_username_reset_v2(text, timestamptz)') is not null then
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
returns table (resolved_user_id uuid, throttled boolean, wait_seconds integer, claimed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_value timestamptz := pg_catalog.clock_timestamp();
  -- sha256('username-reset-global-v1'): the reset-only shared counter row (the same row v1 uses).
  global_key constant text := '608c73fae58fb41e5747af73c685cc415a7940212c5b616c6d47942f97e2fc5e';
  -- The provider sends at most one recovery email per account per minute, counted from its own send,
  -- which comes after our claim: 60 s plus 5 s of margin.
  send_window constant interval := interval '65 seconds';
  send_window_seconds constant integer := 65;
  client_count integer;
  pair_count integer;
  global_count integer;
  account_id uuid;
  send_key text;
  held_since timestamptz;
  claimed_key text;
  is_decoy boolean;
begin
  -- NULL arguments are invalid (coalesce(..., true)). Caller keys are never a shared counter row
  -- (reset or sign-in) and must differ, so one request cannot be counted twice under one row.
  if coalesce(p_normalized_username !~ '^[a-z0-9._-]{2,15}$', true)
     or coalesce(p_client_key !~ '^[0-9a-f]{64}$', true)
     or coalesce(p_pair_key !~ '^[0-9a-f]{64}$', true)
     or p_client_key in (global_key, pg_catalog.repeat('0', 64))
     or p_pair_key in (global_key, pg_catalog.repeat('0', 64))
     or p_client_key = p_pair_key then
    return query select null::uuid, false, 0, null::timestamptz;
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
    return query select null::uuid, true, 0, null::timestamptz;
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
      least(send_window_seconds, greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', held_since + send_window - now_value))::integer)),
      null::timestamptz;
    return;
  end if;

  -- 4. Per-(username, client) request counter. Counted for unknown usernames exactly like known ones.
  insert into account_private.username_signin_attempts (attempt_key, window_started_at, attempt_count)
  values (p_pair_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into pair_count;

  if pair_count > 5 then
    return query select null::uuid, true, 0, null::timestamptz;
    return;
  end if;

  -- 5. Reset-only shared counter: only requests that passed steps 1 and 4.
  insert into account_private.username_signin_attempts (attempt_key, window_started_at, attempt_count)
  values (global_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into global_count;

  if global_count > 100 then
    return query select null::uuid, true, 0, null::timestamptz;
    return;
  end if;

  -- 6. v1 send cap. Past the per-(username, client) send cap no email goes out (decoy, as in v1), so the
  -- request must not claim the send window: a claim nobody sends under would only lock the owner out.
  -- It still answers like every other accepted request (resolved_user_id NULL = the function sends to
  -- the decoy address), after the same steps, so the caller cannot tell it from a real one.
  is_decoy := pair_count > 2;
  if is_decoy then
    return query select null::uuid, false, 0, null::timestamptz;
    return;
  end if;

  -- 7. Claim the send window (a reservation for one provider call; the Edge Function releases it when
  -- the provider refuses the call). Atomic: the row lock makes a concurrent request wait for this one,
  -- then find the window fresh (the update is skipped, no row comes back) and answer wait_seconds.
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
      least(send_window_seconds, greatest(1, pg_catalog.ceil(pg_catalog.date_part('epoch', coalesce(held_since, now_value) + send_window - now_value))::integer)),
      null::timestamptz;
    return;
  end if;

  return query select account_id, false, 0, now_value;
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
returns table (resolved_user_id uuid, throttled boolean, wait_seconds integer, claimed_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select resolver.resolved_user_id, resolver.throttled, resolver.wait_seconds, resolver.claimed_at
  from account_private.resolve_username_reset_v2(p_normalized_username, p_client_key, p_pair_key) resolver;
$$;

revoke all on function account_api.account_resolve_username_reset_v2(text, text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_reset_v2(text, text, text)
  to service_role;

create function account_private.release_username_reset_v2(
  p_normalized_username text,
  p_claimed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid;
  send_key text;
  released integer;
begin
  if coalesce(p_normalized_username !~ '^[a-z0-9._-]{2,15}$', true) or p_claimed_at is null then
    return false;
  end if;

  -- Same key derivation as the claim (account id when the name has an account, else the name).
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

  -- Only the claim the caller made: a window another request has since taken over has a different
  -- start and is left alone. Only send-window rows can match (the key is namespaced), never a counter.
  delete from account_private.username_signin_attempts attempts
  where attempts.attempt_key = send_key
    and attempts.window_started_at = p_claimed_at;
  get diagnostics released = row_count;
  return released > 0;
end;
$$;

revoke all on function account_private.release_username_reset_v2(text, timestamptz)
  from public, anon, authenticated;
grant execute on function account_private.release_username_reset_v2(text, timestamptz)
  to service_role;

create function account_api.account_release_username_reset_v2(
  p_normalized_username text,
  p_claimed_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select account_private.release_username_reset_v2(p_normalized_username, p_claimed_at);
$$;

revoke all on function account_api.account_release_username_reset_v2(text, timestamptz)
  from public, anon, authenticated;
grant execute on function account_api.account_release_username_reset_v2(text, timestamptz)
  to service_role;

do $postcheck$
begin
  if has_function_privilege('anon', 'account_api.account_resolve_username_reset_v2(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'account_api.account_resolve_username_reset_v2(text, text, text)', 'execute')
     or has_function_privilege('anon', 'account_private.resolve_username_reset_v2(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'account_private.resolve_username_reset_v2(text, text, text)', 'execute')
     or has_function_privilege('anon', 'account_api.account_release_username_reset_v2(text, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'account_api.account_release_username_reset_v2(text, timestamptz)', 'execute')
     or has_function_privilege('anon', 'account_private.release_username_reset_v2(text, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'account_private.release_username_reset_v2(text, timestamptz)', 'execute') then
    raise exception 'USERNAME_RESET_V2_POSTCHECK_REACHABLE_BY_CLIENT_ROLE';
  end if;
  if not has_function_privilege('service_role', 'account_api.account_resolve_username_reset_v2(text, text, text)', 'execute')
     or not has_function_privilege('service_role', 'account_api.account_release_username_reset_v2(text, timestamptz)', 'execute') then
    raise exception 'USERNAME_RESET_V2_POSTCHECK_SERVICE_ROLE_CANNOT_EXECUTE';
  end if;
  if to_regprocedure('account_api.account_resolve_username_reset_v1(text, text, text)') is null then
    raise exception 'USERNAME_RESET_V2_POSTCHECK_V1_GONE';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
