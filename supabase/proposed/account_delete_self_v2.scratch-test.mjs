// Scratch test for the PROPOSED delete-account v2 SQL (in-memory Postgres 17 via pglite; never touches
// Supabase). Owner-run before approving the SQL; not part of CI (CI checks the file shape only, in
// tests/account-delete.test.mjs).
//
// Same layers as the v1 scratch test, plus the live-only objects the 2026-11-16 preimage found:
//   1. Supabase stand-ins (roles, auth.users / sessions / refresh_tokens / identities with GoTrue's
//      cascades, auth.uid() / auth.jwt(), storage.objects, one service-role-only account_api function);
//   2. the Fitness and Mazer tables (v1 shapes, plus `position` on the two repacked tables and
//      mazer.mazer_register_failures);
//   3. LIVE-LIKE extras: account_private.username_signin_candidates (ON DELETE CASCADE to auth.users),
//      platform.identity_map (ON DELETE SET NULL, referenced by platform.work_projects on identity_id),
//      discordos.discord_feedback_reports (TEXT account id, FORCE row level security, updated_at
//      trigger), and one stand-in per retained archive/backup table family;
//   4. the live username guard, the repo sign-in index objects, then the LIVE function bodies from
//      account_delete_self_v2.live-bodies.json (read-only from the live database 2026-11-16: the sign-in
//      sync and refresh functions, the two Fitness repack triggers, discordos.set_updated_at), so the
//      trigger pins (md5 of each body) are checked against the real code;
//   5. the file under test, run verbatim; its rollback, a re-apply, the read-only preimage, the
//      interplay with change username v1, and preflight / call-time refusals.
//
// The proof that matters: deleting one account removes exactly that account's live rows, unlinks the
// Discord copies and the platform identity, leaves the retained archives byte-for-byte unchanged, and
// leaves every other account's rows byte-for-byte unchanged.
//
// Usage (pglite pinned at 0.5.13, installed with `npm ci --ignore-scripts` in its own folder):
//   PGLITE_SANDBOX=<folder with node_modules/@electric-sql/pglite> node supabase/proposed/account_delete_self_v2.scratch-test.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sandbox = process.env.PGLITE_SANDBOX;
if (!sandbox) {
  console.error("Set PGLITE_SANDBOX to a folder with node_modules/@electric-sql/pglite.");
  process.exit(2);
}
const { PGlite } = createRequire(path.join(sandbox, "package.json"))("@electric-sql/pglite");

const root = path.resolve(__dirname, "../..");
const APPLY_PATH = path.join(__dirname, "20261116090000_account_delete_self_v2.sql");
const ROLLBACK_PATH = path.join(__dirname, "20261116090000_account_delete_self_v2.rollback.sql");
const PREIMAGE_PATH = path.join(__dirname, "20261116090000_account_delete_self_v2.preimage.sql");
const LIVE_PATH = path.join(__dirname, "account_delete_self_v2.live-bodies.json");
const V1_PATH = path.join(__dirname, "20261115200000_account_delete_self_v1.sql");
const CHANGE_PATH = path.join(__dirname, "20261115190000_account_change_username_v1.sql");
const INDEX_PATH = path.join(root, "supabase/migrations/20260826163000_account_username_signin_index.sql");
const APPLY = fs.readFileSync(APPLY_PATH, "utf8");
const ROLLBACK = fs.readFileSync(ROLLBACK_PATH, "utf8");
const PREIMAGE = fs.readFileSync(PREIMAGE_PATH, "utf8");
const LIVE = JSON.parse(fs.readFileSync(LIVE_PATH, "utf8"));
const V1 = fs.readFileSync(V1_PATH, "utf8");
const CHANGE = fs.readFileSync(CHANGE_PATH, "utf8");
const INDEX_SQL = fs.readFileSync(INDEX_PATH, "utf8");
const INDEX_OBJECTS = INDEX_SQL.slice(0, INDEX_SQL.indexOf("create table if not exists account_private.username_signin_attempts"));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const md5 = (text) => crypto.createHash("md5").update(text, "utf8").digest("hex");

const STANDINS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema account_private; create schema account_api; create schema storage;
grant usage on schema account_api to service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, updated_at timestamptz);
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now());
create table auth.refresh_tokens (id bigint generated always as identity primary key, token text, user_id varchar(255), session_id uuid references auth.sessions(id) on delete cascade);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, provider text);
grant select, update, delete on auth.users to postgres;
grant select on auth.sessions to postgres;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, owner uuid, owner_id text, name text);
create table auth.audit_log_entries (instance_id uuid, id uuid primary key, payload json, created_at timestamptz default now(), ip_address varchar(64));
create function account_api.account_resolve_username_signin_v4(text) returns uuid language sql as 'select null::uuid';
revoke all on function account_api.account_resolve_username_signin_v4(text) from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_signin_v4(text) to service_role;
`;

// Fitness: v1's shapes (keys and ON DELETE actions from the Fitness migrations) plus `position` on the
// two tables the live repack triggers renumber.
const FITNESS = `
create schema fitness;
create table fitness.profiles (id uuid primary key references auth.users(id) on delete cascade, user_number int);
create table fitness.exercises (id uuid primary key, user_id uuid, name text not null);
create table fitness.routines (id uuid primary key, user_id uuid not null, name text);
create table fitness.workout_plan_templates (id uuid primary key, user_id uuid not null, name text, source_routine_day_id uuid);
create table fitness.routine_days (
  id uuid primary key, user_id uuid not null,
  routine_id uuid not null references fitness.routines(id) on delete cascade,
  workout_plan_template_id uuid references fitness.workout_plan_templates(id) on delete set null,
  duplicate_source_routine_day_id uuid references fitness.routine_days(id) on delete set null
);
alter table fitness.workout_plan_templates add foreign key (source_routine_day_id) references fitness.routine_days(id) on delete set null;
create table fitness.workout_plan_template_exercises (
  id uuid primary key, user_id uuid not null,
  workout_plan_template_id uuid not null references fitness.workout_plan_templates(id) on delete cascade
);
create table fitness.routine_day_exercises (
  id uuid primary key, user_id uuid not null,
  routine_day_id uuid not null references fitness.routine_days(id) on delete cascade,
  exercise_id uuid not null references fitness.exercises(id),
  workout_plan_template_exercise_id uuid references fitness.workout_plan_template_exercises(id) on delete set null,
  position int not null default 0
);
create table fitness.sessions (id uuid primary key, user_id uuid not null, routine_id uuid references fitness.routines(id) on delete cascade);
create table fitness.session_exercises (
  id uuid primary key, user_id uuid not null,
  session_id uuid not null references fitness.sessions(id) on delete cascade,
  exercise_id uuid not null references fitness.exercises(id),
  routine_day_exercise_id uuid references fitness.routine_day_exercises(id) on delete set null,
  position int not null default 0
);
create table fitness.sets (id uuid primary key, user_id uuid not null, session_exercise_id uuid not null references fitness.session_exercises(id) on delete cascade, reps int);
create table fitness.session_follow_up_jobs (id uuid primary key, user_id uuid not null, session_id uuid not null references fitness.sessions(id) on delete cascade);
create table fitness.exercise_stats (id uuid primary key, user_id uuid not null, exercise_id uuid not null references fitness.exercises(id) on delete cascade);
create table fitness.progression_events (
  id uuid primary key, user_id uuid not null,
  routine_id uuid not null references fitness.routines(id) on delete cascade,
  routine_day_exercise_id uuid not null references fitness.routine_day_exercises(id) on delete cascade,
  exercise_id uuid not null references fitness.exercises(id) on delete cascade,
  source_session_id uuid references fitness.sessions(id) on delete set null
);
create table fitness.discord_verification_tokens (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, discord_user_id text);
create table fitness.discord_member_links (id uuid primary key, fitness_user_id uuid not null references auth.users(id) on delete cascade, discord_user_id text);
create table fitness.discord_feedback_reports (id uuid primary key, reporter_fitness_user_id uuid references auth.users(id) on delete set null, reporter_discord_user_id text, body text);
create table fitness.discord_moderation_cases (id uuid primary key, target_fitness_user_id uuid references auth.users(id) on delete set null, target_discord_user_id text, reason text);
create table fitness.billing_customers (id uuid primary key, user_id uuid not null);
create table fitness.billing_purchases (id uuid primary key, user_id uuid not null);
create table fitness.user_entitlements (id uuid primary key, user_id uuid not null, granted_via_purchase_id uuid references fitness.billing_purchases(id) on delete set null);
create table fitness.discord_spotify_connections (id uuid primary key, discord_user_id text, spotify_user_id text);
create table fitness.auth_handoffs (id uuid primary key, code_hash text);
`;

const MAZER = `
create schema mazer;
create table mazer.mazer_profiles (user_id uuid primary key references auth.users(id) on delete cascade, username text, total_score int);
create table mazer.mazer_progression_states (user_id uuid primary key references auth.users(id) on delete cascade, level int);
create table mazer.mazer_ai_progression_states (user_id uuid primary key references auth.users(id) on delete cascade, level int);
create table mazer.mazer_cycle_receipts (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, cycle int);
create table mazer.mazer_register_failures (id bigint generated always as identity primary key, user_id uuid, sqlstate text, message text, failed_at timestamptz);
-- Mazer feedback SQL v2 shape (docs/ops/sql-proposals/mazer-feedback-20261124-v2 in the Mazer repo): NOT NULL key, cascade.
create table mazer.mazer_feedback (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, rating smallint not null, comment text, created_at timestamptz not null default now());
create schema fawxzzy_analytics;
create table fawxzzy_analytics.events (id bigint generated always as identity primary key, name text, path text);
`;

// Live-only objects (columns as read from the live catalog 2026-11-16; only the ones that matter here).
const LIVE_LIKE = `
create schema discordos; create schema platform; create schema platform_private; create schema fitness_archive;
create schema atlas_identity_migration; create schema atlas_migration_auth_data_r001;
create table account_private.username_signin_candidates (
  user_id uuid primary key references auth.users(id) on delete cascade, normalized_username text, normalized_alias text);
create table platform.identity_map (
  identity_id uuid primary key, source_system text, source_subject text, mapping_status text not null,
  created_at timestamptz, auth_user_id uuid references auth.users(id) on delete set null);
create table platform.work_projects (id uuid primary key, owner_identity_id uuid references platform.identity_map(identity_id), title text);
create table discordos.discord_feedback_reports (
  report_id text primary key, reporter_fitness_user_id text, reporter_discord_username text, body text,
  updated_at timestamptz not null);
alter table discordos.discord_feedback_reports enable row level security;
alter table discordos.discord_feedback_reports force row level security;
-- Retained on purpose (one stand-in per family in the v2 allow-list).
create table account_private.username_collision_resolution_backup (user_id uuid, original_username text);
create table account_private.username_shorten_backup (user_id uuid, original_username text);
create table atlas_identity_migration.packet_rollback (user_id uuid, email text);
create table atlas_identity_migration.source_identity_map (canonical_user_id uuid, source_user_id uuid);
create table atlas_identity_migration.mapping_wave2_rollback (before_canonical_user_id uuid, source_user_id uuid);
create table atlas_migration_auth_data_r001.identity_map (canonical_auth_user_id uuid);
create table atlas_migration_auth_data_r001.private_auth_payload (canonical_auth_user_id uuid, email text);
create table fitness_archive.sets (id uuid, user_id uuid, reps int);
create table fitness_archive.sessions (id uuid, user_id uuid);
create table fitness_archive.billing_customers (id uuid, user_id uuid);
create table mazer.mazer_identity_map (legacy_user_id uuid, master_user_id uuid);
create table mazer.mazer_register_all_backfill_20261112 (user_id uuid);
create table mazer.mazer_username_backfill_20261112 (user_id uuid, username text);
create table platform_private.operations_operator_grants (subject uuid);
create table platform_private.operations_sessions (subject uuid, opened_at timestamptz);
`;
const RETAINED_TABLES = [
  "account_private.username_collision_resolution_backup", "account_private.username_shorten_backup",
  "atlas_identity_migration.packet_rollback", "atlas_identity_migration.source_identity_map",
  "atlas_identity_migration.mapping_wave2_rollback", "atlas_migration_auth_data_r001.identity_map",
  "atlas_migration_auth_data_r001.private_auth_payload", "fitness_archive.sets", "fitness_archive.sessions",
  "fitness_archive.billing_customers", "mazer.mazer_identity_map", "mazer.mazer_register_all_backfill_20261112",
  "mazer.mazer_username_backfill_20261112", "platform_private.operations_operator_grants", "platform_private.operations_sessions",
];

// The live bodies, byte for byte (the repack bodies use CRLF), with the live search_path settings.
const liveBody = (key) => {
  const src = LIVE[key]?.src;
  if (typeof src !== "string" || src.includes("$live$")) throw new Error(`fixture body missing or unquotable: ${key}`);
  return `$live$${src}$live$`;
};
const LIVE_OBJECTS = `
create or replace function account_private.refresh_username_signin_candidate(candidate text)
returns void language plpgsql security definer set search_path = pg_catalog, account_private
as ${liveBody("account_private.refresh_username_signin_candidate(text)")};
create or replace function account_private.sync_username_signin_index()
returns trigger language plpgsql security definer set search_path = pg_catalog, account_private
as ${liveBody("account_private.sync_username_signin_index()")};
create function discordos.set_updated_at() returns trigger language plpgsql set search_path = discordos, pg_temp
as ${liveBody("discordos.set_updated_at()")};
create trigger set_discord_feedback_reports_updated_at before update on discordos.discord_feedback_reports
for each row execute function discordos.set_updated_at();
create function fitness.repack_routine_day_exercise_positions_after_delete() returns trigger language plpgsql
set search_path = fitness, pg_temp as ${liveBody("fitness.repack_routine_day_exercise_positions_after_delete()")};
create trigger routine_day_exercises_repack_after_delete after delete on fitness.routine_day_exercises
for each row execute function fitness.repack_routine_day_exercise_positions_after_delete();
create function fitness.repack_session_exercise_positions_after_delete() returns trigger language plpgsql
set search_path = fitness, pg_temp as ${liveBody("fitness.repack_session_exercise_positions_after_delete()")};
create trigger session_exercises_repack_after_delete after delete on fitness.session_exercises
for each row execute function fitness.repack_session_exercise_positions_after_delete();
`;

// Live guard, as applied (FIXED4); needed by change username v1 in the interplay scenario.
const GUARD = `
create or replace function account_private.username_claim_normalize(p_username text)
returns text language sql immutable parallel safe set search_path = pg_catalog
as $$ select lower(trim(coalesce(p_username, ''))) $$;
revoke execute on function account_private.username_claim_normalize(text) from public, anon, authenticated;
create or replace function account_private.guard_username_claim()
returns trigger language plpgsql security definer set search_path = pg_catalog, account_private
as $$
declare
  new_claim text;
  old_claim text;
  lock_claim text;
begin
  new_claim := account_private.username_claim_normalize(new.raw_user_meta_data ->> 'username');
  if tg_op = 'UPDATE' then
    old_claim := account_private.username_claim_normalize(old.raw_user_meta_data ->> 'username');
    if new_claim = old_claim then
      return new;
    end if;
  end if;
  if new_claim = '' then
    return new;
  end if;
  for lock_claim in
    select claim from unnest(array[old_claim, new_claim]) claim
    where claim is not null and claim <> ''
    group by claim order by claim
  loop
    perform pg_advisory_xact_lock(hashtextextended('account_username:' || lock_claim, 0));
  end loop;
  if exists (
    select 1 from auth.users other_user
    where lower(trim(coalesce(other_user.raw_user_meta_data ->> 'username', ''))) = new_claim
      and other_user.id is distinct from new.id
  ) then
    raise exception using errcode = '23505', message = 'ACCOUNT_USERNAME_TAKEN';
  end if;
  return new;
end;
$$;
revoke execute on function account_private.guard_username_claim() from public, anon, authenticated;
create trigger account_guard_username_claim
before insert or update of raw_user_meta_data on auth.users
for each row execute function account_private.guard_username_claim();
`;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
const CARA = "cccccccc-0000-4000-8000-000000000003";
const NONAME = "eeeeeeee-0000-4000-8000-000000000005";
const PAYER = "ffffffff-0000-4000-8000-000000000006";
const ACCOUNTS = { ALICE, BOB, CARA, NONAME, PAYER };
const SESSION = Object.fromEntries(Object.entries(ACCOUNTS).map(([k, id]) => [k, id.replace(/^(.{8})-0000/, "$1-5e55")]));
const IDENT = Object.fromEntries(Object.entries(ACCOUNTS).map(([k, id]) => [k, id.replace(/^(.{8})-0000/, "$1-1d1d")]));
const GLOBAL_EXERCISE = "99999999-0000-4000-8000-000000000099";

let seq = 0;
const uid = (prefix) => {
  seq += 1;
  return `${prefix}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/** A full live footprint for one account, plus its retained archive rows. */
function footprint(key, user, tag) {
  const id = () => uid(tag);
  const [ex, routine, template, day, tex, rdx, session, sx] = [id(), id(), id(), id(), id(), id(), id(), id()];
  return `
insert into fitness.profiles (id, user_number) values ('${user}', ${seq});
insert into fitness.exercises (id, user_id, name) values ('${ex}', '${user}', 'custom ${tag}');
insert into fitness.routines (id, user_id, name) values ('${routine}', '${user}', 'routine ${tag}');
insert into fitness.workout_plan_templates (id, user_id, name) values ('${template}', '${user}', 'template ${tag}');
insert into fitness.routine_days (id, user_id, routine_id, workout_plan_template_id) values ('${day}', '${user}', '${routine}', '${template}');
update fitness.workout_plan_templates set source_routine_day_id = '${day}' where id = '${template}';
insert into fitness.workout_plan_template_exercises (id, user_id, workout_plan_template_id) values ('${tex}', '${user}', '${template}');
insert into fitness.routine_day_exercises (id, user_id, routine_day_id, exercise_id, workout_plan_template_exercise_id, position) values ('${rdx}', '${user}', '${day}', '${ex}', '${tex}', 0);
insert into fitness.routine_day_exercises (id, user_id, routine_day_id, exercise_id, position) values ('${id()}', '${user}', '${day}', '${GLOBAL_EXERCISE}', 1);
insert into fitness.sessions (id, user_id, routine_id) values ('${session}', '${user}', '${routine}');
insert into fitness.session_exercises (id, user_id, session_id, exercise_id, routine_day_exercise_id, position) values ('${sx}', '${user}', '${session}', '${ex}', '${rdx}', 0);
insert into fitness.session_exercises (id, user_id, session_id, exercise_id, position) values ('${id()}', '${user}', '${session}', '${GLOBAL_EXERCISE}', 1);
insert into fitness.sets (id, user_id, session_exercise_id, reps) values ('${id()}', '${user}', '${sx}', 8), ('${id()}', '${user}', '${sx}', 6);
insert into fitness.session_follow_up_jobs (id, user_id, session_id) values ('${id()}', '${user}', '${session}');
insert into fitness.exercise_stats (id, user_id, exercise_id) values ('${id()}', '${user}', '${ex}'), ('${id()}', '${user}', '${GLOBAL_EXERCISE}');
insert into fitness.progression_events (id, user_id, routine_id, routine_day_exercise_id, exercise_id, source_session_id) values ('${id()}', '${user}', '${routine}', '${rdx}', '${ex}', '${session}');
insert into fitness.discord_verification_tokens (id, user_id, discord_user_id) values ('${id()}', '${user}', 'd-${tag}');
insert into fitness.discord_member_links (id, fitness_user_id, discord_user_id) values ('${id()}', '${user}', 'd-${tag}');
insert into fitness.discord_feedback_reports (id, reporter_fitness_user_id, reporter_discord_user_id, body) values ('${id()}', '${user}', 'd-${tag}', 'report by ${tag}');
insert into fitness.discord_moderation_cases (id, target_fitness_user_id, target_discord_user_id, reason) values ('${id()}', '${user}', 'd-${tag}', 'case about ${tag}');
insert into mazer.mazer_profiles (user_id, username, total_score) values ('${user}', '${tag}', 100);
insert into mazer.mazer_progression_states (user_id, level) values ('${user}', 7);
insert into mazer.mazer_ai_progression_states (user_id, level) values ('${user}', 3);
insert into mazer.mazer_cycle_receipts (id, user_id, cycle) values ('${id()}', '${user}', 1), ('${id()}', '${user}', 2);
insert into mazer.mazer_register_failures (user_id, sqlstate, message, failed_at) values ('${user}', '23505', 'setup failed', '2026-01-01T00:00:00Z');
insert into mazer.mazer_feedback (user_id, rating, comment) values ('${user}', 4, 'feedback from ${tag}'), ('${user}', 2, null);
insert into storage.objects (bucket_id, owner, name) values ('public-assets', null, '${tag}.png');
insert into platform.identity_map (identity_id, source_system, source_subject, mapping_status, created_at, auth_user_id)
  values ('${IDENT[key]}', 'fitness', 'subject ${tag}', 'mapped', '2026-01-01T00:00:00Z', '${user}');
insert into platform.work_projects (id, owner_identity_id, title) values ('${id()}', '${IDENT[key]}', 'project ${tag}');
insert into discordos.discord_feedback_reports (report_id, reporter_fitness_user_id, reporter_discord_username, body, updated_at)
  values ('report-${tag}', '${user}', 'handle-${tag}', 'feedback ${tag}', '2026-01-01T00:00:00Z');
insert into account_private.username_collision_resolution_backup values ('${user}', 'old-${tag}');
insert into account_private.username_shorten_backup values ('${user}', 'old-${tag}');
insert into atlas_identity_migration.packet_rollback values ('${user}', '${tag}@archive.test');
insert into atlas_identity_migration.source_identity_map values ('${user}', '${user}');
insert into atlas_identity_migration.mapping_wave2_rollback values ('${user}', '${user}');
insert into atlas_migration_auth_data_r001.identity_map values ('${user}');
insert into atlas_migration_auth_data_r001.private_auth_payload values ('${user}', '${tag}@archive.test');
insert into fitness_archive.sets values ('${id()}', '${user}', 5);
insert into fitness_archive.sessions values ('${id()}', '${user}');
insert into fitness_archive.billing_customers values ('${id()}', '${user}');
insert into mazer.mazer_identity_map values ('${user}', '${user}');
insert into mazer.mazer_register_all_backfill_20261112 values ('${user}');
insert into mazer.mazer_username_backfill_20261112 values ('${user}', '${tag}');
insert into platform_private.operations_operator_grants values ('${user}');
insert into platform_private.operations_sessions values ('${user}', '2026-01-01T00:00:00Z');
`;
}

const SEED = `
insert into auth.users (id, email, raw_user_meta_data) values
  ('${ALICE}', 'alice@example.test', '{"username":"Alice","app_namespace":"mazer"}'),
  ('${BOB}', 'bob@example.test', '{"username":"bob"}'),
  ('${CARA}', 'cara@example.test', '{"username":"cara"}'),
  ('${NONAME}', 'NoName@Example.test', '{}'),
  ('${PAYER}', 'payer@example.test', '{"username":"payer"}');
${Object.entries(ACCOUNTS).map(([k, id]) => `
insert into auth.sessions (id, user_id) values ('${SESSION[k]}', '${id}');
insert into auth.refresh_tokens (token, user_id, session_id) values ('rt-${k}', '${id}', '${SESSION[k]}');
insert into auth.identities (user_id, provider) values ('${id}', 'email');`).join("")}
insert into fitness.exercises (id, user_id, name) values ('${GLOBAL_EXERCISE}', null, 'Bench press');
${footprint("ALICE", ALICE, "aaaaaaaa")}
${footprint("BOB", BOB, "bbbbbbbb")}
${footprint("CARA", CARA, "cccccccc")}
${footprint("NONAME", NONAME, "eeeeeeee")}
${footprint("PAYER", PAYER, "ffffffff")}
insert into fitness.billing_purchases (id, user_id) values ('${uid("ffffffff")}', '${PAYER}');
insert into fawxzzy_analytics.events (name, path) values ('page_view', '/account');
`;

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
}

async function tryExec(db, sql) {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    return error;
  }
}

async function fresh({ extra = "" } = {}) {
  const db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(FITNESS);
  await db.exec(MAZER);
  await db.exec(LIVE_LIKE);
  await db.exec(GUARD);
  await db.exec(INDEX_OBJECTS);
  await db.exec(LIVE_OBJECTS);
  await db.exec(SEED);
  if (extra) await db.exec(extra);
  return db;
}

const now = () => Math.floor(Date.now() / 1000);
/** Claims as GoTrue signs them for a fresh password sign-in on the given session. */
const claimsFor = (key, { amrAt = now(), method = "password", session = SESSION[key], sub = ACCOUNTS[key] } = {}) => ({
  sub,
  role: "authenticated",
  session_id: session,
  amr: amrAt === null ? undefined : [{ method, timestamp: amrAt }],
});

/** Calls the API as the given role with the given claims (null = signed out). */
async function as(db, role, claims, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      if (claims) await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (error) {
    return { error };
  }
}

const del = async (db, claims, confirm) => {
  const result = await as(db, "authenticated", claims, "select account_api.account_delete_self($1) as r", [confirm]);
  return result.error ? `error:${result.error.code ?? ""}:${result.error.message}${result.error.detail ? ` (${result.error.detail})` : ""}` : result.rows[0].r;
};

const UNLINKED_TABLES = ["fitness.discord_feedback_reports", "fitness.discord_moderation_cases", "discordos.discord_feedback_reports", "platform.identity_map"];
const TABLES = [
  "auth.users", "auth.sessions", "auth.refresh_tokens", "auth.identities",
  "fitness.profiles", "fitness.exercises", "fitness.routines", "fitness.workout_plan_templates", "fitness.routine_days",
  "fitness.workout_plan_template_exercises", "fitness.routine_day_exercises", "fitness.sessions", "fitness.session_exercises",
  "fitness.sets", "fitness.session_follow_up_jobs", "fitness.exercise_stats", "fitness.progression_events",
  "fitness.discord_verification_tokens", "fitness.discord_member_links", "fitness.discord_feedback_reports",
  "fitness.discord_moderation_cases", "fitness.billing_customers", "fitness.billing_purchases", "fitness.user_entitlements",
  "fitness.discord_spotify_connections", "fitness.auth_handoffs",
  "mazer.mazer_profiles", "mazer.mazer_progression_states", "mazer.mazer_ai_progression_states", "mazer.mazer_cycle_receipts",
  "mazer.mazer_register_failures", "mazer.mazer_feedback",
  "account_private.username_signin_index", "account_private.username_signin_candidates",
  "platform.identity_map", "platform.work_projects", "discordos.discord_feedback_reports",
  "fawxzzy_analytics.events", "storage.objects",
  ...RETAINED_TABLES,
];

/** Every row of every table, as JSON text, keyed by table. */
async function snapshot(db) {
  const out = {};
  for (const table of TABLES) {
    out[table] = (await db.query(`select to_jsonb(t)::text j from ${table} t`)).rows.map((r) => r.j).sort();
  }
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** True when a row (as JSON text) mentions the account id or its session anywhere. */
const mentions = (row, key) => row.includes(ACCOUNTS[key]) || row.includes(SESSION[key]);

/** The reviewed_triggers pins in a SQL text. */
const pinsIn = (sql) => [...new Set(sql.match(/'[a-z_.]+\|[a-z_]+\|[a-z_.]+\|[0-9a-f]{32}\|\d+'/g) ?? [])].map((s) => s.slice(1, -1)).sort();
/** Only the repo migration's sync function statement (its body differs from the live one). */
const repoSyncFunction = () => {
  const start = INDEX_OBJECTS.indexOf("create or replace function account_private.sync_username_signin_index");
  const end = INDEX_OBJECTS.indexOf("$$;", INDEX_OBJECTS.indexOf("as $$", start) + 5) + 3;
  return INDEX_OBJECTS.slice(start, end);
};

(async () => {
  console.log(`apply    sha256: ${sha(APPLY_PATH)}`);
  console.log(`rollback sha256: ${sha(ROLLBACK_PATH)}`);
  console.log(`preimage sha256: ${sha(PREIMAGE_PATH)}`);
  console.log(`fixture  sha256: ${sha(LIVE_PATH)}\n`);

  // The live bodies in the fixture are the ones the SQL pins.
  const pins = pinsIn(APPLY);
  check("pins: the apply pins four reviewed triggers, the same in the preflight and the function", pins.length === 4
    && (APPLY.match(/b9b39b13b97ce3ac15daabe487600ff7/g) ?? []).length === 2, pins.join(" ; "));
  check("pins: the preimage pins the same four", same(pinsIn(PREIMAGE), pins), pinsIn(PREIMAGE).join(" ; "));
  for (const pin of pins) {
    const [, , fn, hash] = pin.split("|");
    const entry = LIVE[`${fn}()`];
    check(`pins: fixture body of ${fn} hashes to the pinned md5`, entry && md5(entry.src) === hash && entry.md5 === hash, entry?.md5);
  }

  let db = await fresh();
  const installed = (await db.query(`
    select format('%s.%s|%s|%s.%s|%s|%s', n.nspname, c.relname, t.tgname, pn.nspname, p.proname, md5(p.prosrc), t.tgtype) pin
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal`)).rows.map((r) => r.pin);
  check("scratch: the installed live triggers match all four pins exactly (body md5 and trigger type)",
    pins.every((pin) => installed.includes(pin)), installed.join(" ; "));
  check("scratch: the sign-in sync trigger filled the live candidates projection",
    Number((await db.query("select count(*) c from account_private.username_signin_candidates")).rows[0].c) === 4);

  // v1 refuses this live-like database, as it refused the live one.
  let error = await tryExec(db, V1);
  check("v1: refuses the live-like scratch database (as on live 2026-11-16)", /UNLISTED_ACCOUNT_COLUMNS/.test(error?.message ?? ""), error?.message?.slice(0, 160));

  let result = await as(db, "postgres", null, PREIMAGE);
  check("preimage: runs read-only on the scratch database", !result.error, result.error?.message);
  let pre = result.rows?.[0] && JSON.parse(Object.values(result.rows[0])[0]);
  check("preimage: nothing blocking", same(pre?.blocking, []), JSON.stringify(pre?.blocking));
  check("preimage: no unknown account columns", same(pre?.unknown_account_columns, []), JSON.stringify(pre?.unknown_account_columns));
  check("preimage: no unreviewed trigger, no unexpected cascade", same(pre?.unreviewed_triggers, []) && same(pre?.unexpected_cascades, []),
    JSON.stringify([pre?.unreviewed_triggers, pre?.unexpected_cascades]));
  check("preimage: the three expected key effects (candidates, identity_map, feedback) found once, nothing references them",
    pre?.expected_fk_effects?.length === 3 && pre.expected_fk_effects.every((e) => Number(e.matching_keys) === 1 && e.referenced_by.length === 0),
    JSON.stringify(pre?.expected_fk_effects));
  check("preimage: retained columns counted, rows naming live accounts shown",
    pre?.known_retained?.find((r) => r.item === "atlas_identity_migration.packet_rollback.user_id")?.rows_naming_live_accounts === 5
      && pre.known_retained.find((r) => r.item === "fitness_archive.exercises.user_id")?.rows === null,
    JSON.stringify(pre?.known_retained?.slice(0, 3)));
  check("preimage: discordos text link counted", Number(pre?.discordos_text_link?.rows_naming_live_accounts) === 5, JSON.stringify(pre?.discordos_text_link));
  check("preimage: the four reviewed triggers are the ones firing here", (pre?.triggers_firing_here ?? []).length === 4, JSON.stringify(pre?.triggers_firing_here));
  check("preimage: largest per-account counts and negative positions",
    Number(pre?.max_rows_one_account?.["fitness.sets"]) === 2 && Number(pre?.negative_positions?.session_exercises) === 0,
    JSON.stringify([pre?.max_rows_one_account, pre?.negative_positions]));

  error = await tryExec(db, APPLY);
  check("apply: runs cleanly on a database shaped like production", error === null, error?.message);
  const proconfig = async (sig) => (await db.query(`select proconfig from pg_proc where oid = '${sig}'::regprocedure`)).rows[0].proconfig;
  const outer = await proconfig("account_api.account_delete_self(text)");
  const inner = await proconfig("account_private.delete_account_v2(uuid, jsonb, text)");
  check("timeouts: the API wrapper carries statement_timeout=30s (PostgREST reads it per call)", outer.includes("statement_timeout=30s"), JSON.stringify(outer));
  check("timeouts: the inner function carries lock_timeout=3s and an empty search_path", inner.includes("lock_timeout=3s") && inner.includes('search_path=""'), JSON.stringify(inner));

  result = await as(db, "postgres", null, PREIMAGE);
  pre = result.rows?.[0] && JSON.parse(Object.values(result.rows[0])[0]);
  check("preimage after apply: reports the proposal objects as blocking a second apply",
    (pre?.blocking ?? []).includes("v1 or v2 objects present"), JSON.stringify(pre?.blocking));

  // Who may call.
  result = await as(db, "anon", null, "select account_api.account_delete_self('x') r");
  check("anon: no access to account_api", result.error?.code === "42501", result.error?.message);
  result = await as(db, "authenticated", null, "select account_api.account_delete_self('x') r");
  check("authenticated without a subject: refused", result.error?.message === "ACCOUNT_DELETE_NOT_SIGNED_IN", result.error?.message);
  result = await as(db, "authenticated", claimsFor("ALICE"), `select account_private.delete_account_v2('${BOB}', '{}'::jsonb, 'bob') r`);
  check("authenticated: inner function (any user id) not callable", result.error?.code === "42501", result.error?.message);
  for (const table of ["account_private.account_delete_attempts", "account_private.account_deletions"]) {
    result = await as(db, "authenticated", claimsFor("ALICE"), `select count(*) from ${table}`);
    check(`authenticated: ${table} not readable`, result.error?.code === "42501", result.error?.message);
  }

  const before = await snapshot(db);

  // Refusals (same contract as v1).
  check("reauth: no amr", (await del(db, claimsFor("ALICE", { amrAt: null }), "alice")) === "reauth");
  check("reauth: password sign-in 11 minutes ago", (await del(db, claimsFor("ALICE", { amrAt: now() - 660 }), "alice")) === "reauth");
  check("reauth: another account's live session", (await del(db, claimsFor("ALICE", { session: SESSION.BOB }), "alice")) === "reauth");
  const attemptCount = async (key) => Number((await db.query("select count(*) c from account_private.account_delete_attempts where user_id = $1", [ACCOUNTS[key]])).rows[0].c);
  check("rate: reauth refusals wrote no attempt rows", (await attemptCount("ALICE")) === 0);
  check("confirm: typed text is not the username", (await del(db, claimsFor("ALICE"), "alicia")) === "confirm");
  for (let i = 0; i < 4; i += 1) await del(db, claimsFor("ALICE"), "wrong");
  check("rate: 6th proven call within 15 minutes is refused", (await del(db, claimsFor("ALICE"), "Alice")) === "rate");
  await db.query("update account_private.account_delete_attempts set attempted_at = now() - interval '16 minutes' where user_id = $1", [ALICE]);
  check("refusals changed no account data (only attempt rows)", same(await snapshot(db), before));
  check("billing: an account with a purchase is not deleted", (await del(db, claimsFor("PAYER"), "payer")) === "billing");

  // Call-time trigger re-check: a trigger added after the apply, or a changed repack body, stops the call.
  await db.exec(`create function public.noop_trigger() returns trigger language plpgsql as $$ begin return old; end $$;
create trigger zz_audit after delete on mazer.mazer_register_failures for each row execute function public.noop_trigger();`);
  let beforeCall = await snapshot(db);
  let outcome = await del(db, claimsFor("BOB"), "bob");
  check("call-time: a delete trigger added after the apply stops the call", /ACCOUNT_DELETE_UNREVIEWED_TRIGGER.*mazer\.mazer_register_failures\.zz_audit/.test(outcome), outcome);
  check("call-time (new trigger): nothing deleted", same(await snapshot(db), beforeCall));
  await db.exec("drop trigger zz_audit on mazer.mazer_register_failures");
  await db.exec(`create or replace function fitness.repack_session_exercise_positions_after_delete() returns trigger language plpgsql
set search_path = fitness, pg_temp as $$ begin return old; end $$;`);
  outcome = await del(db, claimsFor("BOB"), "bob");
  check("call-time: a changed repack body (md5 differs from the pin) stops the call",
    /ACCOUNT_DELETE_UNREVIEWED_TRIGGER.*fitness\.session_exercises\.session_exercises_repack_after_delete/.test(outcome), outcome);
  check("call-time (changed body): nothing deleted", same(await snapshot(db), beforeCall));
  await db.exec(LIVE_OBJECTS.slice(LIVE_OBJECTS.indexOf("create function fitness.repack_session_exercise_positions_after_delete"),
    LIVE_OBJECTS.indexOf("create trigger session_exercises_repack_after_delete")).replace("create function", "create or replace function"));
  await db.query("update account_private.account_delete_attempts set attempted_at = now() - interval '16 minutes'");

  // The delete itself.
  const beforeDelete = await snapshot(db);
  outcome = await del(db, claimsFor("ALICE"), "  ALICE ");
  check("deleted: typed username matches trimmed and in any case", outcome === "deleted", outcome);
  const after = await snapshot(db);
  const leftovers = [];
  const collateral = [];
  for (const table of TABLES) {
    if (RETAINED_TABLES.includes(table)) continue;
    leftovers.push(...after[table].filter((row) => mentions(row, "ALICE")).map((row) => `${table}: ${row}`));
    if (UNLINKED_TABLES.includes(table)) continue;
    if (!same(beforeDelete[table].filter((row) => !mentions(row, "ALICE")), after[table].filter((row) => !mentions(row, "ALICE")))) collateral.push(table);
  }
  check("deleted: no live row anywhere still names alice (id or session)", leftovers.length === 0, leftovers.slice(0, 3).join(" | "));
  check("deleted: every other account's live rows are byte-for-byte unchanged", collateral.length === 0, collateral.join(","));
  const retainedChanged = RETAINED_TABLES.filter((t) => !same(beforeDelete[t], after[t]));
  check("retained: every archive/backup table is byte-for-byte unchanged (alice's rows kept on purpose)", retainedChanged.length === 0, retainedChanged.join(","));
  check("retained: ...and they still hold alice's rows", RETAINED_TABLES.every((t) => after[t].some((row) => mentions(row, "ALICE"))));
  for (const key of ["BOB", "CARA", "NONAME", "PAYER"]) {
    const count = (snap) => TABLES.reduce((sum, t) => sum + snap[t].filter((row) => mentions(row, key)).length, 0);
    check(`deleted: ${key.toLowerCase()} keeps all ${count(beforeDelete)} rows`, count(beforeDelete) === count(after) && count(after) > 30, `${count(beforeDelete)} -> ${count(after)}`);
  }
  for (const table of UNLINKED_TABLES) {
    const others = (snap) => snap[table].filter((row) => !row.includes("aaaaaaaa"));
    check(`unlinked: ${table} keeps every other account's row unchanged`, same(others(beforeDelete), others(after)));
    check(`unlinked: ${table} keeps alice's row, without the account link`, after[table].length === beforeDelete[table].length
      && after[table].filter((row) => row.includes("aaaaaaaa")).length === 1, String(after[table].length));
  }
  const ds = (await db.query("select reporter_fitness_user_id, reporter_discord_username, updated_at > '2026-06-01' bumped from discordos.discord_feedback_reports where report_id = 'report-aaaaaaaa'")).rows[0];
  check("unlinked: the discordos report keeps the Discord handle and text; updated_at moved (live trigger ran)",
    ds?.reporter_fitness_user_id === null && ds?.reporter_discord_username === "handle-aaaaaaaa" && ds?.bumped === true, JSON.stringify(ds));
  const im = (await db.query(`select auth_user_id, source_subject from platform.identity_map where identity_id = '${IDENT.ALICE}'`)).rows[0];
  check("unlinked: platform.identity_map row stays, auth_user_id set null by the key", im && im.auth_user_id === null, JSON.stringify(im));
  check("deleted: candidates projection row gone (cascade + live sync trigger)",
    Number((await db.query(`select count(*) c from account_private.username_signin_candidates where user_id = '${ALICE}'`)).rows[0].c) === 0);
  check("deleted: alice's feedback rows gone through the cascade (the live function walks no feedback table), other accounts' feedback kept",
    Number((await db.query(`select count(*) c from mazer.mazer_feedback where user_id = '${ALICE}'`)).rows[0].c) === 0
    && Number((await db.query(`select count(*) c from mazer.mazer_feedback where user_id = '${BOB}'`)).rows[0].c) === 2);
  check("deleted: Mazer sign-up failure rows gone",
    Number((await db.query(`select count(*) c from mazer.mazer_register_failures where user_id = '${ALICE}'`)).rows[0].c) === 0);
  const positions = (await db.query("select string_agg(position::text, ',' order by user_id, position) p from fitness.session_exercises")).rows[0].p;
  check("repack: other accounts' positions unchanged and none negative after the delete", positions === "0,1,0,1,0,1,0,1", positions);
  const audit = (await db.query("select to_jsonb(d)::text j, subject_hash, row_counts, version from account_private.account_deletions d")).rows;
  const expectedHash = crypto.createHash("sha256").update(`fawxzzy-account-delete-v1:${ALICE}`).digest("hex");
  check("audit: one v2 row with the hashed id", audit.length === 1 && audit[0].subject_hash === expectedHash && audit[0].version === "v2");
  check("audit: no id, email or username in the row", audit.length === 1 && !/alice|aaaaaaaa/i.test(audit[0].j), audit[0]?.j);
  const rc = audit[0]?.row_counts ?? {};
  check("audit: counts per table, unlinks and key effects", rc["fitness.sets"] === 2 && rc["fitness.session_exercises"] === 2
    && rc["fitness.routine_day_exercises"] === 2 && rc["mazer.mazer_register_failures"] === 1
    && rc["discordos.discord_feedback_reports(unlinked)"] === 1 && rc["fitness.discord_feedback_reports(unlinked)"] === 1
    && rc["account_private.username_signin_candidates(cascade)"] === 1 && rc["platform.identity_map(unlinked)"] === 1
    && rc["mazer.mazer_feedback(cascade)"] === 2, JSON.stringify(rc));
  check("gone: a second call answers gone", (await del(db, claimsFor("ALICE"), "alice")) === "gone");
  check("confirm: an account without a username types its email", (await del(db, claimsFor("NONAME"), "noname@example.TEST")) === "deleted");
  check("deleted (no username): identity unlinked, no candidates row existed",
    (await db.query(`select auth_user_id from platform.identity_map where identity_id = '${IDENT.NONAME}'`)).rows[0].auth_user_id === null);

  // Cross-account guard and row locks (v1 behaviour, unchanged).
  const caraEx = (await db.query(`select id from fitness.exercises where user_id = '${CARA}'`)).rows[0].id;
  const bobStat = uid("bbbbbbbb");
  await db.exec(`insert into fitness.exercise_stats (id, user_id, exercise_id) values ('${bobStat}', '${BOB}', '${caraEx}')`);
  let beforeCara = await snapshot(db);
  outcome = await del(db, claimsFor("CARA"), "cara");
  check("cross-account: another account's cascading row on cara's custom exercise makes the call refuse", outcome === "support", outcome);
  check("cross-account: nothing at all was deleted or changed", same(await snapshot(db), beforeCara));
  await db.exec(`delete from fitness.exercise_stats where id = '${bobStat}'`);
  // Another account's session exercise inside cara's session: the walk refuses before the repack could
  // ever renumber another account's row.
  const caraSession = (await db.query(`select id from fitness.sessions where user_id = '${CARA}'`)).rows[0].id;
  await db.exec(`insert into fitness.session_exercises (id, user_id, session_id, exercise_id, position) values ('${uid("bbbbbbbb")}', '${BOB}', '${caraSession}', '${GLOBAL_EXERCISE}', 2)`);
  beforeCara = await snapshot(db);
  outcome = await del(db, claimsFor("CARA"), "cara");
  check("cross-account: another account's row inside cara's session refuses (repack never reaches it)", outcome === "support", outcome);
  check("cross-account (session): nothing changed", same(await snapshot(db), beforeCara));
  await db.exec(`delete from fitness.session_exercises where user_id = '${BOB}' and session_id = '${caraSession}'`);
  // An unlisted NO ACTION key into the set-null table's other column is allowed; into cara's rows it fails.
  await db.exec(`create table public.exercise_pins (id uuid primary key, exercise_id uuid references fitness.exercises(id));
insert into public.exercise_pins (id, exercise_id) values ('${uid("cccccccc")}', '${caraEx}');`);
  beforeCara = await snapshot(db);
  outcome = await del(db, claimsFor("CARA"), "cara");
  check("transaction: an unlisted table's NO ACTION key makes the call fail, nothing deleted",
    outcome.startsWith("error:23503") && same(await snapshot(db), beforeCara), outcome);
  await db.exec("drop table public.exercise_pins");
  await db.query("update account_private.account_delete_attempts set attempted_at = now() - interval '16 minutes'");
  outcome = await del(db, claimsFor("CARA"), "cara");
  check("deleted: cara (work_projects still points at her unlinked identity row: NO ACTION on identity_id is fine)", outcome === "deleted", outcome);
  check("deleted: cara's work project kept, identity unlinked",
    Number((await db.query(`select count(*) c from platform.work_projects w join platform.identity_map i on i.identity_id = w.owner_identity_id where i.identity_id = '${IDENT.CARA}' and i.auth_user_id is null`)).rows[0].c) === 1);

  // Preflight and rollback.
  error = await tryExec(db, APPLY);
  check("second apply: refused by preflight", /DELETE_ACCOUNT_PREFLIGHT_ALREADY_PRESENT/.test(error?.message ?? ""), error?.message);
  error = await tryExec(db, ROLLBACK);
  check("rollback: runs cleanly", error === null, error?.message);
  check("rollback: audit rows kept", Number((await db.query("select count(*) c from account_private.account_deletions")).rows[0].c) === 3);
  check("rollback: USAGE on account_api taken back (nothing else needs it)",
    (await db.query("select has_schema_privilege('authenticated', 'account_api', 'usage') u")).rows[0].u === false);
  error = await tryExec(db, APPLY);
  check("re-apply after rollback: runs cleanly (reuses the audit table)", error === null, error?.message);
  check("re-apply: works", (await del(db, claimsFor("BOB"), "bob")) === "deleted");
  await db.close();

  // Locked vs changed: a row that appears for this account between the row locks and the deletes (a
  // concurrent insert under READ COMMITTED) makes the call raise and roll back. pglite has one
  // connection, so the insert is injected into a TEST-ONLY copy of the function at that exact point.
  const marker = "  -- Delete and unlink, in order.";
  const INJECTED = APPLY.replace(marker, `  execute 'insert into fitness.sessions (id, user_id) values (gen_random_uuid(), $1)' using p_user_id;\n${marker}`);
  check("locked vs changed: injection point found", INJECTED !== APPLY);
  db = await fresh();
  error = await tryExec(db, INJECTED);
  check("locked vs changed: test-only copy applies", error === null, error?.message);
  const beforeInjected = await snapshot(db);
  outcome = await del(db, claimsFor("CARA"), "cara");
  check("locked vs changed: a row the locks never saw makes the call raise ROWCOUNT_EXCEEDS_LOCKED",
    /ACCOUNT_DELETE_ROWCOUNT_EXCEEDS_LOCKED.*fitness\.sessions: changed 2, locked 1/.test(outcome), outcome);
  check("locked vs changed: nothing deleted (the injected row rolled back too)", same(await snapshot(db), beforeInjected));
  await db.close();

  // Repack triggers outside the delete: the live bodies work on a single-row delete, and reproduce the
  // known Fitness bug (rows after the deleted one end up negative). Not changed by this file; the call
  // above never leaves a row for them to move.
  db = await fresh();
  const bobDay = (await db.query(`select id from fitness.routine_days where user_id = '${BOB}'`)).rows[0].id;
  await db.exec(`insert into fitness.routine_day_exercises (id, user_id, routine_day_id, exercise_id, position) values ('${uid("bbbbbbbb")}', '${BOB}', '${bobDay}', '${GLOBAL_EXERCISE}', 2)`);
  await db.exec(`delete from fitness.routine_day_exercises where user_id = '${BOB}' and position = 0`);
  const bobPositions = (await db.query(`select string_agg(position::text, ',' order by id) p from fitness.routine_day_exercises where user_id = '${BOB}'`)).rows[0].p;
  check("repack (known Fitness bug, not changed here): deleting position 0 leaves the later rows negative", /-/.test(bobPositions ?? ""), bobPositions);
  check("repack: other accounts untouched by that single delete",
    (await db.query(`select string_agg(position::text, ',' order by user_id, position) p from fitness.routine_day_exercises where user_id <> '${BOB}'`)).rows[0].p === "0,1,0,1,0,1,0,1");
  await db.close();

  // Interplay with change username v1 (apply that first, as documented).
  db = await fresh();
  error = await tryExec(db, CHANGE);
  check("interplay: change username v1 applies first", error === null, error?.message);
  error = await tryExec(db, APPLY);
  check("interplay: delete v2 applies on top of it", error === null, error?.message);
  result = await as(db, "authenticated", claimsFor("BOB"), "select account_api.account_change_username('bobby') r");
  check("interplay: change username still works (live sync trigger updates the candidates row)", result.rows?.[0]?.r === "changed"
    && (await db.query(`select normalized_username n from account_private.username_signin_candidates where user_id = '${BOB}'`)).rows[0]?.n === "bobby", result.error?.message);
  check("interplay: delete removes the account's username change attempts", (await del(db, claimsFor("BOB"), "bobby")) === "deleted"
    && Number((await db.query(`select count(*) c from account_private.username_change_attempts where user_id = '${BOB}'`)).rows[0].c) === 0);
  error = await tryExec(db, ROLLBACK);
  check("interplay: delete rollback keeps USAGE while change username needs it", error === null
    && (await db.query("select has_schema_privilege('authenticated', 'account_api', 'usage') u")).rows[0].u === true, error?.message);
  await db.close();

  // Owned by a role that is NOT a superuser, with production-like grants (prod `postgres` has BYPASSRLS).
  db = await fresh();
  await db.exec(APPLY);
  await db.exec(`
create role sim_owner nologin noinherit bypassrls;
grant usage on schema auth, fitness, mazer, account_private, storage, discordos, platform to sim_owner;
grant select on storage.objects to sim_owner;
grant select, update, delete on auth.users to sim_owner;
grant select on auth.sessions to sim_owner;
grant select, delete, update on all tables in schema fitness, mazer to sim_owner;
grant select, update on discordos.discord_feedback_reports to sim_owner;
grant select on platform.identity_map, account_private.username_signin_candidates to sim_owner;
grant select, insert, update, delete on account_private.account_delete_attempts, account_private.username_signin_index to sim_owner;
grant select, insert on account_private.account_deletions to sim_owner;
grant execute on function auth.uid(), auth.jwt() to sim_owner;
alter function account_private.delete_account_v2(uuid, jsonb, text) owner to sim_owner;
alter function account_api.account_delete_self(text) owner to sim_owner;
`);
  for (const table of TABLES.filter((t) => /^(fitness|mazer)\./.test(t))) await db.exec(`alter table ${table} enable row level security`);
  await db.exec("alter table storage.objects enable row level security");
  outcome = await del(db, claimsFor("CARA"), "cara");
  check("non-superuser owner: delete works (forced RLS on discordos bypassed by BYPASSRLS, repack runs as the owner)", outcome === "deleted", outcome);
  check("non-superuser owner: cara fully gone, discordos unlinked",
    Number((await db.query(`select count(*) c from fitness.session_exercises where user_id = '${CARA}'`)).rows[0].c) === 0
    && Number((await db.query(`select count(*) c from discordos.discord_feedback_reports where reporter_fitness_user_id = '${CARA}'`)).rows[0].c) === 0);
  await db.close();

  // Preflight refusals: a database that differs from the reviewed picture fails the apply.
  const fn = "create function public.noop() returns trigger language plpgsql as $$ begin return old; end $$;";
  const refusals = [
    ["an unknown table with a user_id column", "create table public.notes (id uuid primary key, user_id uuid, body text);", /UNKNOWN_ACCOUNT_COLUMNS: public\.notes\.user_id/],
    ["a TEXT column named like an account id", "create table public.discord_log (id bigint, reporter_fitness_user_id text);", /UNKNOWN_ACCOUNT_COLUMNS: public\.discord_log\.reporter_fitness_user_id/],
    ["an unknown foreign key to auth.users", "create table public.things (id uuid primary key, who uuid references auth.users(id));", /UNKNOWN_ACCOUNT_COLUMNS: public\.things\.who/],
    ["a new archive table (the allow-list is per column, not per schema)", "create table fitness_archive.mazer_profiles (user_id uuid);", /UNKNOWN_ACCOUNT_COLUMNS: fitness_archive\.mazer_profiles\.user_id/],
    ["the feedback key no longer cascading",
      "alter table mazer.mazer_feedback drop constraint mazer_feedback_user_id_fkey, add foreign key (user_id) references auth.users(id) on delete no action;",
      /EXPECTED_FK_EFFECT_MISSING: mazer\.mazer_feedback/],
    ["a table referencing the cascaded feedback table",
      "create table public.feedback_ref (id int, fb uuid references mazer.mazer_feedback(id));",
      /EXPECTED_FK_EFFECT_IS_REFERENCED: mazer\.mazer_feedback/],
    ["a DELETE trigger on the cascaded feedback table", `${fn} create trigger feedback_audit after delete on mazer.mazer_feedback for each row execute function public.noop();`,
      /UNREVIEWED_TRIGGER: mazer\.mazer_feedback\.feedback_audit/],
    ["a listed table that is missing", "drop table mazer.mazer_register_failures;", /LISTED_TABLE_MISSING: mazer\.mazer_register_failures/],
    ["the discordos link that is no longer text",
      "alter table discordos.discord_feedback_reports alter column reporter_fitness_user_id type uuid using reporter_fitness_user_id::uuid;",
      /LISTED_COLUMN_MISSING_OR_WRONG_TYPE: discordos\.discord_feedback_reports\.reporter_fitness_user_id/],
    ["the candidates key no longer cascading",
      "alter table account_private.username_signin_candidates drop constraint username_signin_candidates_user_id_fkey, add foreign key (user_id) references auth.users(id) on delete set null;",
      /EXPECTED_FK_EFFECT_MISSING: account_private\.username_signin_candidates/],
    ["the identity_map key cascading instead of set null",
      "alter table platform.identity_map drop constraint identity_map_auth_user_id_fkey, add foreign key (auth_user_id) references auth.users(id) on delete cascade;",
      /EXPECTED_FK_EFFECT_MISSING: platform\.identity_map/],
    ["a table referencing the cascaded candidates table",
      "create table public.cand_ref (id int, cand uuid references account_private.username_signin_candidates(user_id));",
      /EXPECTED_FK_EFFECT_IS_REFERENCED: account_private\.username_signin_candidates/],
    ["an unlisted table whose key cascades from a deleted table",
      "create table public.exercise_notes (id uuid primary key, exercise_id uuid references fitness.exercises(id) on delete cascade);",
      /CASCADE_REACHES_UNLISTED_TABLE: public\.exercise_notes -> fitness\.exercises/],
    ["an unlisted table whose key is set null from the new Mazer diagnostics table",
      "create table public.failure_notes (id int, failure_id bigint references mazer.mazer_register_failures(id) on delete set null);",
      /CASCADE_REACHES_UNLISTED_TABLE: public\.failure_notes -> mazer\.mazer_register_failures/],
    ["a DELETE trigger on a deleted table", `${fn} create trigger renumber after delete on fitness.profiles for each row execute function public.noop();`,
      /UNREVIEWED_TRIGGER: fitness\.profiles\.renumber/],
    ["another DELETE trigger on auth.users", `${fn} create trigger audit_users after delete on auth.users for each row execute function public.noop();`,
      /UNREVIEWED_TRIGGER: auth\.users\.audit_users/],
    ["a DELETE trigger on the cascaded candidates table", `${fn} create trigger cand_audit after delete on account_private.username_signin_candidates for each row execute function public.noop();`,
      /UNREVIEWED_TRIGGER: account_private\.username_signin_candidates\.cand_audit/],
    ["an UPDATE trigger on an unlinked table", `${fn} create trigger fb_audit after update on fitness.discord_feedback_reports for each row execute function public.noop();`,
      /UNREVIEWED_TRIGGER: fitness\.discord_feedback_reports\.fb_audit/],
    ["an UPDATE trigger on the set-null identity table", `${fn} create trigger im_audit after update on platform.identity_map for each row execute function public.noop();`,
      /UNREVIEWED_TRIGGER: platform\.identity_map\.im_audit/],
    ["a changed repack trigger body",
      "create or replace function fitness.repack_routine_day_exercise_positions_after_delete() returns trigger language plpgsql as $$ begin return old; end $$;",
      /UNREVIEWED_TRIGGER: fitness\.routine_day_exercises\.routine_day_exercises_repack_after_delete/],
    ["a changed sign-in sync trigger body (the repo migration's version, not the live one)",
      repoSyncFunction(),
      /UNREVIEWED_TRIGGER: auth\.users\.sync_username_signin_index/],
    ["delete v1 already applied", "create function account_private.delete_account_v1(uuid, jsonb, text) returns text language sql as 'select null::text';",
      /DELETE_ACCOUNT_PREFLIGHT_ALREADY_PRESENT/],
    ["Storage files owned by an account", `insert into storage.objects (bucket_id, owner_id, name) values ('uploads', '${BOB}', 'me.png');`, /STORAGE_HAS_ACCOUNT_OWNED_FILES: uploads/],
    ["an account_api function executable by authenticated", "create function account_api.leaky() returns int language sql as 'select 1';", /EXECUTABLE_BY_AUTHENTICATED: account_api\.leaky\(\)/],
    ["anon with USAGE on account_api", "grant usage on schema account_api to anon;", /ANON_HAS_ACCOUNT_API_USAGE/],
    ["an audit table of another shape", "create table account_private.account_deletions (id bigint, email text);", /AUDIT_TABLE_SHAPE_DIFFERS/],
    ["a profiles table without user_number", "alter table fitness.profiles drop column user_number;", /RESERVED_PROFILE_COLUMN_MISSING/],
  ];
  for (const [name, extra, pattern] of refusals) {
    db = await fresh({ extra });
    error = await tryExec(db, APPLY);
    check(`preflight: refuses ${name}`, pattern.test(error?.message ?? ""), error?.message);
    check(`preflight (${name}): nothing left behind`,
      (await db.query("select to_regprocedure('account_private.delete_account_v2(uuid, jsonb, text)') f, to_regclass('account_private.account_delete_attempts') t")).rows
        .every((r) => r.f === null && r.t === null));
    await db.close();
  }

  db = await fresh({ extra: "drop table mazer.mazer_feedback;" });
  error = await tryExec(db, APPLY);
  check("preflight: applies when mazer.mazer_feedback is absent (optional until the Mazer feedback SQL is applied)", error === null, error?.message);
  const absentReport = await tryExec(db, PREIMAGE);
  check("preimage: runs when mazer.mazer_feedback is absent", absentReport === null, absentReport?.message);
  await db.close();

  db = await fresh({ extra: "grant usage on schema account_api to authenticated;" });
  error = await tryExec(db, APPLY);
  check("preflight: tolerates USAGE already granted (change username v1 applied first)", error === null, error?.message);
  await db.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
