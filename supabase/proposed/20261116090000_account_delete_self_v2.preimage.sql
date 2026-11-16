-- READ-ONLY PREIMAGE for 20261116090000_account_delete_self_v2.sql. Run immediately before the apply
-- (same session/day), save the output next to the approval, and check 'blocking' is empty. One SELECT,
-- no writes, no row contents: only catalog facts and counts.
-- (Privilege names and some words are split, e.g. 'UPD' || 'ATE', because the read-only query runner
-- rejects any text containing certain write keywords, even inside strings.)
-- 'blocking' repeats the apply's preflight refusals that can be computed read-only. 'known_retained'
-- shows, per kept-on-purpose column, how many rows it has and how many name a LIVE account
-- (owner decision 2026-11-16: "Delete live data, keep archives"); null = postgres can not read it.
with manifest(item, kind) as (
  values
    ('fitness.sets.user_id', 'remove'), ('fitness.session_exercises.user_id', 'remove'),
    ('fitness.session_follow_up_jobs.user_id', 'remove'), ('fitness.progression_events.user_id', 'remove'),
    ('fitness.sessions.user_id', 'remove'), ('fitness.exercise_stats.user_id', 'remove'),
    ('fitness.routine_day_exercises.user_id', 'remove'), ('fitness.routine_days.user_id', 'remove'),
    ('fitness.routines.user_id', 'remove'), ('fitness.workout_plan_template_exercises.user_id', 'remove'),
    ('fitness.workout_plan_templates.user_id', 'remove'), ('fitness.exercises.user_id', 'remove'),
    ('fitness.discord_verification_tokens.user_id', 'remove'), ('fitness.discord_member_links.fitness_user_id', 'remove'),
    ('fitness.discord_feedback_reports.reporter_fitness_user_id', 'unlink'),
    ('fitness.discord_moderation_cases.target_fitness_user_id', 'unlink'),
    ('discordos.discord_feedback_reports.reporter_fitness_user_id', 'unlink_text'),
    ('fitness.profiles.id', 'remove'),
    ('fitness.billing_customers.user_id', 'billing'), ('fitness.billing_purchases.user_id', 'billing'),
    ('fitness.user_entitlements.user_id', 'billing'),
    ('mazer.mazer_profiles.user_id', 'remove'), ('mazer.mazer_progression_states.user_id', 'remove'),
    ('mazer.mazer_ai_progression_states.user_id', 'remove'), ('mazer.mazer_cycle_receipts.user_id', 'remove'),
    ('mazer.mazer_register_failures.user_id', 'remove'),
    ('account_private.username_signin_index.user_id', 'remove'),
    ('account_private.username_change_attempts.user_id', 'optional'),
    ('account_private.account_delete_attempts.user_id', 'optional')
),
parsed as (
  select item, kind, split_part(item, '.', 1) sch, split_part(item, '.', 2) tbl, split_part(item, '.', 3) col,
         to_regclass(format('%I.%I', split_part(item, '.', 1), split_part(item, '.', 2))) rel
  from manifest
),
fk_effects(item, action) as (
  values ('account_private.username_signin_candidates.user_id', 'c'), ('platform.identity_map.auth_user_id', 'n')
),
retained(item) as (
  values
    ('account_private.username_collision_resolution_backup.user_id'), ('account_private.username_shorten_backup.user_id'),
    ('atlas_identity_migration.mapping_wave2_rollback.before_canonical_user_id'),
    ('atlas_identity_migration.mapping_wave2_rollback.source_user_id'), ('atlas_identity_migration.packet_rollback.user_id'),
    ('atlas_identity_migration.source_identity_map.canonical_user_id'), ('atlas_identity_migration.source_identity_map.source_user_id'),
    ('atlas_migration_auth_data_r001.identity_map.canonical_auth_user_id'),
    ('atlas_migration_auth_data_r001.private_auth_payload.canonical_auth_user_id'),
    ('fitness_archive.billing_customers.user_id'), ('fitness_archive.billing_purchases.user_id'),
    ('fitness_archive.discord_feedback_reports.reporter_fitness_user_id'), ('fitness_archive.discord_member_links.fitness_user_id'),
    ('fitness_archive.discord_moderation_cases.target_fitness_user_id'), ('fitness_archive.discord_verification_tokens.user_id'),
    ('fitness_archive.exercise_stats.user_id'), ('fitness_archive.exercises.user_id'), ('fitness_archive.progression_events.user_id'),
    ('fitness_archive.routine_day_exercises.user_id'), ('fitness_archive.routine_days.user_id'), ('fitness_archive.routines.user_id'),
    ('fitness_archive.session_exercises.user_id'), ('fitness_archive.session_follow_up_jobs.user_id'), ('fitness_archive.sessions.user_id'),
    ('fitness_archive.sets.user_id'), ('fitness_archive.user_entitlements.user_id'),
    ('fitness_archive.workout_plan_template_exercises.user_id'), ('fitness_archive.workout_plan_templates.user_id'),
    ('mazer.mazer_identity_map.legacy_user_id'), ('mazer.mazer_identity_map.master_user_id'),
    ('mazer.mazer_register_all_backfill_20261112.user_id'), ('mazer.mazer_username_backfill_20261112.user_id'),
    ('platform_private.operations_operator_grants.subject'), ('platform_private.operations_sessions.subject')
),
reviewed_triggers(pin) as (
  values
    ('auth.users|sync_username_signin_index|account_private.sync_username_signin_index|b9b39b13b97ce3ac15daabe487600ff7|29'),
    ('fitness.routine_day_exercises|routine_day_exercises_repack_after_delete|fitness.repack_routine_day_exercise_positions_after_delete|af1c93d5b67733b5489d5d919ec55700|9'),
    ('fitness.session_exercises|session_exercises_repack_after_delete|fitness.repack_session_exercise_positions_after_delete|7b4e4b9cf32bf6e0bf107d7ae645fce5|9'),
    ('discordos.discord_feedback_reports|set_discord_feedback_reports_updated_at|discordos.set_updated_at|9b1889f56258bf9d6554213c05019c76|19')
),
system_schemas(nsp) as (
  values ('auth'), ('storage'), ('realtime'), ('_realtime'), ('extensions'), ('graphql'), ('graphql_public'),
         ('vault'), ('pgsodium'), ('pgsodium_masks'), ('net'), ('supabase_functions'), ('supabase_migrations'),
         ('cron'), ('pgbouncer'), ('information_schema'), ('_analytics'), ('pgmq')
),
delete_rels as (
  select rel from parsed where rel is not null and kind in ('remove', 'optional')
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
      or a.attname ~ '(^|_)(fitness|auth|account|canonical|master|legacy|source)_user_id$'
      or exists (select 1 from pg_constraint k where k.contype = 'f' and k.conrelid = c.oid
                 and k.confrelid = 'auth.users'::regclass and a.attnum = any (k.conkey))
    )
),
unknown_columns as (
  select hit from sweep
  where hit not in (select item from manifest) and hit not in (select item from fk_effects)
    and hit not in (select item from retained)
),
fk_effect_found as (
  select e.item, e.action,
         (select count(*) from pg_constraint k
          join pg_attribute a on a.attrelid = k.conrelid and a.attname = split_part(e.item, '.', 3)
          where k.contype = 'f'
            and k.conrelid = to_regclass(format('%I.%I', split_part(e.item, '.', 1), split_part(e.item, '.', 2)))
            and k.confrelid = 'auth.users'::regclass and k.conkey = array[a.attnum]
            and k.confdeltype = e.action::"char") as matching_keys,
         (select coalesce(jsonb_agg(format('%s (%s) ondel=%s', k.conrelid::regclass, k.conname, k.confdeltype)), '[]'::jsonb)
          from pg_constraint k
          join pg_attribute a on a.attrelid = k.confrelid and a.attnum = any (k.confkey)
          where k.contype = 'f'
            and k.confrelid = to_regclass(format('%I.%I', split_part(e.item, '.', 1), split_part(e.item, '.', 2)))
            and (e.action = 'c' or a.attname = split_part(e.item, '.', 3))) as referenced_by
  from fk_effects e
),
unexpected_cascades as (
  select format('%s -> %s (%s) ondel=%s', k.conrelid::regclass, k.confrelid::regclass, k.conname, k.confdeltype) fk
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where k.contype = 'f' and k.confdeltype in ('c', 'n', 'd')
    and n.nspname not in (select nsp from system_schemas)
    and k.conrelid not in (select rel from parsed where rel is not null)
    and (k.confrelid = 'auth.users'::regclass or k.confrelid in (select rel from delete_rels))
    and not exists (
      select 1 from fk_effects e
      where k.conrelid = to_regclass(format('%I.%I', split_part(e.item, '.', 1), split_part(e.item, '.', 2)))
        and k.confrelid = 'auth.users'::regclass and k.confdeltype = e.action::"char")
),
firing_triggers as (
  select format('%s.%s|%s|%s.%s|%s|%s', n.nspname, c.relname, t.tgname, pn.nspname, p.proname, md5(p.prosrc), t.tgtype) pin,
         p.prosecdef as definer
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal
    and (((t.tgtype & 8) <> 0 and (t.tgrelid in (select rel from delete_rels)
                                   or t.tgrelid in ('auth.users'::regclass, 'account_private.username_signin_candidates'::regclass)))
      or ((t.tgtype & 16) <> 0 and (t.tgrelid in (select rel from parsed where kind like 'unlink%')
                                    or t.tgrelid = 'platform.identity_map'::regclass)))
),
storage_state as (
  select c.relrowsecurity rls, c.relforcerowsecurity forced, c.relowner::regrole::text owner,
         r.rolsuper or r.rolbypassrls as postgres_bypasses,
         (c.relrowsecurity and not (r.rolsuper or r.rolbypassrls) and (c.relowner <> r.oid or c.relforcerowsecurity)) as rows_hidden_from_postgres
  from pg_class c, pg_roles r
  where c.oid = to_regclass('storage.objects') and r.rolname = 'postgres'
),
facts as (
  select
    jsonb_build_object(
      'account_api.account_delete_self', to_regprocedure('account_api.account_delete_self(text)') is not null,
      'account_private.delete_account_v1', to_regprocedure('account_private.delete_account_v1(uuid, jsonb, text)') is not null,
      'account_private.delete_account_v2', to_regprocedure('account_private.delete_account_v2(uuid, jsonb, text)') is not null,
      'account_private.account_delete_attempts', to_regclass('account_private.account_delete_attempts') is not null
    ) as present,
    (select coalesce(jsonb_agg(hit order by hit), '[]'::jsonb) from unknown_columns) as unknown,
    (select coalesce(jsonb_agg(fk order by fk), '[]'::jsonb) from unexpected_cascades) as cascades,
    (select coalesce(jsonb_agg(f.pin order by f.pin), '[]'::jsonb) from firing_triggers f
      where f.pin not in (select pin from reviewed_triggers)) as unreviewed,
    (select coalesce(jsonb_agg(f.item), '[]'::jsonb) from fk_effect_found f
      where f.matching_keys <> 1 or f.referenced_by <> '[]'::jsonb) as fk_effect_problems,
    (select coalesce(jsonb_agg(p.item order by p.item), '[]'::jsonb) from parsed p
      where p.kind <> 'optional' and (p.rel is null or not exists (
        select 1 from pg_attribute a where a.attrelid = p.rel and a.attname = p.col and a.attnum > 0 and not a.attisdropped
          and a.atttypid = (case when p.kind = 'unlink_text' then 'text' else 'uuid' end)::regtype))) as listed_missing,
    (select coalesce(jsonb_agg(p.item order by p.item), '[]'::jsonb) from parsed p
      where p.rel is not null and (
        not has_table_privilege('postgres', p.rel, 'SELECT')
        or (p.kind like 'unlink%' and not has_table_privilege('postgres', p.rel, 'UPD' || 'ATE'))
        or (p.kind in ('remove', 'optional') and (not has_table_privilege('postgres', p.rel, 'DEL' || 'ETE')
                                                  or not has_table_privilege('postgres', p.rel, 'UPD' || 'ATE'))))) as privilege_gaps,
    (select coalesce(jsonb_agg(p.item order by p.item), '[]'::jsonb) from parsed p join pg_class c on c.oid = p.rel
      where c.relrowsecurity and not (select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'postgres')
        and (c.relforcerowsecurity or c.relowner <> (select oid from pg_roles where rolname = 'postgres'))) as rls_hidden,
    (select s.rows_hidden_from_postgres from storage_state s) as storage_hidden,
    case when to_regclass('storage.objects') is null then 0
         else (select count(*) from storage.objects o
               where to_jsonb(o)->>'owner' is not null or to_jsonb(o)->>'owner_id' is not null) end as storage_owned
)
select jsonb_pretty(jsonb_build_object(
  'taken_at', now(),
  'blocking', (
    select coalesce(jsonb_agg(b) filter (where b is not null), '[]'::jsonb) from facts f, lateral (values
      (case when (select bool_or(v::boolean) from jsonb_each_text(f.present) e(k, v)) then 'v1 or v2 objects present' end),
      (case when f.unknown <> '[]'::jsonb then 'unknown account columns' end),
      (case when f.cascades <> '[]'::jsonb then 'unexpected cascade or null action' end),
      (case when f.unreviewed <> '[]'::jsonb then 'unreviewed triggers' end),
      (case when f.fk_effect_problems <> '[]'::jsonb then 'expected fk effects differ' end),
      (case when f.listed_missing <> '[]'::jsonb then 'listed table/column missing or wrong type' end),
      (case when f.privilege_gaps <> '[]'::jsonb then 'postgres lacks a privilege' end),
      (case when f.rls_hidden <> '[]'::jsonb then 'rls hides listed rows' end),
      (case when coalesce(f.storage_hidden, false) then 'storage rows hidden from postgres' end),
      (case when f.storage_owned > 0 then 'storage has owned files' end),
      (case when has_schema_privilege('anon', 'account_api', 'USAGE') then 'anon has account_api usage' end)
    ) v(b)
  ),
  'proposal_objects_present', (select present from facts) || jsonb_build_object(
    'account_private.account_deletions', to_regclass('account_private.account_deletions') is not null,
    'change_username_v1_applied', to_regprocedure('account_api.account_change_username(text)') is not null
  ),
  'unknown_account_columns', (select unknown from facts),
  'unexpected_cascades', (select cascades from facts),
  'unreviewed_triggers', (select unreviewed from facts),
  'listed_missing_or_wrong_type', (select listed_missing from facts),
  'postgres_privilege_gaps', (select privilege_gaps from facts),
  'rls_hides_listed_rows', (select rls_hidden from facts),
  'account_api_usage', jsonb_build_object(
    'authenticated', has_schema_privilege('authenticated', 'account_api', 'USAGE'),
    'anon', has_schema_privilege('anon', 'account_api', 'USAGE')
  ),
  'account_api_functions_executable_by_authenticated', (
    select coalesce(jsonb_agg(p.oid::regprocedure::text order by 1), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'account_api' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'postgres_role', (select jsonb_build_object('superuser', r.rolsuper, 'bypassrls', r.rolbypassrls) from pg_roles r where r.rolname = 'postgres'),
  'manifest', (
    select jsonb_agg(jsonb_build_object(
      'item', p.item, 'kind', p.kind,
      'table_exists', p.rel is not null,
      'column_type', (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                      where a.attrelid = p.rel and a.attname = p.col and a.attnum > 0 and not a.attisdropped),
      'indexed_on_column', exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid
                                   and a.attnum = i.indkey[0] where i.indrelid = p.rel and a.attname = p.col),
      'rls', (select c.relrowsecurity from pg_class c where c.oid = p.rel),
      'rls_forced', (select c.relforcerowsecurity from pg_class c where c.oid = p.rel),
      'owner', (select c.relowner::regrole::text from pg_class c where c.oid = p.rel),
      'approx_rows', (select c.reltuples::bigint from pg_class c where c.oid = p.rel)
    ) order by p.item)
    from parsed p
  ),
  'expected_fk_effects', (
    select jsonb_agg(jsonb_build_object(
      'item', f.item, 'ondelete', f.action, 'matching_keys', f.matching_keys, 'referenced_by', f.referenced_by,
      'rows', (xpath('/row/n/text()', query_to_xml(format('select count(*) n from %s', to_regclass(split_part(f.item, '.', 1) || '.' || split_part(f.item, '.', 2))), false, true, '')))[1]::text::bigint,
      'rows_naming_live_accounts', (xpath('/row/n/text()', query_to_xml(format(
          'select count(*) n from %s t where t.%I in (select u.id from auth.users u)',
          to_regclass(split_part(f.item, '.', 1) || '.' || split_part(f.item, '.', 2)), split_part(f.item, '.', 3)), false, true, '')))[1]::text::bigint
    ) order by f.item)
    from fk_effect_found f
  ),
  'known_retained', (
    select jsonb_agg(jsonb_build_object(
      'item', r.item,
      'type', (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
               where a.attrelid = to_regclass(split_part(r.item, '.', 1) || '.' || split_part(r.item, '.', 2))
                 and a.attname = split_part(r.item, '.', 3) and a.attnum > 0 and not a.attisdropped),
      'rows', case when to_regclass(split_part(r.item, '.', 1) || '.' || split_part(r.item, '.', 2)) is null then null
                   when not has_table_privilege(current_user, to_regclass(split_part(r.item, '.', 1) || '.' || split_part(r.item, '.', 2)), 'SELECT') then null
                   else (xpath('/row/n/text()', query_to_xml(format('select count(*) n from %s',
                          to_regclass(split_part(r.item, '.', 1) || '.' || split_part(r.item, '.', 2))), false, true, '')))[1]::text::bigint end,
      'rows_naming_live_accounts', case when to_regclass(split_part(r.item, '.', 1) || '.' || split_part(r.item, '.', 2)) is null then null
                   when not has_table_privilege(current_user, to_regclass(split_part(r.item, '.', 1) || '.' || split_part(r.item, '.', 2)), 'SELECT') then null
                   else (xpath('/row/n/text()', query_to_xml(format('select count(*) n from %s t where t.%I::text in (select u.id::text from auth.users u)',
                          to_regclass(split_part(r.item, '.', 1) || '.' || split_part(r.item, '.', 2)), split_part(r.item, '.', 3)), false, true, '')))[1]::text::bigint end,
      'live_tuples_stat', (select s.n_live_tup from pg_stat_user_tables s
                           where s.relid = to_regclass(split_part(r.item, '.', 1) || '.' || split_part(r.item, '.', 2)))
    ) order by r.item)
    from retained r
  ),
  'discordos_text_link', jsonb_build_object(
    'rows_with_link', (select count(*) from discordos.discord_feedback_reports d where d.reporter_fitness_user_id is not null),
    'rows_naming_live_accounts', (select count(*) from discordos.discord_feedback_reports d
                                  where d.reporter_fitness_user_id in (select u.id::text from auth.users u))
  ),
  'triggers_firing_here', (select coalesce(jsonb_agg(jsonb_build_object('pin', f.pin, 'definer', f.definer) order by f.pin), '[]'::jsonb) from firing_triggers f),
  'auth_users_triggers', (
    select coalesce(jsonb_agg(format('%s type=%s fn=%s', t.tgname, t.tgtype, t.tgfoid::regproc) order by t.tgname), '[]'::jsonb)
    from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
  ),
  'storage', (select to_jsonb(s) from storage_state s) || jsonb_build_object('objects_with_owner', (select storage_owned from facts)),
  'auth_audit_log_entries', case
    when to_regclass('auth.audit_log_entries') is null then null
    else (select jsonb_build_object('rows', count(*), 'oldest', min(a.created_at)) from auth.audit_log_entries a)
  end,
  'billing_accounts', jsonb_build_object(
    'customers', (select count(distinct b.user_id) from fitness.billing_customers b),
    'purchases', (select count(distinct b.user_id) from fitness.billing_purchases b),
    'entitlements', (select count(distinct b.user_id) from fitness.user_entitlements b)
  ),
  'role_timeouts', (
    select coalesce(jsonb_agg(format('%s: %s', coalesce(r.rolname, 'all roles'), cfg) order by 1), '[]'::jsonb)
    from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) cfg
    where cfg like 'statement_timeout=%' or cfg like 'lock_timeout=%'
  ),
  'reserved_member_zero', (select count(*) from fitness.profiles p where (to_jsonb(p) ->> 'user_number') = '0'),
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
    'fitness.routine_day_exercises', (select coalesce(max(x.n), 0) from (select count(*) n from fitness.routine_day_exercises group by user_id) x),
    'mazer.mazer_cycle_receipts', (select coalesce(max(x.n), 0) from (select count(*) n from mazer.mazer_cycle_receipts group by user_id) x)
  ),
  -- Known Fitness bug (not changed by this file): the repack triggers leave negative positions behind.
  'negative_positions', jsonb_build_object(
    'routine_day_exercises', (select count(*) from fitness.routine_day_exercises where position < 0),
    'session_exercises', (select count(*) from fitness.session_exercises where position < 0)
  )
));
