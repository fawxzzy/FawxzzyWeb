-- READ-ONLY PREIMAGE for 20261126190000_account_username_reset_v2.sql. Run immediately before the apply
-- (same session/day), save the output next to the approval, and check 'blocking' is empty. One SELECT,
-- no writes, no row contents: only catalog facts and counts.
-- (Run through the read-only query runner, which rejects some write words even inside text, so none
-- of those words appear below.)
with reset_fns as (
  select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
         md5(p.prosrc) as body_md5, p.prosecdef as definer, p.proconfig as fn_config,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
         has_function_privilege('service_role', p.oid, 'execute') as service_role_exec,
         pg_get_userbyid(p.proowner) as owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('account_api', 'account_private')
    and p.proname like '%username_reset%'
),
attempts_cols as (
  select string_agg(attname || ' ' || format_type(atttypid, atttypmod) || case when attnotnull then ' not null' else '' end,
                    ', ' order by attnum) as columns
  from pg_attribute
  where attrelid = to_regclass('account_private.username_signin_attempts') and attnum > 0 and not attisdropped
),
attempts_constraints as (
  select string_agg(conname || ': ' || pg_get_constraintdef(oid), ' | ' order by conname) as constraints
  from pg_constraint
  where conrelid = to_regclass('account_private.username_signin_attempts')
)
select
  (select version()) as server_version,
  (select encode(sha256('abc'::bytea), 'hex')) as sha256_builtin_abc,
  (select coalesce(jsonb_agg(to_jsonb(f) - 'oid' order by f.signature), '[]'::jsonb) from reset_fns f) as reset_functions,
  to_regclass('account_private.username_signin_attempts') is not null as attempts_table_present,
  to_regclass('account_private.username_signin_index') is not null as signin_index_present,
  (select columns from attempts_cols) as attempts_columns,
  (select constraints from attempts_constraints) as attempts_constraints,
  has_table_privilege('service_role', 'account_private.username_signin_attempts', 'select') as service_role_can_read_attempts,
  has_table_privilege('anon', 'account_private.username_signin_attempts', 'select') as anon_can_read_attempts,
  has_table_privilege('authenticated', 'account_private.username_signin_attempts', 'select') as authenticated_can_read_attempts,
  (select count(*) from account_private.username_signin_attempts) as attempts_rows,
  (select count(*) from account_private.username_signin_index) as signin_index_rows,
  has_schema_privilege('service_role', 'account_api', 'usage') as service_role_account_api_usage,
  to_regprocedure('account_private.resolve_username_reset_v2(text, text, text)') is not null as v2_inner_present,
  to_regprocedure('account_api.account_resolve_username_reset_v2(text, text, text)') is not null as v2_api_present,
  (
    select coalesce(jsonb_agg(reason), '[]'::jsonb) from (
      select 'v1 resolver (account_api) missing' as reason
        where to_regprocedure('account_api.account_resolve_username_reset_v1(text, text, text)') is null
      union all select 'v1 resolver (account_private) missing'
        where to_regprocedure('account_private.resolve_username_reset_v1(text, text, text)') is null
      union all select 'attempts table missing' where to_regclass('account_private.username_signin_attempts') is null
      union all select 'sign-in index missing' where to_regclass('account_private.username_signin_index') is null
      union all select 'v2 already present'
        where to_regprocedure('account_private.resolve_username_reset_v2(text, text, text)') is not null
           or to_regprocedure('account_api.account_resolve_username_reset_v2(text, text, text)') is not null
      union all select 'sha256(bytea) builtin missing' where to_regprocedure('pg_catalog.sha256(bytea)') is null
    ) r
  ) as blocking;
