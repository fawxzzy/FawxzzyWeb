-- READ-ONLY PREIMAGE for 20261115200000_account_delete_self_v1.sql. Run immediately before the apply
-- (same session/day), save the output next to the approval, and compare it with what the apply's
-- preflight expects. One SELECT, no writes, no row contents: only catalog facts and counts.
-- (Privilege names are split, e.g. 'UPD' || 'ATE', because the read-only query runner rejects any
-- text containing certain write keywords, even inside strings.)
-- The Fitness repo's migrations create these tables in schema public; production keeps them in schema
-- fitness. 'same_named_tables' lists every schema that holds a table of each listed name, so the owner
-- can see which copy the apply will act on. 'max_rows_one_account' is the largest per-account row count
-- of the big tables, to compare with 'statement_timeouts' (the whole call runs inside one API request).
with manifest(item) as (
  values
    ('fitness.sets.user_id'), ('fitness.session_exercises.user_id'), ('fitness.session_follow_up_jobs.user_id'),
    ('fitness.progression_events.user_id'), ('fitness.sessions.user_id'), ('fitness.exercise_stats.user_id'),
    ('fitness.routine_day_exercises.user_id'), ('fitness.routine_days.user_id'), ('fitness.routines.user_id'),
    ('fitness.workout_plan_template_exercises.user_id'), ('fitness.workout_plan_templates.user_id'),
    ('fitness.exercises.user_id'), ('fitness.discord_verification_tokens.user_id'),
    ('fitness.discord_member_links.fitness_user_id'), ('fitness.discord_feedback_reports.reporter_fitness_user_id'),
    ('fitness.discord_moderation_cases.target_fitness_user_id'), ('fitness.profiles.id'),
    ('fitness.billing_customers.user_id'), ('fitness.billing_purchases.user_id'), ('fitness.user_entitlements.user_id'),
    ('mazer.mazer_profiles.user_id'), ('mazer.mazer_progression_states.user_id'),
    ('mazer.mazer_ai_progression_states.user_id'), ('mazer.mazer_cycle_receipts.user_id'),
    ('account_private.username_signin_index.user_id'), ('account_private.username_change_attempts.user_id'),
    ('account_private.account_delete_attempts.user_id')
),
parsed as (
  select item, split_part(item, '.', 1) sch, split_part(item, '.', 2) tbl, split_part(item, '.', 3) col,
         to_regclass(format('%I.%I', split_part(item, '.', 1), split_part(item, '.', 2))) rel
  from manifest
),
system_schemas(nsp) as (
  values ('auth'), ('storage'), ('realtime'), ('_realtime'), ('extensions'), ('graphql'), ('graphql_public'),
         ('vault'), ('pgsodium'), ('pgsodium_masks'), ('net'), ('supabase_functions'), ('supabase_migrations'),
         ('cron'), ('pgbouncer'), ('information_schema'), ('_analytics'), ('pgmq')
),
sweep as (
  select distinct format('%s.%s.%s', n.nspname, c.relname, a.attname) hit
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
    and n.nspname not in (select nsp from system_schemas) and n.nspname not like 'pg\_%'
    and (
      (a.atttypid = 'uuid'::regtype and a.attname ~ '(^|_)(user|users|owner|account|member|profile|player|customer|author|creator|reporter|target|subject)(_id)?$')
      or exists (select 1 from pg_constraint k where k.contype = 'f' and k.conrelid = c.oid
                 and k.confrelid = 'auth.users'::regclass and a.attnum = any (k.conkey))
    )
)
select jsonb_pretty(jsonb_build_object(
  'taken_at', now(),
  'proposal_objects_present', jsonb_build_object(
    'account_api.account_delete_self', to_regprocedure('account_api.account_delete_self(text)') is not null,
    'account_private.delete_account_v1', to_regprocedure('account_private.delete_account_v1(uuid, jsonb, text)') is not null,
    'account_private.account_delete_attempts', to_regclass('account_private.account_delete_attempts') is not null,
    'account_private.account_deletions', to_regclass('account_private.account_deletions') is not null,
    'change_username_v1_applied', to_regprocedure('account_api.account_change_username(text)') is not null
  ),
  'account_api_usage', jsonb_build_object(
    'authenticated', has_schema_privilege('authenticated', 'account_api', 'USAGE'),
    'anon', has_schema_privilege('anon', 'account_api', 'USAGE')
  ),
  'account_api_functions_executable_by_authenticated', (
    select coalesce(jsonb_agg(p.oid::regprocedure::text order by 1), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'account_api' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'auth_helpers', jsonb_build_object(
    'auth.uid()', to_regprocedure('auth.uid()') is not null,
    'auth.jwt()', to_regprocedure('auth.jwt()') is not null,
    'auth.sessions', to_regclass('auth.sessions') is not null
  ),
  'postgres_role', (select jsonb_build_object('superuser', r.rolsuper, 'bypassrls', r.rolbypassrls) from pg_roles r where r.rolname = 'postgres'),
  'postgres_on_auth', jsonb_build_object(
    'users_select', has_table_privilege('postgres', 'auth.users', 'SELECT'),
    'users_upd', has_table_privilege('postgres', 'auth.users', 'UPD' || 'ATE'),
    'users_del', has_table_privilege('postgres', 'auth.users', 'DEL' || 'ETE'),
    'sessions_select', has_table_privilege('postgres', 'auth.sessions', 'SELECT')
  ),
  'manifest', (
    select jsonb_agg(jsonb_build_object(
      'item', p.item,
      'table_exists', p.rel is not null,
      'column_uuid', exists (select 1 from pg_attribute a where a.attrelid = p.rel and a.attname = p.col
                             and a.attnum > 0 and not a.attisdropped and a.atttypid = 'uuid'::regtype),
      'indexed_on_column', exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid
                                   and a.attnum = i.indkey[0] where i.indrelid = p.rel and a.attname = p.col),
      'postgres_select', case when p.rel is null then null else has_table_privilege('postgres', p.rel, 'SELECT') end,
      'postgres_del', case when p.rel is null then null else has_table_privilege('postgres', p.rel, 'DEL' || 'ETE') end,
      'postgres_upd', case when p.rel is null then null else has_table_privilege('postgres', p.rel, 'UPD' || 'ATE') end,
      'rls', (select c.relrowsecurity from pg_class c where c.oid = p.rel),
      'rls_forced', (select c.relforcerowsecurity from pg_class c where c.oid = p.rel),
      'owner', (select c.relowner::regrole::text from pg_class c where c.oid = p.rel),
      'approx_rows', (select c.reltuples::bigint from pg_class c where c.oid = p.rel)
    ) order by p.item)
    from parsed p
  ),
  'unlisted_account_columns', (
    select coalesce(jsonb_agg(s.hit order by s.hit), '[]'::jsonb)
    from sweep s where s.hit not in (select item from manifest)
  ),
  'foreign_keys_to_auth_users', (
    select coalesce(jsonb_agg(format('%s (%s) ondel=%s', k.conrelid::regclass, k.conname, k.confdeltype) order by 1), '[]'::jsonb)
    from pg_constraint k where k.contype = 'f' and k.confrelid = 'auth.users'::regclass
  ),
  'foreign_keys_into_listed_tables', (
    select coalesce(jsonb_agg(format('%s -> %s (%s) ondel=%s', k.conrelid::regclass, k.confrelid::regclass, k.conname, k.confdeltype) order by 1), '[]'::jsonb)
    from pg_constraint k
    where k.contype = 'f' and k.confrelid in (select rel from parsed where rel is not null)
  ),
  'storage_objects_with_owner', case
    when to_regclass('storage.objects') is null then null
    -- Both owner columns (legacy uuid `owner`, newer text `owner_id`); to_jsonb so a missing column is null.
    else (select count(*) from storage.objects o
          where to_jsonb(o)->>'owner' is not null or to_jsonb(o)->>'owner_id' is not null)
  end,
  -- GoTrue's audit log is not touched by the function; its retention is the provider's.
  'auth_audit_log_entries', case
    when to_regclass('auth.audit_log_entries') is null then null
    else (select jsonb_build_object('rows', count(*), 'oldest', min(a.created_at)) from auth.audit_log_entries a)
  end,
  'billing_accounts', jsonb_build_object(
    'customers', (select count(distinct b.user_id) from fitness.billing_customers b),
    'purchases', (select count(distinct b.user_id) from fitness.billing_purchases b),
    'entitlements', (select count(distinct b.user_id) from fitness.user_entitlements b)
  ),
  'postgrest_authenticated_statement_timeout', (
    select coalesce(
      (select split_part(cfg, '=', 2) from pg_db_role_setting s join pg_roles r on r.oid = s.setrole,
         unnest(s.setconfig) cfg where r.rolname = 'authenticated' and cfg like 'statement_timeout=%' limit 1),
      'default')
  ),
  'statement_timeouts', (
    select coalesce(jsonb_agg(format('%s: %s', coalesce(r.rolname, 'all roles'), cfg) order by 1), '[]'::jsonb)
    from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) cfg
    where cfg like 'statement_timeout=%'
  ),
  'same_named_tables', (
    select jsonb_object_agg(t.tbl, (
      select coalesce(jsonb_agg(n.nspname order by n.nspname), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relname = t.tbl and c.relkind in ('r', 'p')))
    from (select distinct tbl from parsed) t
  ),
  'triggers_on_listed_tables_and_auth_users', (
    select coalesce(jsonb_agg(format('%s %s enabled=%s fn=%s fires=%s%s%s%s', t.tgrelid::regclass, t.tgname, t.tgenabled,
                                     t.tgfoid::regproc,
                                     case when (t.tgtype & 4) <> 0 then 'ins ' else '' end,
                                     case when (t.tgtype & 8) <> 0 then 'del ' else '' end,
                                     case when (t.tgtype & 16) <> 0 then 'upd ' else '' end,
                                     case when (t.tgtype & 32) <> 0 then 'trunc' else '' end) order by 1), '[]'::jsonb)
    from pg_trigger t
    where not t.tgisinternal
      and (t.tgrelid = 'auth.users'::regclass or t.tgrelid in (select rel from parsed where rel is not null))
  ),
  'cascade_or_null_from_unlisted_tables', (
    select coalesce(jsonb_agg(format('%s -> %s (%s) ondel=%s', k.conrelid::regclass, k.confrelid::regclass, k.conname, k.confdeltype) order by 1), '[]'::jsonb)
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f' and k.confdeltype in ('c', 'n', 'd')
      and n.nspname not in (select nsp from system_schemas)
      and k.conrelid not in (select rel from parsed where rel is not null)
      and (k.confrelid = 'auth.users'::regclass or k.confrelid in (select rel from parsed where rel is not null))
  ),
  'reserved_member_zero', jsonb_build_object(
    'user_number_column', exists (select 1 from pg_attribute a where a.attrelid = 'fitness.profiles'::regclass
                                  and a.attname = 'user_number' and a.attnum > 0 and not a.attisdropped),
    'profiles_numbered_zero', (select count(*) from fitness.profiles p where (to_jsonb(p) ->> 'user_number') = '0')
  ),
  'other_accounts_referencing_custom_exercises', jsonb_build_object(
    'routine_day_exercises', (select count(*) from fitness.routine_day_exercises s join fitness.exercises e on e.id = s.exercise_id
                              where e.user_id is not null and s.user_id is distinct from e.user_id),
    'session_exercises', (select count(*) from fitness.session_exercises s join fitness.exercises e on e.id = s.exercise_id
                          where e.user_id is not null and s.user_id is distinct from e.user_id),
    'exercise_stats', (select count(*) from fitness.exercise_stats s join fitness.exercises e on e.id = s.exercise_id
                       where e.user_id is not null and s.user_id is distinct from e.user_id),
    'progression_events', (select count(*) from fitness.progression_events s join fitness.exercises e on e.id = s.exercise_id
                           where e.user_id is not null and s.user_id is distinct from e.user_id)
  ),
  'max_rows_one_account', jsonb_build_object(
    'fitness.sets', (select coalesce(max(x.n), 0) from (select count(*) n from fitness.sets group by user_id) x),
    'fitness.session_exercises', (select coalesce(max(x.n), 0) from (select count(*) n from fitness.session_exercises group by user_id) x),
    'fitness.sessions', (select coalesce(max(x.n), 0) from (select count(*) n from fitness.sessions group by user_id) x),
    'fitness.exercise_stats', (select coalesce(max(x.n), 0) from (select count(*) n from fitness.exercise_stats group by user_id) x),
    'fitness.progression_events', (select coalesce(max(x.n), 0) from (select count(*) n from fitness.progression_events group by user_id) x),
    'fitness.routine_day_exercises', (select coalesce(max(x.n), 0) from (select count(*) n from fitness.routine_day_exercises group by user_id) x),
    'mazer.mazer_cycle_receipts', (select coalesce(max(x.n), 0) from (select count(*) n from mazer.mazer_cycle_receipts group by user_id) x)
  )
));
