create schema if not exists account_api;

revoke all on schema account_api from public, anon, authenticated;
grant usage on schema account_api to service_role;

create or replace function account_api.account_resolve_username_signin_v2(
  p_normalized_username text,
  p_attempt_key text,
  p_client_attempt_key text
)
returns table (resolved_user_id uuid)
language sql
security definer
set search_path = pg_catalog, account_api, public
as $$
  select resolver.resolved_user_id
  from public.account_resolve_username_signin_v2(
    p_normalized_username,
    p_attempt_key,
    p_client_attempt_key
  ) resolver;
$$;

revoke execute on function account_api.account_resolve_username_signin_v2(text, text, text)
  from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_signin_v2(text, text, text)
  to service_role;
