create or replace function public.account_resolve_username_signin_v2(
  p_normalized_username text,
  p_attempt_key text,
  p_client_attempt_key text
)
returns table (resolved_user_id uuid)
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
  if p_normalized_username !~ '^[a-z0-9._-]{2,15}$'
     or p_attempt_key !~ '^[0-9a-f]{64}$'
     or p_client_attempt_key !~ '^[0-9a-f]{64}$' then
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
    return;
  end if;

  return query
  select username_index.user_id
  from account_private.username_signin_index username_index
  where username_index.normalized_username = p_normalized_username;
end;
$$;

revoke execute on function public.account_resolve_username_signin_v2(text, text, text)
  from public, anon, authenticated;
grant execute on function public.account_resolve_username_signin_v2(text, text, text)
  to service_role;
