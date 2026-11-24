-- PROPOSED, OWNER-GATED. NOT APPLIED. Lives in supabase/proposed/ (not supabase/migrations/) so no
-- migration runner or Git integration can apply it on merge. Apply only after the owner approves this
-- file by sha256 (see docs/shared-account-portal-phase1.md, "Delete account v2").
--
-- 2026-11-24 source-consistency edit (NOT a re-apply): `mazer.mazer_feedback.user_id` (cascade, optional until the
-- Mazer feedback SQL v2 is applied) is listed in `fk_effects` so a future re-apply of this file does not
-- abort on an unlisted foreign key to auth.users. The live function body is unchanged by this edit (live
-- inner md5 e6569397d035916a3c5d1b7b6bd93148 is the pre-edit text); the live call already deletes the
-- feedback rows through the cascade.
--
-- Delete account v2 (account portal). SUPERSEDES 20261115200000_account_delete_self_v1.sql, which was
-- never applied: its preflight refused the live database (2026-11-16 preimage: 37 unlisted columns, 2
-- unlisted foreign key effects, 2 DELETE triggers). v2 keeps v1's contract and checks and adds what the
-- live database needs. Same API, so the portal does not change:
--
--   account_api.account_delete_self(p_confirm text) returns text
--     'deleted' | 'gone' | 'reauth' | 'confirm' | 'billing' | 'support' | 'rate'
--
-- OWNER DECISION (Zac, 2026-11-16): "Delete live data, keep archives". The call deletes the live rows
-- listed in `steps` below and the auth.users row. Archive, backup and migration tables are deliberately
-- NOT purged; they are listed one column at a time in `retained` (what each keeps is in the docs table).
-- The project has no point-in-time recovery and no listed backups, so a deleted row can not be brought
-- back, while the retained archives still hold copies (some with email or username) until the owner
-- purges them on a schedule of their own. The portal copy says sign-in logs and backups may keep some
-- data for a while.
--
-- ORDER: apply change username v1 (20261115190000_account_change_username_v1.sql) FIRST (same reason as
-- v1: its preflight refuses once authenticated already has USAGE on account_api). v1 delete must NOT be
-- applied; the preflight refuses if any v1 delete object exists. The portal keeps the Delete account row
-- hidden (DELETE_ACCOUNT_LIVE = false in src/config/account.ts) until this file is applied and the owner
-- dry run below passes.
--
-- Unchanged from v1 (see that file for the long form):
-- * Who: only authenticated, only for auth.uid(); never anon. Inner function and tables not exposed.
-- * Password proof: a password `amr` entry from the last 10 minutes and a `session_id` live in
--   auth.sessions for this account. OWNER DRY RUN: sign in with a password, refresh, decode the
--   refreshed token and confirm its amr timestamp is the ORIGINAL sign-in time; a token older than 10
--   minutes must answer 'reauth'.
-- * Typed confirmation: the current username (trimmed, any case), or the email when there is none.
-- * 'billing' for any Fitness billing row; 'support' for the reserved Fitness member #0, for a Storage
--   file owned by the account, and when another account's row points at a row this call would delete
--   (the foreign key walk, after this account's rows are locked FOR UPDATE).
-- * Rate limit: 5 refused attempts per 15 minutes, counted only after the password proof, under a
--   per-account advisory lock. Idempotent: 'gone' once the account is gone.
-- * One transaction; any error rolls back everything. Audit row in account_private.account_deletions
--   (same table and shape as v1): PLAIN sha256 of 'fawxzzy-account-delete-v1:' || user id (the prefix
--   stays v1 on purpose, as a stable namespace, so hashes from any version compare), time, per-table
--   counts, version 'v2'. It is not salted: pseudonymous, not anonymous.
--
-- New in v2:
-- * Retained allow-list (`retained`): every account-shaped column outside the deleted tables must be
--   listed (kept on purpose) or the apply refuses with UNKNOWN_ACCOUNT_COLUMNS. A new table that names
--   accounts still fails the apply. The sweep also catches columns of ANY type named like
--   fitness_user_id / auth_user_id / canonical_user_id (text ids included).
-- * Live diagnostics: mazer.mazer_register_failures (rows written when Mazer sign-up setup fails) is
--   deleted. discordos.discord_feedback_reports.reporter_fitness_user_id (a TEXT copy of the account id)
--   is set to null, like the Fitness Discord tables; the Discord ids, handles and text stay.
-- * Expected foreign key effects (`fk_effects`), checked and counted: deleting auth.users CASCADES to
--   account_private.username_signin_candidates (derived username sign-in rows; the sync trigger would
--   remove them too) and SETS NULL platform.identity_map.auth_user_id (the identity row stays,
--   unlinked). The apply refuses if either key is missing or has another action, or if any other
--   cascade/set-null reaches the deleted tables or auth.users. The call counts both before the delete and
--   raises if a row still names the account afterwards.
-- * Reviewed triggers (`reviewed_triggers`), pinned by table, name, function, md5 of the function body
--   and trigger type: the two Fitness position repack triggers (AFTER DELETE FOR EACH ROW on
--   routine_day_exercises and session_exercises; not security definer; they only touch rows of the
--   same account and parent; this call deletes all of the account's rows per table in one statement,
--   so when the row triggers fire at statement end no row is left for them to move), the username
--   sign-in index trigger on auth.users, and the updated_at trigger on discordos.discord_feedback_reports.
--   Any other trigger that fires on a delete here (or on an unlink update) refuses the apply, and is
--   re-checked on every call (ACCOUNT_DELETE_UNREVIEWED_TRIGGER, nothing deleted).
--   auth.users also has three INSERT-only triggers (account_guard_username_claim, BEFORE INSERT OR
--   UPDATE OF raw_user_meta_data; mazer_claim_signup_username_after_insert and
--   mazer_register_user_after_insert, AFTER INSERT). They never fire on a delete.
-- * Locked vs changed: every delete/unlink compares its row count with the rows this call locked in
--   that table and raises ACCOUNT_DELETE_ROWCOUNT_EXCEEDS_LOCKED if it changed more (a row the foreign
--   key walk never saw). Nothing is deleted.
-- * Storage check counts FORCE row level security (an owner without BYPASSRLS can not see every row).
-- * Time limits: the inner function sets lock_timeout = 3s (a busy row fails fast, nothing deleted).
--   The API wrapper sets statement_timeout = 30s: PostgREST applies a called function's
--   statement_timeout as a transaction setting before the call, so it replaces the authenticated role's
--   8s for this call only (Supabase allows up to 60s). The largest live account has 23,991 Mazer receipts
--   (seq scan of the 27.7k-row table, about 0.6-0.8s per pass, two passes plus cascades: estimated 2-4s).
--   Called from SQL directly, the function SET does not lengthen a statement that is already running.
--
-- Safety net (preflight): refuses the apply if anything above differs from the live picture, if a
-- listed table or column is missing or has the wrong type, if Storage holds files owned by any account
-- or postgres can not see every storage.objects row, if row level security would hide listed rows from
-- the owner, or if postgres lacks a privilege the call needs (UPDATE included, for the row locks).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $preflight$
declare
  leaked text;
  item text;
  parts text[];
  fk_oids oid[] := '{}';
  fk_oid oid;
  -- schema.table.column : the column that names the account. Deleted, unlinked or refused ('billing').
  manifest text[] := array[
    'fitness.sets.user_id',
    'fitness.session_exercises.user_id',
    'fitness.session_follow_up_jobs.user_id',
    'fitness.progression_events.user_id',
    'fitness.sessions.user_id',
    'fitness.exercise_stats.user_id',
    'fitness.routine_day_exercises.user_id',
    'fitness.routine_days.user_id',
    'fitness.routines.user_id',
    'fitness.workout_plan_template_exercises.user_id',
    'fitness.workout_plan_templates.user_id',
    'fitness.exercises.user_id',
    'fitness.discord_verification_tokens.user_id',
    'fitness.discord_member_links.fitness_user_id',
    'fitness.discord_feedback_reports.reporter_fitness_user_id',
    'fitness.discord_moderation_cases.target_fitness_user_id',
    'fitness.profiles.id',
    'fitness.billing_customers.user_id',
    'fitness.billing_purchases.user_id',
    'fitness.user_entitlements.user_id',
    'mazer.mazer_profiles.user_id',
    'mazer.mazer_progression_states.user_id',
    'mazer.mazer_ai_progression_states.user_id',
    'mazer.mazer_cycle_receipts.user_id',
    'mazer.mazer_register_failures.user_id',
    'account_private.username_signin_index.user_id'
  ];
  -- Listed but optional: created by other owner-gated files (or by this one).
  optional text[] := array[
    'account_private.username_change_attempts.user_id',
    'account_private.account_delete_attempts.user_id'
  ];
  -- TEXT copies of the account id, set to null by the call.
  text_links text[] := array[
    'discordos.discord_feedback_reports.reporter_fitness_user_id'
  ];
  -- Foreign keys to auth.users(id) whose effect is expected: column : confdeltype (c cascade, n set null).
  fk_effects text[] := array[
    'account_private.username_signin_candidates.user_id:c',
    'platform.identity_map.auth_user_id:n',
    'mazer.mazer_feedback.user_id:c'
  ];
  -- fk_effects entries (column only) that may be absent: the table comes from an owner-gated Mazer file.
  optional_fk_effects text[] := array['mazer.mazer_feedback.user_id'];
  -- KEPT ON PURPOSE (owner decision 2026-11-16, "Delete live data, keep archives"). Each column may name
  -- a live account; the call does not touch it. Absent tables are fine; a new unlisted one is not.
  retained text[] := array[
    -- Username repair recovery copies (2026-11): user id + original username / original metadata.
    'account_private.username_collision_resolution_backup.user_id',
    'account_private.username_shorten_backup.user_id',
    -- ATLAS identity migration rollback/mapping sources: bare ids (packet_rollback also holds emails).
    'atlas_identity_migration.mapping_wave2_rollback.before_canonical_user_id',
    'atlas_identity_migration.mapping_wave2_rollback.source_user_id',
    'atlas_identity_migration.packet_rollback.user_id',
    'atlas_identity_migration.source_identity_map.canonical_user_id',
    'atlas_identity_migration.source_identity_map.source_user_id',
    -- ATLAS auth data migration r001: id map and private auth payload (holds emails).
    'atlas_migration_auth_data_r001.identity_map.canonical_auth_user_id',
    'atlas_migration_auth_data_r001.private_auth_payload.canonical_auth_user_id',
    -- Fitness archive schema (pre-move copies of the Fitness tables).
    'fitness_archive.billing_customers.user_id',
    'fitness_archive.billing_purchases.user_id',
    'fitness_archive.discord_feedback_reports.reporter_fitness_user_id',
    'fitness_archive.discord_member_links.fitness_user_id',
    'fitness_archive.discord_moderation_cases.target_fitness_user_id',
    'fitness_archive.discord_verification_tokens.user_id',
    'fitness_archive.exercise_stats.user_id',
    'fitness_archive.exercises.user_id',
    'fitness_archive.progression_events.user_id',
    'fitness_archive.routine_day_exercises.user_id',
    'fitness_archive.routine_days.user_id',
    'fitness_archive.routines.user_id',
    'fitness_archive.session_exercises.user_id',
    'fitness_archive.session_follow_up_jobs.user_id',
    'fitness_archive.sessions.user_id',
    'fitness_archive.sets.user_id',
    'fitness_archive.user_entitlements.user_id',
    'fitness_archive.workout_plan_template_exercises.user_id',
    'fitness_archive.workout_plan_templates.user_id',
    -- Mazer migration artifacts: identity map (bare ids) and 2026-11-12 backfill copies (ids, usernames).
    'mazer.mazer_identity_map.legacy_user_id',
    'mazer.mazer_identity_map.master_user_id',
    'mazer.mazer_register_all_backfill_20261112.user_id',
    'mazer.mazer_username_backfill_20261112.user_id',
    -- Operations console records (owner platform_ops_owner): operator grant and session subjects.
    'platform_private.operations_operator_grants.subject',
    'platform_private.operations_sessions.subject'
  ];
  -- relation|trigger|function|md5(function body)|tgtype. The only triggers allowed to fire on a delete
  -- (or an unlink update) this call makes. Bodies read from the live database 2026-11-16.
  reviewed_triggers text[] := array[
    'auth.users|sync_username_signin_index|account_private.sync_username_signin_index|b9b39b13b97ce3ac15daabe487600ff7|29',
    'fitness.routine_day_exercises|routine_day_exercises_repack_after_delete|fitness.repack_routine_day_exercise_positions_after_delete|af1c93d5b67733b5489d5d919ec55700|9',
    'fitness.session_exercises|session_exercises_repack_after_delete|fitness.repack_session_exercise_positions_after_delete|7b4e4b9cf32bf6e0bf107d7ae645fce5|9',
    'discordos.discord_feedback_reports|set_discord_feedback_reports_updated_at|discordos.set_updated_at|9b1889f56258bf9d6554213c05019c76|19'
  ];
  unlink_tables text[] := array[
    'fitness.discord_feedback_reports', 'fitness.discord_moderation_cases', 'discordos.discord_feedback_reports'
  ];
  billing_tables text[] := array['fitness.billing_customers', 'fitness.billing_purchases', 'fitness.user_entitlements'];
  system_schemas text[] := array[
    'auth', 'storage', 'realtime', '_realtime', 'extensions', 'graphql', 'graphql_public', 'vault',
    'pgsodium', 'pgsodium_masks', 'net', 'supabase_functions', 'supabase_migrations', 'cron',
    'pgbouncer', 'information_schema', '_analytics', 'pgmq'
  ];
  delete_rels regclass[];
  update_rels regclass[];
  all_listed text[];
begin
  if to_regnamespace('account_api') is null or to_regnamespace('account_private') is null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_ACCOUNT_SCHEMAS_MISSING';
  end if;
  -- v1 delete must not be applied (roll it back first), and v2 must not be present already.
  if to_regprocedure('account_api.account_delete_self(text)') is not null
     or to_regprocedure('account_private.delete_account_v1(uuid, jsonb, text)') is not null
     or to_regprocedure('account_private.delete_account_v2(uuid, jsonb, text)') is not null
     or to_regclass('account_private.account_delete_attempts') is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_ALREADY_PRESENT (roll back delete v1/v2 first)';
  end if;
  -- The audit table survives a rollback on purpose; a re-apply reuses it only with the same shape.
  if to_regclass('account_private.account_deletions') is not null and (
    select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
    from pg_attribute a
    where a.attrelid = to_regclass('account_private.account_deletions') and a.attnum > 0 and not a.attisdropped
  ) is distinct from 'id:bigint,subject_hash:text,deleted_at:timestamp with time zone,row_counts:jsonb,version:text' then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_AUDIT_TABLE_SHAPE_DIFFERS';
  end if;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_AUTH_HELPERS_MISSING';
  end if;
  if to_regclass('auth.users') is null or to_regclass('auth.sessions') is null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_AUTH_TABLES_MISSING';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_API_ROLES_MISSING';
  end if;
  if has_schema_privilege('anon', 'account_api', 'usage') then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_ANON_HAS_ACCOUNT_API_USAGE';
  end if;

  -- Granting USAGE (if change username v1 has not already) must not expose anything else in account_api.
  select string_agg(p.oid::regprocedure::text, ', ') into leaked
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'account_api'
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.oid <> coalesce(to_regprocedure('account_api.account_change_username(text)')::oid, 0::oid);
  if leaked is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_ACCOUNT_API_FUNCTION_EXECUTABLE_BY_AUTHENTICATED: %', leaked;
  end if;
  select string_agg(c.oid::regclass::text, ', ') into leaked
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'account_api'
    and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
    and (has_table_privilege('authenticated', c.oid, 'select')
      or has_table_privilege('authenticated', c.oid, 'insert')
      or has_table_privilege('authenticated', c.oid, 'update')
      or has_table_privilege('authenticated', c.oid, 'delete'));
  if leaked is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_ACCOUNT_API_RELATION_REACHABLE_BY_AUTHENTICATED: %', leaked;
  end if;

  -- Every listed table and column exists; manifest columns are uuid, text links are text.
  foreach item in array manifest || text_links loop
    parts := string_to_array(item, '.');
    if to_regclass(format('%I.%I', parts[1], parts[2])) is null then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_LISTED_TABLE_MISSING: %', item;
    end if;
    if not exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass(format('%I.%I', parts[1], parts[2]))
        and a.attname = parts[3] and a.attnum > 0 and not a.attisdropped
        and a.atttypid = (case when item = any (text_links) then 'text' else 'uuid' end)::regtype
    ) then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_LISTED_COLUMN_MISSING_OR_WRONG_TYPE: %', item;
    end if;
  end loop;

  -- Expected foreign key effects: exactly one single-column key from the column to auth.users(id), with
  -- the expected ON DELETE action. Nothing may reference a cascaded table, or the set-null column.
  foreach item in array fk_effects loop
    parts := string_to_array(split_part(item, ':', 1), '.');
    if to_regclass(format('%I.%I', parts[1], parts[2])) is null then
      continue when split_part(item, ':', 1) = any (optional_fk_effects);
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_EXPECTED_FK_EFFECT_MISSING: %', item;
    end if;
    select k.oid into fk_oid
    from pg_constraint k
    join pg_attribute a on a.attrelid = k.conrelid and a.attname = parts[3] and a.attnum > 0 and not a.attisdropped
    where k.contype = 'f'
      and k.conrelid = to_regclass(format('%I.%I', parts[1], parts[2]))
      and k.confrelid = 'auth.users'::regclass
      and k.conkey = array[a.attnum]
      and k.confkey = array[(select u.attnum from pg_attribute u where u.attrelid = 'auth.users'::regclass and u.attname = 'id')]
      and k.confdeltype = split_part(item, ':', 2)::"char";
    if fk_oid is null then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_EXPECTED_FK_EFFECT_MISSING: %', item;
    end if;
    fk_oids := fk_oids || fk_oid;
    if exists (
      select 1 from pg_constraint k
      join pg_attribute a on a.attrelid = k.confrelid and a.attnum = any (k.confkey)
      where k.contype = 'f' and k.confrelid = to_regclass(format('%I.%I', parts[1], parts[2]))
        and (split_part(item, ':', 2) = 'c' or a.attname = parts[3])
    ) then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_EXPECTED_FK_EFFECT_IS_REFERENCED: %', item;
    end if;
    if not has_table_privilege('postgres', format('%I.%I', parts[1], parts[2]), 'select') then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_OWNER_LACKS_PRIVILEGE_ON: %', item;
    end if;
  end loop;

  -- Row-level security must not hide rows from the owner (a silent zero-row delete would leave data
  -- behind while the account row goes, and the effect counts would be wrong): every listed table with
  -- RLS on is owned by postgres without FORCE, or postgres has BYPASSRLS.
  all_listed := manifest || text_links || array(select split_part(e, ':', 1) from unnest(fk_effects) e);
  select string_agg(m.entry, ', ') into leaked
  from unnest(all_listed) as m(entry)
  join pg_class c on c.oid = to_regclass(format('%I.%I', split_part(m.entry, '.', 1), split_part(m.entry, '.', 2)))
  where c.relrowsecurity
    and not (select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'postgres')
    and (c.relforcerowsecurity or c.relowner <> (select oid from pg_roles where rolname = 'postgres'));
  if leaked is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_RLS_WOULD_HIDE_ROWS_FROM_OWNER: %', leaked;
  end if;

  -- Nothing outside the lists may name an account: user-shaped uuid columns, columns of any type named
  -- like an account id, or any foreign key to auth.users, in every non-system schema. Known retained
  -- columns pass; anything else is unknown and refuses the apply.
  select string_agg(hit, ', ' order by hit) into leaked
  from (
    select distinct format('%s.%s.%s', n.nspname, c.relname, a.attname) as hit
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and a.attnum > 0 and not a.attisdropped
      and n.nspname <> all (system_schemas)
      and n.nspname not like 'pg\_%'
      and (
        (a.atttypid = 'uuid'::regtype and a.attname ~ '(^|_)(user|users|owner|account|member|profile|player|customer|author|creator|reporter|target|subject)(_id)?$')
        or a.attname ~ '(^|_)(fitness|auth|account|canonical|master|legacy|source)_user_id$'
        or exists (
          select 1 from pg_constraint k
          where k.contype = 'f' and k.conrelid = c.oid and k.confrelid = 'auth.users'::regclass
            and a.attnum = any (k.conkey)
        )
      )
  ) sweep
  where hit <> all (all_listed) and hit <> all (optional) and hit <> all (retained);
  if leaked is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_UNKNOWN_ACCOUNT_COLUMNS: %', leaked;
  end if;

  delete_rels := array(
    select to_regclass(format('%I.%I', split_part(m.entry, '.', 1), split_part(m.entry, '.', 2)))
    from unnest(manifest || optional) as m(entry)
    where to_regclass(format('%I.%I', split_part(m.entry, '.', 1), split_part(m.entry, '.', 2))) is not null
      and format('%s.%s', split_part(m.entry, '.', 1), split_part(m.entry, '.', 2)) <> all (unlink_tables || billing_tables));
  update_rels := array(
    select to_regclass(t) from unnest(unlink_tables) t
    union all select 'platform.identity_map'::regclass);

  -- A delete may only reach rows this file lists. Any foreign key from an UNLISTED table into a table
  -- this call deletes from (or into auth.users, outside GoTrue's own schemas) that would cascade, set
  -- null or set default refuses the apply, except the two expected effects above. (NO ACTION and
  -- RESTRICT keys are safe: they make the call fail and roll back.) Keys between listed tables are
  -- checked per call for other accounts' rows; see delete_account_v2.
  select string_agg(format('%I.%I -> %s (%s)', n.nspname, c.relname, k.confrelid::regclass, k.conname), ', ' order by 1) into leaked
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where k.contype = 'f'
    and k.confdeltype in ('c', 'n', 'd')
    and n.nspname <> all (system_schemas)
    and k.oid <> all (fk_oids)
    and k.conrelid <> all (array(
      select to_regclass(format('%I.%I', split_part(m.entry, '.', 1), split_part(m.entry, '.', 2)))
      from unnest(manifest || optional) as m(entry)
      where to_regclass(format('%I.%I', split_part(m.entry, '.', 1), split_part(m.entry, '.', 2))) is not null))
    and k.confrelid = any (delete_rels || 'auth.users'::regclass);
  if leaked is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_CASCADE_REACHES_UNLISTED_TABLE: %', leaked;
  end if;

  -- Triggers run code inside the delete. Only the reviewed ones (pinned by body md5) may fire on a
  -- delete of a deleted table, auth.users or the cascaded table, or on an update of an unlinked table
  -- or the set-null table.
  select string_agg(format('%s.%s', t.tgrelid::regclass, t.tgname), ', ' order by 1) into leaked
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal
    and (((t.tgtype & 8) <> 0 and t.tgrelid = any (delete_rels || 'auth.users'::regclass || 'account_private.username_signin_candidates'::regclass
                                                   || coalesce(to_regclass('mazer.mazer_feedback'), 'account_private.username_signin_candidates'::regclass)))
      or ((t.tgtype & 16) <> 0 and t.tgrelid = any (update_rels)))
    and format('%s.%s|%s|%s.%s|%s|%s', n.nspname, c.relname, t.tgname, pn.nspname, p.proname, md5(p.prosrc), t.tgtype)
        <> all (reviewed_triggers);
  if leaked is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_UNREVIEWED_TRIGGER: %', leaked;
  end if;

  -- The reserved member #0 check reads fitness.profiles.user_number.
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'fitness.profiles'::regclass and a.attname = 'user_number' and a.attnum > 0
      and not a.attisdropped and a.atttypid in ('integer'::regtype, 'bigint'::regtype, 'smallint'::regtype)
  ) then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_RESERVED_PROFILE_COLUMN_MISSING: fitness.profiles.user_number';
  end if;

  -- Storage objects are files; deleting their rows would orphan the files. None may be owned today.
  if to_regclass('storage.objects') is not null then
    -- The function (owner postgres) checks this account's files at call time, so postgres must see every
    -- row: SELECT, schema USAGE, and, when row level security is on, superuser or BYPASSRLS, or
    -- ownership WITHOUT force (FORCE row level security applies to the owner too).
    if not has_schema_privilege('postgres', 'storage', 'usage')
       or not has_table_privilege('postgres', 'storage.objects', 'select')
       or exists (
         select 1 from pg_class c, pg_roles r
         where c.oid = 'storage.objects'::regclass and r.rolname = 'postgres'
           and c.relrowsecurity and not r.rolbypassrls and not r.rolsuper
           and (c.relowner <> r.oid or c.relforcerowsecurity)
       ) then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_CANNOT_READ_STORAGE_OBJECTS';
    end if;
    -- Both owner columns: the legacy uuid `owner` and the newer text `owner_id`.
    select string_agg(format('%I is not null', a.attname), ' or ' order by a.attname) into item
    from pg_attribute a
    where a.attrelid = 'storage.objects'::regclass and a.attname in ('owner', 'owner_id')
      and a.attnum > 0 and not a.attisdropped;
    if item is not null then
      execute 'select string_agg(distinct bucket_id, '', '') from storage.objects where ' || item into leaked;
      if leaked is not null then
        raise exception 'DELETE_ACCOUNT_PREFLIGHT_STORAGE_HAS_ACCOUNT_OWNED_FILES: %', leaked;
      end if;
    end if;
  end if;

  -- Applier and owner privileges (no role switch anywhere in this file).
  if not pg_has_role(current_user, 'postgres', 'usage') then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_APPLIER_CANNOT_OWN_AS_POSTGRES';
  end if;
  if not has_schema_privilege(current_user, 'account_private', 'create')
     or not has_schema_privilege(current_user, 'account_api', 'create') then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_APPLIER_NO_CREATE';
  end if;
  if not has_table_privilege('postgres', 'auth.users', 'select')
     or not has_table_privilege('postgres', 'auth.users', 'update')
     or not has_table_privilege('postgres', 'auth.users', 'delete')
     or not has_table_privilege('postgres', 'auth.sessions', 'select') then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_OWNER_NEEDS_AUTH_PRIVILEGES';
  end if;
  foreach item in array manifest || text_links loop
    parts := string_to_array(item, '.');
    if not has_schema_privilege('postgres', parts[1], 'usage')
       or not has_table_privilege('postgres', format('%I.%I', parts[1], parts[2]), 'select')
       -- Unlinked tables: UPDATE (also needed for the FOR UPDATE row locks).
       or (format('%s.%s', parts[1], parts[2]) = any (unlink_tables)
           and not has_table_privilege('postgres', format('%I.%I', parts[1], parts[2]), 'update'))
       or (format('%s.%s', parts[1], parts[2]) <> all (unlink_tables || billing_tables)
           and (not has_table_privilege('postgres', format('%I.%I', parts[1], parts[2]), 'delete')
                -- SELECT ... FOR UPDATE (the row locks before the cross-account walk) needs UPDATE.
                or not has_table_privilege('postgres', format('%I.%I', parts[1], parts[2]), 'update'))) then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_OWNER_LACKS_PRIVILEGE_ON: %', item;
    end if;
  end loop;
end;
$preflight$;

create table account_private.account_delete_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  outcome text not null check (outcome in ('confirm', 'billing', 'support')),
  attempted_at timestamptz not null default now()
);
-- Only calls that passed the password proof are recorded ('reauth' refusals write nothing). No foreign
-- key to auth.users (the applier is not known to hold REFERENCES on it). Rows older than 24 hours are
-- pruned per account on each call; a successful delete removes the account's rows.
create index account_delete_attempts_user_time on account_private.account_delete_attempts (user_id, attempted_at);
alter table account_private.account_delete_attempts enable row level security;
revoke all on table account_private.account_delete_attempts from public, anon, authenticated;
alter table account_private.account_delete_attempts owner to postgres;

create table if not exists account_private.account_deletions (
  id bigint generated always as identity primary key,
  subject_hash text not null,
  deleted_at timestamptz not null default now(),
  row_counts jsonb not null,
  version text not null
);
alter table account_private.account_deletions enable row level security;
revoke all on table account_private.account_deletions from public, anon, authenticated;
alter table account_private.account_deletions owner to postgres;

create function account_private.delete_account_v2(p_user_id uuid, p_claims jsonb, p_confirm text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  account_email text;
  account_name text;
  typed text := lower(trim(coalesce(p_confirm, '')));
  session_text text := p_claims ->> 'session_id';
  fresh_password boolean := false;
  counts jsonb := '{}'::jsonb;
  locked jsonb := '{}'::jsonb;
  n bigint;
  ref record;
  shared boolean;
  item text;
  action text;
  tbl text;
  col text;
  cond text;
  rel regclass;
  -- action:schema.table.column, in delete order (leaves first: several keys between these tables are ON
  -- DELETE NO ACTION). Rows are locked in this same order on every call.
  steps constant text[] := array[
    'delete:fitness.sets.user_id', 'delete:fitness.session_follow_up_jobs.user_id',
    'delete:fitness.progression_events.user_id', 'delete:fitness.session_exercises.user_id',
    'delete:fitness.sessions.user_id', 'delete:fitness.exercise_stats.user_id',
    'delete:fitness.routine_day_exercises.user_id', 'delete:fitness.routine_days.user_id',
    'delete:fitness.routines.user_id', 'delete:fitness.workout_plan_template_exercises.user_id',
    'delete:fitness.workout_plan_templates.user_id',
    -- Only this account's own custom exercises; shared catalogue rows have user_id null.
    'delete:fitness.exercises.user_id',
    'delete:fitness.discord_verification_tokens.user_id', 'delete:fitness.discord_member_links.fitness_user_id',
    -- Discord records stay without the account link.
    'unlink:fitness.discord_feedback_reports.reporter_fitness_user_id',
    'unlink:fitness.discord_moderation_cases.target_fitness_user_id',
    'unlink:discordos.discord_feedback_reports.reporter_fitness_user_id',
    'delete:fitness.profiles.id',
    -- Mazer: receipts, progress, sign-up diagnostics and the profile (the leaderboard is computed from these).
    'delete:mazer.mazer_cycle_receipts.user_id', 'delete:mazer.mazer_ai_progression_states.user_id',
    'delete:mazer.mazer_progression_states.user_id', 'delete:mazer.mazer_register_failures.user_id',
    'delete:mazer.mazer_profiles.user_id',
    'delete:account_private.username_signin_index.user_id',
    'delete:account_private.username_change_attempts.user_id',
    'delete:account_private.account_delete_attempts.user_id'
  ];
  -- Tables that may be absent (created by other owner-gated files).
  optional constant text[] := array['account_private.username_change_attempts'];
  -- Refused, never deleted here; still walked as foreign key sources.
  billing constant text[] := array[
    'fitness.billing_customers.user_id', 'fitness.billing_purchases.user_id', 'fitness.user_entitlements.user_id'
  ];
  -- Removed or unlinked by the auth.users delete itself (foreign keys checked by the preflight).
  fk_effects constant text[] := array[
    'account_private.username_signin_candidates.user_id:cascade',
    'platform.identity_map.auth_user_id:unlinked',
    'mazer.mazer_feedback.user_id:cascade'
  ];
  reviewed_triggers constant text[] := array[
    'auth.users|sync_username_signin_index|account_private.sync_username_signin_index|b9b39b13b97ce3ac15daabe487600ff7|29',
    'fitness.routine_day_exercises|routine_day_exercises_repack_after_delete|fitness.repack_routine_day_exercise_positions_after_delete|af1c93d5b67733b5489d5d919ec55700|9',
    'fitness.session_exercises|session_exercises_repack_after_delete|fitness.repack_session_exercise_positions_after_delete|7b4e4b9cf32bf6e0bf107d7ae645fce5|9',
    'discordos.discord_feedback_reports|set_discord_feedback_reports_updated_at|discordos.set_updated_at|9b1889f56258bf9d6554213c05019c76|19'
  ];
begin
  if p_user_id is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_DELETE_NOT_SIGNED_IN';
  end if;

  -- One call at a time per account: the rate count, the checks and the delete cannot race.
  perform pg_advisory_xact_lock(hashtextextended('account_delete:' || p_user_id::text, 0));

  select lower(trim(coalesce(u.email, ''))), lower(trim(coalesce(u.raw_user_meta_data ->> 'username', '')))
    into account_email, account_name
  from auth.users u where u.id = p_user_id
  for update;
  if not found then
    -- Already deleted (a retry after a lost response, or a second tab). Nothing to do, nothing written.
    return 'gone';
  end if;

  -- Fresh password sign-in on a live session of this same account. A refusal here writes nothing and
  -- does not count toward the rate limit (see the header).
  if jsonb_typeof(p_claims -> 'amr') = 'array' then
    select exists (
      select 1 from jsonb_array_elements(p_claims -> 'amr') entry
      where entry ->> 'method' = 'password'
        and jsonb_typeof(entry -> 'timestamp') = 'number'
        and to_timestamp((entry ->> 'timestamp')::double precision) > now() - interval '10 minutes'
        and to_timestamp((entry ->> 'timestamp')::double precision) < now() + interval '1 minute'
    ) into fresh_password;
  end if;
  if not fresh_password
     or session_text is null
     or session_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or not exists (select 1 from auth.sessions s where s.id = session_text::uuid and s.user_id = p_user_id) then
    return 'reauth';
  end if;

  -- Rate limit: only attempts that passed the password proof are recorded and counted.
  if (select count(*) from account_private.account_delete_attempts a
      where a.user_id = p_user_id and a.attempted_at > now() - interval '15 minutes') >= 5 then
    return 'rate';
  end if;
  delete from account_private.account_delete_attempts a
  where a.user_id = p_user_id and a.attempted_at < now() - interval '24 hours';

  if typed = '' or typed is distinct from (case when account_name <> '' then account_name else account_email end) then
    insert into account_private.account_delete_attempts (user_id, outcome) values (p_user_id, 'confirm');
    return 'confirm';
  end if;

  if exists (select 1 from fitness.billing_customers b where b.user_id = p_user_id)
     or exists (select 1 from fitness.billing_purchases b where b.user_id = p_user_id)
     or exists (select 1 from fitness.user_entitlements b where b.user_id = p_user_id) then
    insert into account_private.account_delete_attempts (user_id, outcome) values (p_user_id, 'billing');
    return 'billing';
  end if;

  -- The reserved Fitness member #0 profile (the owner's own account) is never deleted here.
  if exists (select 1 from fitness.profiles p where p.id = p_user_id and p.user_number = 0) then
    insert into account_private.account_delete_attempts (user_id, outcome) values (p_user_id, 'support');
    return 'support';
  end if;

  -- Files in Storage owned by this account (legacy uuid `owner` or text `owner_id`): not deleted here.
  rel := to_regclass('storage.objects');
  if rel is not null then
    select string_agg(format('o.%I::text = $1::text', a.attname), ' or ' order by a.attname) into item
    from pg_catalog.pg_attribute a
    where a.attrelid = rel and a.attname in ('owner', 'owner_id') and a.attnum > 0 and not a.attisdropped;
    if item is not null then
      execute 'select exists (select 1 from storage.objects o where ' || item || ')' into shared using p_user_id;
      if shared then
        insert into account_private.account_delete_attempts (user_id, outcome) values (p_user_id, 'support');
        return 'support';
      end if;
    end if;
  end if;

  -- Only reviewed triggers may run inside this delete (re-checked per call: a trigger added after the
  -- apply stops the call, nothing deleted).
  select string_agg(format('%s.%s', n2.nspname, c.relname) || '.' || t.tgname, ', ' order by 1) into item
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n2 on n2.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal
    and (
      ((t.tgtype & 8) <> 0 and (format('%s.%s', n2.nspname, c.relname) in ('auth.users', 'account_private.username_signin_candidates', 'mazer.mazer_feedback')
        or format('%s.%s', n2.nspname, c.relname) in (
          select split_part(split_part(s, ':', 2), '.', 1) || '.' || split_part(split_part(s, ':', 2), '.', 2)
          from unnest(steps) s where split_part(s, ':', 1) = 'delete')))
      or ((t.tgtype & 16) <> 0 and (format('%s.%s', n2.nspname, c.relname) = 'platform.identity_map'
        or format('%s.%s', n2.nspname, c.relname) in (
          select split_part(split_part(s, ':', 2), '.', 1) || '.' || split_part(split_part(s, ':', 2), '.', 2)
          from unnest(steps) s where split_part(s, ':', 1) = 'unlink')))
    )
    and format('%s.%s|%s|%s.%s|%s|%s', n2.nspname, c.relname, t.tgname, pn.nspname, p.proname, md5(p.prosrc), t.tgtype)
        <> all (reviewed_triggers);
  if item is not null then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_UNREVIEWED_TRIGGER', detail = item;
  end if;

  -- Lock this account's rows in every table this call deletes from or unlinks, BEFORE the walk below,
  -- and remember how many were locked. FOR UPDATE conflicts with the FOR KEY SHARE lock another
  -- session's foreign-key check takes on the row it points at, so no row can start pointing at this
  -- account's rows between the walk and the deletes. Same order on every call.
  foreach item in array steps loop
    tbl := split_part(split_part(item, ':', 2), '.', 1) || '.' || split_part(split_part(item, ':', 2), '.', 2);
    col := split_part(split_part(item, ':', 2), '.', 3);
    rel := to_regclass(tbl);
    if rel is null then
      continue when tbl = any (optional);
      raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_LISTED_TABLE_MISSING', detail = tbl;
    end if;
    -- uuid columns compare with the id; text copies (discordos) compare with its text form.
    cond := case when (select a.atttypid from pg_catalog.pg_attribute a
                       where a.attrelid = rel and a.attname = col and a.attnum > 0 and not a.attisdropped)
                      = 'pg_catalog.uuid'::pg_catalog.regtype
                 then format('t.%I = $1', col) else format('t.%I = $1::text', col) end;
    execute format('select count(*) from (select 1 from %s t where %s for update) locked', rel, cond)
      into n using p_user_id;
    locked := locked || jsonb_build_object(tbl, n);
  end loop;

  -- No other account's rows may be deleted or changed: walk every foreign key (read from the catalog at
  -- call time, so a key added later is covered) from a listed uuid column into a table this call deletes
  -- from, and refuse if any row of ANOTHER account (or of no account) points at one of this account's
  -- rows. Keys from unlisted tables can only be NO ACTION/RESTRICT (the preflight refuses the rest),
  -- which make the call fail with 23503 and roll back (the portal says to contact support).
  for ref in
    select k.conrelid::regclass::text as src, src_list.col as src_col,
           k.confrelid::regclass::text as dst, dst_list.col as dst_col,
           (select string_agg(format('d.%I = s.%I', da.attname, sa.attname), ' and ' order by u.ord)
              from unnest(k.conkey, k.confkey) with ordinality as u(src_att, dst_att, ord)
              join pg_catalog.pg_attribute sa on sa.attrelid = k.conrelid and sa.attnum = u.src_att
              join pg_catalog.pg_attribute da on da.attrelid = k.confrelid and da.attnum = u.dst_att) as join_on
    from pg_catalog.pg_constraint k
    join (select to_regclass(split_part(e, '.', 1) || '.' || split_part(e, '.', 2)) as rel,
                 split_part(e, '.', 3) as col
          from unnest(array(select split_part(s, ':', 2) from unnest(steps) s) || billing) e) src_list
      on src_list.rel = k.conrelid
     and exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = k.conrelid and a.attname = src_list.col
                 and a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype)
    join (select to_regclass(split_part(split_part(s, ':', 2), '.', 1) || '.' || split_part(split_part(s, ':', 2), '.', 2)) as rel,
                 split_part(split_part(s, ':', 2), '.', 3) as col
          from unnest(steps) s
          where split_part(s, ':', 1) = 'delete') dst_list
      on dst_list.rel = k.confrelid
    where k.contype = 'f'
    order by 1, 3
  loop
    execute format('select exists (select 1 from %s s join %s d on %s where d.%I = $1 and s.%I is distinct from $1)',
                   ref.src, ref.dst, ref.join_on, ref.dst_col, ref.src_col)
      into shared using p_user_id;
    if shared then
      insert into account_private.account_delete_attempts (user_id, outcome) values (p_user_id, 'support');
      return 'support';
    end if;
  end loop;

  -- Delete and unlink, in order. Each statement may change at most the rows locked above in that table.
  foreach item in array steps loop
    action := split_part(item, ':', 1);
    tbl := split_part(split_part(item, ':', 2), '.', 1) || '.' || split_part(split_part(item, ':', 2), '.', 2);
    col := split_part(split_part(item, ':', 2), '.', 3);
    rel := to_regclass(tbl);
    continue when rel is null and tbl = any (optional);
    cond := case when (select a.atttypid from pg_catalog.pg_attribute a
                       where a.attrelid = rel and a.attname = col and a.attnum > 0 and not a.attisdropped)
                      = 'pg_catalog.uuid'::pg_catalog.regtype
                 then format('t.%I = $1', col) else format('t.%I = $1::text', col) end;
    if action = 'delete' then
      execute format('delete from %s t where %s', rel, cond) using p_user_id;
    else
      execute format('update %s t set %I = null where %s', rel, col, cond) using p_user_id;
    end if;
    get diagnostics n = row_count;
    if n > coalesce((locked ->> tbl)::bigint, 0) then
      raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_ROWCOUNT_EXCEEDS_LOCKED',
        detail = format('%s: changed %s, locked %s', tbl, n, coalesce((locked ->> tbl)::bigint, 0));
    end if;
    counts := counts || jsonb_build_object(case when action = 'unlink' then tbl || '(unlinked)' else tbl end, n);
  end loop;

  -- Rows the auth.users delete removes (cascade) or unlinks (set null) through the expected keys.
  foreach item in array fk_effects loop
    tbl := split_part(split_part(item, ':', 1), '.', 1) || '.' || split_part(split_part(item, ':', 1), '.', 2);
    rel := to_regclass(tbl);
    continue when rel is null;
    execute format('select count(*) from %s t where t.%I = $1', rel, split_part(split_part(item, ':', 1), '.', 3))
      into n using p_user_id;
    counts := counts || jsonb_build_object(tbl || '(' || split_part(item, ':', 2) || ')', n);
  end loop;

  -- Last: the account itself. GoTrue's sessions, refresh tokens and identities cascade from it.
  delete from auth.users u where u.id = p_user_id;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'ACCOUNT_DELETE_AUTH_ROW_NOT_DELETED';
  end if;

  foreach item in array fk_effects loop
    tbl := split_part(split_part(item, ':', 1), '.', 1) || '.' || split_part(split_part(item, ':', 1), '.', 2);
    rel := to_regclass(tbl);
    continue when rel is null;
    execute format('select exists (select 1 from %s t where t.%I = $1)', rel, split_part(split_part(item, ':', 1), '.', 3))
      into shared using p_user_id;
    if shared then
      raise exception using errcode = 'P0001', message = 'ACCOUNT_DELETE_FK_EFFECT_INCOMPLETE', detail = tbl;
    end if;
  end loop;

  insert into account_private.account_deletions (subject_hash, row_counts, version)
  values (
    encode(sha256(convert_to('fawxzzy-account-delete-v1:' || p_user_id::text, 'UTF8')), 'hex'),
    counts,
    'v2'
  );
  return 'deleted';
end;
$$;

revoke all on function account_private.delete_account_v2(uuid, jsonb, text) from public, anon, authenticated;
alter function account_private.delete_account_v2(uuid, jsonb, text) owner to postgres;

-- statement_timeout here is read by PostgREST before the call (see the header): it replaces the
-- authenticated role's 8s for this one request.
create function account_api.account_delete_self(p_confirm text)
returns text
language sql
volatile
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
  select account_private.delete_account_v2(auth.uid(), coalesce(auth.jwt(), '{}'::jsonb), p_confirm)
$$;

revoke all on function account_api.account_delete_self(text) from public, anon;
alter function account_api.account_delete_self(text) owner to postgres;
grant execute on function account_api.account_delete_self(text) to authenticated;
grant usage on schema account_api to authenticated;

do $postcheck$
begin
  if not has_function_privilege('authenticated', 'account_api.account_delete_self(text)', 'execute') then
    raise exception 'DELETE_ACCOUNT_POSTCHECK_AUTHENTICATED_CANNOT_CALL';
  end if;
  if has_function_privilege('anon', 'account_api.account_delete_self(text)', 'execute') then
    raise exception 'DELETE_ACCOUNT_POSTCHECK_ANON_CAN_CALL';
  end if;
  if has_function_privilege('authenticated', 'account_private.delete_account_v2(uuid, jsonb, text)', 'execute') then
    raise exception 'DELETE_ACCOUNT_POSTCHECK_INNER_FUNCTION_EXPOSED';
  end if;
  if has_table_privilege('authenticated', 'account_private.account_delete_attempts', 'select')
     or has_table_privilege('authenticated', 'account_private.account_deletions', 'select') then
    raise exception 'DELETE_ACCOUNT_POSTCHECK_PRIVATE_TABLE_EXPOSED';
  end if;
  if not coalesce((select p.proconfig @> array['statement_timeout=30s'] from pg_proc p
                   where p.oid = 'account_api.account_delete_self(text)'::regprocedure), false)
     or not coalesce((select p.proconfig @> array['lock_timeout=3s'] from pg_proc p
                      where p.oid = 'account_private.delete_account_v2(uuid, jsonb, text)'::regprocedure), false) then
    raise exception 'DELETE_ACCOUNT_POSTCHECK_TIMEOUTS_NOT_SET';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'account_api' and has_function_privilege('authenticated', p.oid, 'execute')
      and p.oid not in (
        'account_api.account_delete_self(text)'::regprocedure::oid,
        coalesce(to_regprocedure('account_api.account_change_username(text)')::oid, 0::oid)
      )
  ) then
    raise exception 'DELETE_ACCOUNT_POSTCHECK_UNEXPECTED_ACCOUNT_API_EXECUTE';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
