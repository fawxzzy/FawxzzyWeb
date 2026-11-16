// Scratch test for the PROPOSED delete-account v1 SQL (in-memory Postgres 17 via pglite; never touches
// Supabase). Owner-run before approving the SQL; not part of CI (CI checks the file shape only, in
// tests/account-delete.test.mjs).
//
// Layers, in order:
//   1. stand-ins for Supabase: roles anon/authenticated/service_role, auth.users / auth.sessions /
//      auth.refresh_tokens / auth.identities (only the columns used, GoTrue's cascades), auth.uid() and
//      auth.jwt() (same claim lookup as Supabase's), Storage's objects table, one service-role-only
//      account_api function;
//   2. the Fitness tables (schema fitness) with the foreign keys and ON DELETE actions from the Fitness
//      migrations, and the Mazer tables (schema mazer), shaped from the repos' generated types;
//   3. the live username guard and the REAL sign-in index objects from
//      supabase/migrations/20260826163000_account_username_signin_index.sql;
//   4. the file under test, run verbatim; then its rollback, a re-apply, the read-only preimage, the
//      interplay with change username v1, and preflight refusals.
//
// The proof that matters: deleting one account removes exactly that account's rows in every schema and
// leaves every other row byte-for-byte the same (a full before/after snapshot of every table).
//
// Usage (pglite pinned at 0.5.13, installed with `npm ci --ignore-scripts` in its own folder):
//   PGLITE_SANDBOX=<folder with node_modules/@electric-sql/pglite> node supabase/proposed/account_delete_self_v1.scratch-test.mjs
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
const APPLY_PATH = path.join(__dirname, "20261115200000_account_delete_self_v1.sql");
const ROLLBACK_PATH = path.join(__dirname, "20261115200000_account_delete_self_v1.rollback.sql");
const PREIMAGE_PATH = path.join(__dirname, "20261115200000_account_delete_self_v1.preimage.sql");
const CHANGE_PATH = path.join(__dirname, "20261115190000_account_change_username_v1.sql");
const INDEX_PATH = path.join(root, "supabase/migrations/20260826163000_account_username_signin_index.sql");
const APPLY = fs.readFileSync(APPLY_PATH, "utf8");
const ROLLBACK = fs.readFileSync(ROLLBACK_PATH, "utf8");
const PREIMAGE = fs.readFileSync(PREIMAGE_PATH, "utf8");
const CHANGE = fs.readFileSync(CHANGE_PATH, "utf8");
const INDEX_SQL = fs.readFileSync(INDEX_PATH, "utf8");
const INDEX_OBJECTS = INDEX_SQL.slice(0, INDEX_SQL.indexOf("create table if not exists account_private.username_signin_attempts"));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const STANDINS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema account_private; create schema account_api; create schema storage;
grant usage on schema account_api to service_role;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb,
  updated_at timestamptz
);
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
create table auth.refresh_tokens (
  id bigint generated always as identity primary key,
  token text,
  user_id varchar(255),
  session_id uuid references auth.sessions(id) on delete cascade
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text
);
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
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, owner uuid, name text);
create function account_api.account_resolve_username_signin_v4(text) returns uuid language sql as 'select null::uuid';
revoke all on function account_api.account_resolve_username_signin_v4(text) from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_signin_v4(text) to service_role;
`;

// Fitness (schema fitness): columns used by the delete plus the foreign keys between the tables, with the
// ON DELETE actions from the Fitness migrations (NO ACTION where the migration names none). No foreign
// key to auth.users, as in the master project.
const FITNESS = `
create schema fitness;
create table fitness.profiles (id uuid primary key, user_number int);
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
  workout_plan_template_exercise_id uuid references fitness.workout_plan_template_exercises(id) on delete set null
);
create table fitness.sessions (id uuid primary key, user_id uuid not null, routine_id uuid references fitness.routines(id) on delete cascade);
create table fitness.session_exercises (
  id uuid primary key, user_id uuid not null,
  session_id uuid not null references fitness.sessions(id) on delete cascade,
  exercise_id uuid not null references fitness.exercises(id),
  routine_day_exercise_id uuid references fitness.routine_day_exercises(id) on delete set null
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
create table fitness.discord_verification_tokens (id uuid primary key, user_id uuid not null, discord_user_id text);
create table fitness.discord_member_links (id uuid primary key, fitness_user_id uuid not null, discord_user_id text);
create table fitness.discord_feedback_reports (id uuid primary key, reporter_fitness_user_id uuid, reporter_discord_user_id text, body text);
create table fitness.discord_moderation_cases (id uuid primary key, target_fitness_user_id uuid, target_discord_user_id text, reason text);
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
create schema fawxzzy_analytics;
create table fawxzzy_analytics.events (id bigint generated always as identity primary key, name text, path text);
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
const GLOBAL_EXERCISE = "99999999-0000-4000-8000-000000000099";

let seq = 0;
const uid = (prefix) => {
  seq += 1;
  return `${prefix}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/** A full Fitness + Mazer footprint for one account (sessions, routines, templates, stats, discord rows). */
function footprint(user, tag) {
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
insert into fitness.routine_day_exercises (id, user_id, routine_day_id, exercise_id, workout_plan_template_exercise_id) values ('${rdx}', '${user}', '${day}', '${ex}', '${tex}');
insert into fitness.routine_day_exercises (id, user_id, routine_day_id, exercise_id) values ('${id()}', '${user}', '${day}', '${GLOBAL_EXERCISE}');
insert into fitness.sessions (id, user_id, routine_id) values ('${session}', '${user}', '${routine}');
insert into fitness.session_exercises (id, user_id, session_id, exercise_id, routine_day_exercise_id) values ('${sx}', '${user}', '${session}', '${ex}', '${rdx}');
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
insert into storage.objects (bucket_id, owner, name) values ('public-assets', null, '${tag}.png');
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
${footprint(ALICE, "aaaaaaaa")}
${footprint(BOB, "bbbbbbbb")}
${footprint(CARA, "cccccccc")}
${footprint(NONAME, "eeeeeeee")}
${footprint(PAYER, "ffffffff")}
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
  await db.exec(GUARD);
  await db.exec(INDEX_OBJECTS);
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
  return result.error ? `error:${result.error.code ?? ""}:${result.error.message}` : result.rows[0].r;
};

const TABLES = [
  "auth.users", "auth.sessions", "auth.refresh_tokens", "auth.identities",
  "fitness.profiles", "fitness.exercises", "fitness.routines", "fitness.workout_plan_templates", "fitness.routine_days",
  "fitness.workout_plan_template_exercises", "fitness.routine_day_exercises", "fitness.sessions", "fitness.session_exercises",
  "fitness.sets", "fitness.session_follow_up_jobs", "fitness.exercise_stats", "fitness.progression_events",
  "fitness.discord_verification_tokens", "fitness.discord_member_links", "fitness.discord_feedback_reports",
  "fitness.discord_moderation_cases", "fitness.billing_customers", "fitness.billing_purchases", "fitness.user_entitlements",
  "fitness.discord_spotify_connections", "fitness.auth_handoffs",
  "mazer.mazer_profiles", "mazer.mazer_progression_states", "mazer.mazer_ai_progression_states", "mazer.mazer_cycle_receipts",
  "account_private.username_signin_index", "fawxzzy_analytics.events", "storage.objects",
];

/** Every row of every table, as JSON text, keyed by table. */
async function snapshot(db) {
  const out = {};
  for (const table of TABLES) {
    const rows = (await db.query(`select to_jsonb(t)::text j from ${table} t`)).rows.map((r) => r.j).sort();
    out[table] = rows;
  }
  return out;
}

/** True when a row (as JSON text) mentions the account id or its session anywhere. */
const mentions = (row, key) => row.includes(ACCOUNTS[key]) || row.includes(SESSION[key]);

(async () => {
  console.log(`apply    sha256: ${sha(APPLY_PATH)}`);
  console.log(`rollback sha256: ${sha(ROLLBACK_PATH)}`);
  console.log(`preimage sha256: ${sha(PREIMAGE_PATH)}\n`);

  let db = await fresh();
  let result = await as(db, "postgres", null, PREIMAGE);
  check("preimage: runs read-only on the scratch database", !result.error, result.error?.message);
  const pre = result.rows?.[0] && JSON.parse(Object.values(result.rows[0])[0]);
  check("preimage: no unlisted account columns", pre?.unlisted_account_columns?.length === 0, JSON.stringify(pre?.unlisted_account_columns));
  const missing = pre?.manifest?.filter((m) => !m.table_exists).map((m) => m.item).join(",");
  check("preimage: every required listed table present (only the two optional ones absent)",
    missing === "account_private.account_delete_attempts.user_id,account_private.username_change_attempts.user_id", missing);

  let error = await tryExec(db, APPLY);
  check("apply: runs cleanly on a database shaped like production", error === null, error?.message);

  // Who may call.
  result = await as(db, "anon", null, "select account_api.account_delete_self('x') r");
  check("anon: no access to account_api", result.error?.code === "42501", result.error?.message);
  result = await as(db, "authenticated", null, "select account_api.account_delete_self('x') r");
  check("authenticated without a subject: refused", result.error?.message === "ACCOUNT_DELETE_NOT_SIGNED_IN", result.error?.message);
  result = await as(db, "authenticated", claimsFor("ALICE"), `select account_private.delete_account_v1('${BOB}', '{}'::jsonb, 'bob') r`);
  check("authenticated: inner function (any user id) not callable", result.error?.code === "42501", result.error?.message);
  for (const table of ["account_private.account_delete_attempts", "account_private.account_deletions"]) {
    result = await as(db, "authenticated", claimsFor("ALICE"), `select count(*) from ${table}`);
    check(`authenticated: ${table} not readable`, result.error?.code === "42501", result.error?.message);
  }
  result = await as(db, "authenticated", claimsFor("ALICE"), "select account_api.account_resolve_username_signin_v4('x')");
  check("authenticated: existing service-role-only account_api function still not callable", result.error?.code === "42501", result.error?.message);

  const before = await snapshot(db);

  // Proof of a fresh password sign-in on a live session.
  check("reauth: no amr (token from a refresh-only session)", (await del(db, claimsFor("ALICE", { amrAt: null }), "alice")) === "reauth");
  check("reauth: password sign-in 11 minutes ago", (await del(db, claimsFor("ALICE", { amrAt: now() - 660 }), "alice")) === "reauth");
  check("reauth: amr is not password (magic link / oauth)", (await del(db, claimsFor("ALICE", { method: "otp" }), "alice")) === "reauth");
  check("reauth: session id that no longer exists (signed out)", (await del(db, claimsFor("ALICE", { session: "aaaaaaaa-dead-4000-8000-000000000000" }), "alice")) === "reauth");
  check("reauth: another account's live session", (await del(db, claimsFor("ALICE", { session: SESSION.BOB }), "alice")) === "reauth");
  // Rate limit: five refused attempts in 15 minutes, then even a correct call is refused.
  check("rate: 6th call within 15 minutes is refused before anything else", (await del(db, claimsFor("ALICE"), "Alice")) === "rate");
  check("rate: refused call deleted nothing", (await db.query(`select count(*) c from auth.users where id = '${ALICE}'`)).rows[0].c == 1);
  const ageAttempts = () => db.query("update account_private.account_delete_attempts set attempted_at = now() - interval '16 minutes' where user_id = $1", [ALICE]);
  await ageAttempts();
  check("confirm: typed text is not the username", (await del(db, claimsFor("ALICE"), "alicia")) === "confirm");
  check("confirm: empty text", (await del(db, claimsFor("ALICE"), "  ")) === "confirm");
  const unchangedAfterRefusals = JSON.stringify(await snapshot(db)) === JSON.stringify(before);
  check("refusals changed no account data (only attempt rows)", unchangedAfterRefusals);
  await ageAttempts();

  // Billing blocks.
  check("billing: an account with a purchase is not deleted", (await del(db, claimsFor("PAYER"), "payer")) === "billing");
  check("billing: payer still exists with all rows", (await db.query(`select count(*) c from fitness.sets where user_id = '${PAYER}'`)).rows[0].c == 2);

  // The delete itself.
  const beforeDelete = await snapshot(db);
  const outcome = await del(db, claimsFor("ALICE"), "  ALICE ");
  check("deleted: typed username matches trimmed and in any case", outcome === "deleted", outcome);
  const after = await snapshot(db);
  let leftovers = [];
  let collateral = [];
  for (const table of TABLES) {
    leftovers.push(...after[table].filter((row) => mentions(row, "ALICE")).map((row) => `${table}: ${row}`));
    const othersBefore = beforeDelete[table].filter((row) => !mentions(row, "ALICE"));
    const othersAfter = after[table].filter((row) => !mentions(row, "ALICE"));
    // The two Discord tables keep alice's rows de-linked; compare those separately below.
    if (table === "fitness.discord_feedback_reports" || table === "fitness.discord_moderation_cases") continue;
    if (JSON.stringify(othersBefore) !== JSON.stringify(othersAfter)) collateral.push(table);
  }
  check("deleted: no row anywhere still names alice (id or session)", leftovers.length === 0, leftovers.slice(0, 3).join(" | "));
  check("deleted: every other account's rows are byte-for-byte unchanged", collateral.length === 0, collateral.join(","));
  for (const key of ["BOB", "CARA", "NONAME", "PAYER"]) {
    const rowsBefore = TABLES.reduce((sum, t) => sum + beforeDelete[t].filter((row) => mentions(row, key)).length, 0);
    const rowsAfter = TABLES.reduce((sum, t) => sum + after[t].filter((row) => mentions(row, key)).length, 0);
    check(`deleted: ${key.toLowerCase()} keeps all ${rowsBefore} rows`, rowsBefore === rowsAfter && rowsBefore > 20, `${rowsBefore} -> ${rowsAfter}`);
  }
  check("deleted: the shared catalogue exercise stays", after["fitness.exercises"].some((row) => row.includes(GLOBAL_EXERCISE)));
  const reports = (await db.query("select count(*) filter (where reporter_fitness_user_id is null) unlinked, count(*) total from fitness.discord_feedback_reports")).rows[0];
  check("deleted: alice's Discord report stays but is de-linked", Number(reports.unlinked) === 1 && Number(reports.total) === 5, JSON.stringify(reports));
  const cases = (await db.query("select count(*) filter (where target_fitness_user_id is null) unlinked, count(*) total from fitness.discord_moderation_cases")).rows[0];
  check("deleted: alice's moderation case stays but is de-linked", Number(cases.unlinked) === 1 && Number(cases.total) === 5, JSON.stringify(cases));
  check("deleted: sessions and refresh tokens gone (signed out everywhere)",
    (await db.query(`select (select count(*) from auth.sessions where user_id = '${ALICE}') + (select count(*) from auth.refresh_tokens where user_id = '${ALICE}') c`)).rows[0].c == 0);
  check("deleted: username sign-in index row gone", (await db.query(`select count(*) c from account_private.username_signin_index where user_id = '${ALICE}'`)).rows[0].c == 0);
  check("deleted: attempt rows gone", (await db.query(`select count(*) c from account_private.account_delete_attempts where user_id = '${ALICE}'`)).rows[0].c == 0);
  const audit = (await db.query("select to_jsonb(d)::text j, subject_hash, row_counts from account_private.account_deletions d")).rows;
  const expectedHash = crypto.createHash("sha256").update(`fawxzzy-account-delete-v1:${ALICE}`).digest("hex");
  check("audit: one row with the hashed id", audit.length === 1 && audit[0].subject_hash === expectedHash);
  check("audit: no id, email or username in the row", audit.length === 1 && !/alice|aaaaaaaa/i.test(audit[0].j), audit[0]?.j);
  check("audit: row counts recorded per table", audit[0]?.row_counts?.["fitness.sets"] === 2 && audit[0]?.row_counts?.["mazer.mazer_profiles"] === 1, JSON.stringify(audit[0]?.row_counts));

  // Idempotent.
  check("gone: a second call (retry with the same still-valid token) answers gone", (await del(db, claimsFor("ALICE"), "alice")) === "gone");
  check("gone: nothing more written", (await db.query("select count(*) c from account_private.account_deletions")).rows[0].c == 1);

  // No username: type the email.
  check("confirm: an account without a username must type its email", (await del(db, claimsFor("NONAME"), "noname")) === "confirm");
  check("deleted: ...and the email (any case) works", (await del(db, claimsFor("NONAME"), "noname@example.TEST")) === "deleted");

  // One transaction: a cross-account reference makes the whole call fail and keeps every row.
  const caraEx = (await db.query(`select id from fitness.exercises where user_id = '${CARA}'`)).rows[0].id;
  const bobDay = (await db.query(`select id from fitness.routine_days where user_id = '${BOB}'`)).rows[0].id;
  await db.exec(`insert into fitness.routine_day_exercises (id, user_id, routine_day_id, exercise_id) values ('${uid("bbbbbbbb")}', '${BOB}', '${bobDay}', '${caraEx}')`);
  const beforeCara = await snapshot(db);
  const caraOutcome = await del(db, claimsFor("CARA"), "cara");
  check("transaction: another account using cara's custom exercise makes the call fail", caraOutcome.startsWith("error:23503"), caraOutcome);
  check("transaction: ...and nothing at all was deleted", JSON.stringify(await snapshot(db)) === JSON.stringify(beforeCara));

  // Preflight and rollback.
  error = await tryExec(db, APPLY);
  check("second apply: refused by preflight", /DELETE_ACCOUNT_PREFLIGHT_ALREADY_PRESENT/.test(error?.message ?? ""), error?.message);
  error = await tryExec(db, ROLLBACK);
  check("rollback: runs cleanly", error === null, error?.message);
  check("rollback: audit rows kept", (await db.query("select count(*) c from account_private.account_deletions")).rows[0].c == 2);
  check("rollback: USAGE on account_api taken back (nothing else needs it)",
    (await db.query("select has_schema_privilege('authenticated', 'account_api', 'usage') u")).rows[0].u === false);
  result = await as(db, "authenticated", claimsFor("BOB"), "select account_api.account_delete_self('bob') r");
  check("rollback: API gone for authenticated (portal shows 'unavailable')", result.error?.code === "42501", result.error?.message);
  error = await tryExec(db, APPLY);
  check("re-apply after rollback: runs cleanly (reuses the audit table)", error === null, error?.message);
  check("re-apply: works", (await del(db, claimsFor("BOB"), "bob")) === "deleted");
  await db.close();

  // Interplay with change username v1 (apply that first, as documented).
  db = await fresh();
  error = await tryExec(db, CHANGE);
  check("interplay: change username v1 applies first", error === null, error?.message);
  error = await tryExec(db, APPLY);
  check("interplay: delete applies on top of it", error === null, error?.message);
  result = await as(db, "authenticated", claimsFor("BOB"), "select account_api.account_change_username('bobby') r");
  check("interplay: change username still works", result.rows?.[0]?.r === "changed", result.error?.message);
  check("interplay: delete removes the account's username change attempts", (await del(db, claimsFor("BOB"), "bobby")) === "deleted"
    && (await db.query(`select count(*) c from account_private.username_change_attempts where user_id = '${BOB}'`)).rows[0].c == 0);
  error = await tryExec(db, ROLLBACK);
  check("interplay: delete rollback keeps USAGE while change username needs it", error === null
    && (await db.query("select has_schema_privilege('authenticated', 'account_api', 'usage') u")).rows[0].u === true, error?.message);
  result = await as(db, "authenticated", claimsFor("CARA"), "select account_api.account_change_username('cara2') r");
  check("interplay: change username works after the delete rollback", result.rows?.[0]?.r === "changed", result.error?.message);
  await db.close();

  db = await fresh();
  await db.exec(APPLY);
  error = await tryExec(db, CHANGE);
  check("interplay (wrong order): change username v1 refuses after delete, nothing half-applied",
    /AUTHENTICATED_ALREADY_HAS_ACCOUNT_API_USAGE/.test(error?.message ?? "")
    && (await db.query("select to_regclass('account_private.username_change_attempts') r")).rows[0].r === null, error?.message);
  await db.close();

  // Owned by a role that is NOT a superuser, with exactly the production grants (prod `postgres` is not a
  // superuser but has BYPASSRLS), so the delete path needs nothing beyond what the preflight checks.
  db = await fresh();
  await db.exec(APPLY);
  await db.exec(`
create role sim_owner nologin noinherit bypassrls;
grant usage on schema auth, fitness, mazer, account_private to sim_owner;
grant select, update, delete on auth.users to sim_owner;
grant select on auth.sessions to sim_owner;
grant select, delete on all tables in schema fitness to sim_owner;
grant update on fitness.discord_feedback_reports, fitness.discord_moderation_cases to sim_owner;
grant select, delete on all tables in schema mazer to sim_owner;
grant select, insert, delete on account_private.account_delete_attempts, account_private.username_signin_index to sim_owner;
grant select, insert on account_private.account_deletions to sim_owner;
grant execute on function auth.uid(), auth.jwt() to sim_owner;
alter function account_private.delete_account_v1(uuid, jsonb, text) owner to sim_owner;
alter function account_api.account_delete_self(text) owner to sim_owner;
`);
  // RLS on, no policies, as on the production app tables: the owner sees rows only through BYPASSRLS.
  for (const table of TABLES.filter((t) => /^(fitness|mazer)./.test(t))) await db.exec(`alter table ${table} enable row level security`);
  check("non-superuser owner: is not a superuser", (await db.query("select rolsuper s from pg_roles where rolname = 'sim_owner'")).rows[0].s === false);
  let simOutcome = await del(db, claimsFor("CARA"), "nope");
  check("non-superuser owner: refusal path works", simOutcome === "confirm", simOutcome);
  simOutcome = await del(db, claimsFor("CARA"), "cara");
  check("non-superuser owner: delete works (GoTrue cascades run as the table owners)", simOutcome === "deleted", simOutcome);
  check("non-superuser owner: cara fully gone", (await db.query(`select count(*) c from fitness.sets where user_id = '${CARA}'`)).rows[0].c == 0
    && (await db.query(`select count(*) c from auth.sessions where user_id = '${CARA}'`)).rows[0].c == 0);
  await db.close();

  // Preflight refusals: a database that differs from the repo's picture fails the apply.
  const refusals = [
    ["an unlisted table with a user_id column", "create table public.notes (id uuid primary key, user_id uuid, body text);", /UNLISTED_ACCOUNT_COLUMNS: public\.notes\.user_id/],
    ["an unlisted foreign key to auth.users", "create table public.things (id uuid primary key, who uuid references auth.users(id));", /UNLISTED_ACCOUNT_COLUMNS: public\.things\.who/],
    ["a listed table that is missing", "drop table fitness.session_follow_up_jobs;", /LISTED_TABLE_MISSING: fitness\.session_follow_up_jobs/],
    ["a listed column that is not a uuid", "alter table fitness.sets alter column user_id type text;", /LISTED_COLUMN_MISSING_OR_NOT_UUID: fitness\.sets\.user_id/],
    ["Storage files owned by an account", `insert into storage.objects (bucket_id, owner, name) values ('avatars', '${BOB}', 'me.png');`, /STORAGE_HAS_ACCOUNT_OWNED_FILES: avatars/],
    ["an account_api function executable by authenticated", "create function account_api.leaky() returns int language sql as 'select 1';", /EXECUTABLE_BY_AUTHENTICATED: account_api\.leaky\(\)/],
    ["anon with USAGE on account_api", "grant usage on schema account_api to anon;", /ANON_HAS_ACCOUNT_API_USAGE/],
    ["an audit table of another shape", "create table account_private.account_deletions (id bigint, email text);", /AUDIT_TABLE_SHAPE_DIFFERS/],
  ];
  for (const [name, extra, pattern] of refusals) {
    db = await fresh({ extra });
    error = await tryExec(db, APPLY);
    check(`preflight: refuses ${name}`, pattern.test(error?.message ?? ""), error?.message);
    check(`preflight (${name}): nothing left behind`,
      (await db.query("select to_regprocedure('account_api.account_delete_self(text)') f, to_regclass('account_private.account_delete_attempts') t")).rows
        .every((r) => r.f === null && r.t === null));
    await db.close();
  }

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
