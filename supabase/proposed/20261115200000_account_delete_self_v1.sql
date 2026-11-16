-- PROPOSED, OWNER-GATED. NOT APPLIED. Lives in supabase/proposed/ (not supabase/migrations/) so no
-- migration runner or Git integration can apply it on merge. Apply only after the owner approves this
-- file by sha256 (see docs/shared-account-portal-phase1.md, "Delete account").
--
-- Delete account v1 (account portal): a signed-in person deletes their own Fawxzzy account, and with it
-- their data in every app, from account.fawxzzy.com/account.
--
--   account_api.account_delete_self(p_confirm text) returns text
--     'deleted' | 'gone' | 'reauth' | 'confirm' | 'billing' | 'rate'
--
-- DECISION (owner to confirm): immediate, permanent delete. No grace period, no undo, no standing store
-- of deleted accounts. There is NO recovery for deleted rows other than a provider backup/PITR restore,
-- if the project has one; this file keeps no copy of anything it deletes.
--
-- * Who: only the authenticated role, only for auth.uid(). Never anon. The inner function, the attempts
--   table and the audit table are not reachable through the API.
-- * Proof of the password: the portal re-enters the password with a throwaway sign-in and calls this
--   function with THAT fresh session. Here the signed JWT must carry a password `amr` entry from the
--   last 10 minutes and a `session_id` that is still live in auth.sessions for the same user. The
--   password itself never reaches SQL. Anything else answers 'reauth'.
-- * Typed confirmation: p_confirm must equal the current username (trimmed, any case); an account with
--   no username types its email instead. Otherwise 'confirm'.
-- * Billing: an account with any Fitness billing row (customer, purchase or entitlement) is NOT deleted
--   ('billing'); the portal sends the person to support. (Owner decision: refunds, receipts and record
--   retention are not decided by this function.)
-- * Rate limit: per account, at most 5 refused attempts per 15 minutes ('rate'), under a per-account
--   advisory lock so concurrent calls cannot race the count or the delete.
-- * Idempotent: once the account is gone the call answers 'gone' and writes nothing.
-- * One transaction: Fitness rows, Mazer rows, the username sign-in index and attempt rows, then the
--   auth.users row (which cascades every GoTrue session, refresh token and identity: sign-out
--   everywhere). Any error (for example another account referencing this account's custom exercise)
--   rolls back everything; nothing is half-deleted.
-- * Audit: one row in account_private.account_deletions with sha256('fawxzzy-account-delete-v1:' ||
--   user id), the time, per-table row counts and the version. No username, email or other PII.
-- * Discord: feedback reports and moderation cases that name this account keep their row but lose the
--   account link (reporter_fitness_user_id / target_fitness_user_id set to null, as the original
--   ON DELETE SET NULL foreign keys did). Member links and verification tokens are deleted.
-- * Safety net: the preflight sweeps the catalog and REFUSES the apply if any table outside the system
--   schemas has a user-shaped uuid column or a foreign key to auth.users that this file does not list,
--   if a listed table or column is missing, or if Storage holds files owned by any account. A database
--   that differs from the repo's picture of it fails the apply instead of leaving personal data behind.
-- * Ordering with change username v1 (20261115190000): apply change username FIRST. Its preflight
--   refuses once authenticated already has USAGE on account_api (which this file grants if missing),
--   and its rollback revokes that USAGE, which would also switch this function off (fails safe: the
--   portal shows "unavailable").
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $preflight$
declare
  leaked text;
  item text;
  parts text[];
  manifest text[] := array[
    -- schema.table.column : the column that names the account
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
    'account_private.username_signin_index.user_id'
  ];
  -- Listed but optional: created by other owner-gated files (or by this one).
  optional text[] := array[
    'account_private.username_change_attempts.user_id',
    'account_private.account_delete_attempts.user_id'
  ];
  system_schemas text[] := array[
    'auth', 'storage', 'realtime', '_realtime', 'extensions', 'graphql', 'graphql_public', 'vault',
    'pgsodium', 'pgsodium_masks', 'net', 'supabase_functions', 'supabase_migrations', 'cron',
    'pgbouncer', 'information_schema', '_analytics', 'pgmq'
  ];
begin
  if to_regnamespace('account_api') is null or to_regnamespace('account_private') is null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_ACCOUNT_SCHEMAS_MISSING';
  end if;
  if to_regprocedure('account_api.account_delete_self(text)') is not null
     or to_regprocedure('account_private.delete_account_v1(uuid, jsonb, text)') is not null
     or to_regclass('account_private.account_delete_attempts') is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_ALREADY_PRESENT';
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

  -- Every listed table and column exists, and the column is a uuid.
  foreach item in array manifest loop
    parts := string_to_array(item, '.');
    if to_regclass(format('%I.%I', parts[1], parts[2])) is null then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_LISTED_TABLE_MISSING: %', item;
    end if;
    if not exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass(format('%I.%I', parts[1], parts[2]))
        and a.attname = parts[3] and a.attnum > 0 and not a.attisdropped and a.atttypid = 'uuid'::regtype
    ) then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_LISTED_COLUMN_MISSING_OR_NOT_UUID: %', item;
    end if;
  end loop;

  -- Row-level security must not hide rows from the owner (a silent zero-row delete would leave data
  -- behind while the account row goes): every listed table with RLS on is owned by postgres without
  -- FORCE, or postgres has BYPASSRLS.
  select string_agg(m.entry, ', ') into leaked
  from unnest(manifest) as m(entry)
  join pg_class c on c.oid = to_regclass(format('%I.%I', split_part(m.entry, '.', 1), split_part(m.entry, '.', 2)))
  where c.relrowsecurity
    and not (select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'postgres')
    and (c.relforcerowsecurity or c.relowner <> (select oid from pg_roles where rolname = 'postgres'));
  if leaked is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_RLS_WOULD_HIDE_ROWS_FROM_OWNER: %', leaked;
  end if;

  -- Nothing outside the list may name an account: user-shaped uuid columns, or any foreign key to
  -- auth.users, in every non-system schema.
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
        or exists (
          select 1 from pg_constraint k
          where k.contype = 'f' and k.conrelid = c.oid and k.confrelid = 'auth.users'::regclass
            and a.attnum = any (k.conkey)
        )
      )
  ) sweep
  where hit <> all (manifest) and hit <> all (optional);
  if leaked is not null then
    raise exception 'DELETE_ACCOUNT_PREFLIGHT_UNLISTED_ACCOUNT_COLUMNS: %', leaked;
  end if;

  -- Storage objects are files; deleting their rows would orphan the files. None may be owned today.
  if to_regclass('storage.objects') is not null then
    if not has_table_privilege('postgres', 'storage.objects', 'select') then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_CANNOT_READ_STORAGE_OBJECTS';
    end if;
    if exists (
      select 1 from pg_attribute a
      where a.attrelid = 'storage.objects'::regclass and a.attname = 'owner' and not a.attisdropped
    ) then
      execute 'select string_agg(distinct bucket_id, '', '') from storage.objects where owner is not null' into leaked;
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
  foreach item in array manifest loop
    parts := string_to_array(item, '.');
    if not has_schema_privilege('postgres', parts[1], 'usage')
       or not has_table_privilege('postgres', format('%I.%I', parts[1], parts[2]), 'select')
       or (parts[2] in ('discord_feedback_reports', 'discord_moderation_cases')
           and not has_table_privilege('postgres', format('%I.%I', parts[1], parts[2]), 'update'))
       or (parts[2] not in ('discord_feedback_reports', 'discord_moderation_cases', 'billing_customers', 'billing_purchases', 'user_entitlements')
           and not has_table_privilege('postgres', format('%I.%I', parts[1], parts[2]), 'delete')) then
      raise exception 'DELETE_ACCOUNT_PREFLIGHT_OWNER_LACKS_PRIVILEGE_ON: %', item;
    end if;
  end loop;
end;
$preflight$;

create table account_private.account_delete_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  outcome text not null check (outcome in ('reauth', 'confirm', 'billing')),
  attempted_at timestamptz not null default now()
);
-- No foreign key to auth.users (the applier is not known to hold REFERENCES on it). Rows older than
-- 24 hours are pruned per account on each call; a successful delete removes the account's rows.
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

create function account_private.delete_account_v1(p_user_id uuid, p_claims jsonb, p_confirm text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  account_email text;
  account_name text;
  typed text := lower(trim(coalesce(p_confirm, '')));
  session_text text := p_claims ->> 'session_id';
  fresh_password boolean := false;
  counts jsonb := '{}'::jsonb;
  n bigint;
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

  if (select count(*) from account_private.account_delete_attempts a
      where a.user_id = p_user_id and a.attempted_at > now() - interval '15 minutes') >= 5 then
    return 'rate';
  end if;
  delete from account_private.account_delete_attempts a
  where a.user_id = p_user_id and a.attempted_at < now() - interval '24 hours';

  -- Fresh password sign-in on a live session of this same account.
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
    insert into account_private.account_delete_attempts (user_id, outcome) values (p_user_id, 'reauth');
    return 'reauth';
  end if;

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

  -- Fitness, leaves first (several foreign keys between these tables are ON DELETE NO ACTION).
  delete from fitness.sets t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.sets', n);
  delete from fitness.session_follow_up_jobs t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.session_follow_up_jobs', n);
  delete from fitness.progression_events t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.progression_events', n);
  delete from fitness.session_exercises t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.session_exercises', n);
  delete from fitness.sessions t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.sessions', n);
  delete from fitness.exercise_stats t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.exercise_stats', n);
  delete from fitness.routine_day_exercises t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.routine_day_exercises', n);
  delete from fitness.routine_days t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.routine_days', n);
  delete from fitness.routines t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.routines', n);
  delete from fitness.workout_plan_template_exercises t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.workout_plan_template_exercises', n);
  delete from fitness.workout_plan_templates t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.workout_plan_templates', n);
  -- Only this account's own custom exercises; shared catalogue rows have user_id null.
  delete from fitness.exercises t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.exercises', n);
  delete from fitness.discord_verification_tokens t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.discord_verification_tokens', n);
  delete from fitness.discord_member_links t where t.fitness_user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.discord_member_links', n);
  update fitness.discord_feedback_reports t set reporter_fitness_user_id = null where t.reporter_fitness_user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.discord_feedback_reports(unlinked)', n);
  update fitness.discord_moderation_cases t set target_fitness_user_id = null where t.target_fitness_user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.discord_moderation_cases(unlinked)', n);
  delete from fitness.profiles t where t.id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('fitness.profiles', n);

  -- Mazer: progress, receipts and the profile (the leaderboard is computed from these rows).
  delete from mazer.mazer_cycle_receipts t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('mazer.mazer_cycle_receipts', n);
  delete from mazer.mazer_ai_progression_states t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('mazer.mazer_ai_progression_states', n);
  delete from mazer.mazer_progression_states t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('mazer.mazer_progression_states', n);
  delete from mazer.mazer_profiles t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('mazer.mazer_profiles', n);

  -- Account rows. The username change attempts table exists only once change username v1 is applied.
  delete from account_private.username_signin_index t where t.user_id = p_user_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('account_private.username_signin_index', n);
  if to_regclass('account_private.username_change_attempts') is not null then
    execute 'delete from account_private.username_change_attempts where user_id = $1' using p_user_id;
    get diagnostics n = row_count; counts := counts || jsonb_build_object('account_private.username_change_attempts', n);
  end if;
  delete from account_private.account_delete_attempts t where t.user_id = p_user_id;

  -- Last: the account itself. GoTrue's sessions, refresh tokens and identities cascade from it.
  delete from auth.users u where u.id = p_user_id;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'ACCOUNT_DELETE_AUTH_ROW_NOT_DELETED';
  end if;

  insert into account_private.account_deletions (subject_hash, row_counts, version)
  values (
    encode(sha256(convert_to('fawxzzy-account-delete-v1:' || p_user_id::text, 'UTF8')), 'hex'),
    counts,
    'v1'
  );
  return 'deleted';
end;
$$;

revoke all on function account_private.delete_account_v1(uuid, jsonb, text) from public, anon, authenticated;
alter function account_private.delete_account_v1(uuid, jsonb, text) owner to postgres;

create function account_api.account_delete_self(p_confirm text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select account_private.delete_account_v1(auth.uid(), coalesce(auth.jwt(), '{}'::jsonb), p_confirm)
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
  if has_function_privilege('authenticated', 'account_private.delete_account_v1(uuid, jsonb, text)', 'execute') then
    raise exception 'DELETE_ACCOUNT_POSTCHECK_INNER_FUNCTION_EXPOSED';
  end if;
  if has_table_privilege('authenticated', 'account_private.account_delete_attempts', 'select')
     or has_table_privilege('authenticated', 'account_private.account_deletions', 'select') then
    raise exception 'DELETE_ACCOUNT_POSTCHECK_PRIVATE_TABLE_EXPOSED';
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
