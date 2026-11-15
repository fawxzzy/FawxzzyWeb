// Scratch test for the PROPOSED change-username v1 SQL (in-memory Postgres 17 via pglite; never touches
// Supabase). Owner-run before approving the SQL; not part of CI (CI checks the file shape only, in
// tests/account-change.test.mjs).
//
// Layers, in order:
//   1. stand-ins for Supabase: roles anon/authenticated/service_role, auth.users (only the columns used),
//      auth.uid() (same claim lookup as Supabase's), one existing service-role-only account_api function;
//   2. the live username guard (account_private.username_claim_normalize + guard_username_claim + trigger
//      account_guard_username_claim), copied from the applied FIXED4 guard;
//   3. the REAL sign-in index objects from supabase/migrations/20260826163000_account_username_signin_index.sql
//      (everything up to the attempts table), so the rename is shown to move username sign-in;
//   4. the file under test, run verbatim, then its rollback, then a re-apply.
//
// Usage (pglite pinned at 0.5.13, installed with `npm ci --ignore-scripts` in its own folder):
//   PGLITE_SANDBOX=<folder with node_modules/@electric-sql/pglite> node supabase/proposed/account_change_username_v1.scratch-test.mjs
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
const APPLY_PATH = path.join(__dirname, "20261115190000_account_change_username_v1.sql");
const ROLLBACK_PATH = path.join(__dirname, "20261115190000_account_change_username_v1.rollback.sql");
const INDEX_PATH = path.join(root, "supabase/migrations/20260826163000_account_username_signin_index.sql");
const APPLY = fs.readFileSync(APPLY_PATH, "utf8");
const ROLLBACK = fs.readFileSync(ROLLBACK_PATH, "utf8");
const INDEX_SQL = fs.readFileSync(INDEX_PATH, "utf8");
const INDEX_OBJECTS = INDEX_SQL.slice(0, INDEX_SQL.indexOf("create table if not exists account_private.username_signin_attempts"));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const STANDINS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema account_private; create schema account_api;
grant usage on schema account_api to service_role;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb,
  updated_at timestamptz
);
grant select, update on auth.users to postgres;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function account_api.account_resolve_username_signin_v4(text) returns uuid language sql as 'select null::uuid';
revoke all on function account_api.account_resolve_username_signin_v4(text) from public, anon, authenticated;
grant execute on function account_api.account_resolve_username_signin_v4(text) to service_role;
`;

// Live guard, as applied (FIXED4): normalizer, guard function, BEFORE trigger.
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

// Simulates a racing claim the pre-check cannot see: renaming to "guardonly" fails in a trigger with the
// guard's exact error, so the function's unique_violation path is exercised.
const RACE = `
create function account_private.test_race_claim() returns trigger language plpgsql as $$
begin
  if lower(new.raw_user_meta_data ->> 'username') = 'guardonly' then
    raise exception using errcode = '23505', message = 'ACCOUNT_USERNAME_TAKEN';
  end if;
  return new;
end;
$$;
create trigger zz_test_race_claim before update on auth.users
for each row execute function account_private.test_race_claim();
`;

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";
const CARA = "cccccccc-0000-4000-8000-000000000003";
const DEV = "dddddddd-0000-4000-8000-000000000004";
const NONAME = "eeeeeeee-0000-4000-8000-000000000005";
const USERS = `
insert into auth.users (id, email, raw_user_meta_data) values
  ('${ALICE}', 'alice@example.test', '{"username":"Alice","display_name":"Alice","app_namespace":"mazer"}'),
  ('${BOB}', 'bob@example.test', '{"username":"bob","display_name":"Bobby B"}'),
  ('${CARA}', 'cara@example.test', '{"username":"cara"}'),
  ('${DEV}', 'dev@example.test', '{"username":"dev"}'),
  ('${NONAME}', 'noname@example.test', '{}');
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

async function fresh({ guard = true, extra = "" } = {}) {
  const db = new PGlite();
  await db.exec(STANDINS);
  if (guard) await db.exec(GUARD);
  await db.exec(INDEX_OBJECTS);
  await db.exec(RACE);
  await db.exec(USERS);
  if (extra) await db.exec(extra);
  return db;
}

/** Calls the API as the given role with the given JWT subject (null = signed out). */
async function as(db, role, sub, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      if (sub) await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role })]);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (error) {
    return { error };
  }
}

const rename = async (db, user, name) => {
  const result = await as(db, "authenticated", user, "select account_api.account_change_username($1) as r", [name]);
  return result.error ? `error:${result.error.code ?? ""}:${result.error.message}` : result.rows[0].r;
};
const meta = async (db, user) => (await db.query("select raw_user_meta_data m from auth.users where id = $1", [user])).rows[0].m;
const indexOf = async (db, user) =>
  (await db.query("select normalized_username n from account_private.username_signin_index where user_id = $1", [user])).rows[0]?.n ?? null;

(async () => {
  console.log(`apply    sha256: ${sha(APPLY_PATH)}`);
  console.log(`rollback sha256: ${sha(ROLLBACK_PATH)}\n`);

  let db = await fresh();
  let error = await tryExec(db, APPLY);
  check("apply: runs cleanly on a database shaped like production", error === null, error?.message);

  check("invalid: 1 character", (await rename(db, ALICE, "a")) === "invalid");
  check("invalid: 16 characters", (await rename(db, ALICE, "a".repeat(16))) === "invalid");
  check("invalid: space and symbols", (await rename(db, ALICE, "bad name!")) === "invalid");
  check("same: identical name (trimmed)", (await rename(db, ALICE, " Alice ")) === "same");
  check("taken: another account's name, different case", (await rename(db, ALICE, "BOB")) === "taken");
  check("taken: another account's name, padded", (await rename(db, ALICE, " cara ")) === "taken");
  check("taken via the guard race path (unique_violation mapped)", (await rename(db, ALICE, "guardonly")) === "taken");

  check("changed: free name", (await rename(db, ALICE, "Alicia")) === "changed");
  let m = await meta(db, ALICE);
  check("changed: username saved", m.username === "Alicia", JSON.stringify(m));
  check("changed: mirrored display name follows", m.display_name === "Alicia");
  check("changed: other metadata kept (app_namespace)", m.app_namespace === "mazer");
  check("changed: username sign-in index moved in the same transaction", (await indexOf(db, ALICE)) === "alicia");
  check("changed: old name is free again", (await rename(db, DEV, "alice")) === "changed");

  check("case-only change is allowed", (await rename(db, BOB, "Bob")) === "changed");
  m = await meta(db, BOB);
  check("custom display name is kept", m.display_name === "Bobby B", JSON.stringify(m));
  check("case-only change keeps the sign-in index", (await indexOf(db, BOB)) === "bob");

  check("account with no username can pick one", (await rename(db, NONAME, "fresh.name")) === "changed");
  check("...and its sign-in index row appears", (await indexOf(db, NONAME)) === "fresh.name");

  // 3 successful changes per 24 hours.
  check("rate: change 2 of 3", (await rename(db, ALICE, "Alicia2")) === "changed");
  check("rate: change 3 of 3", (await rename(db, ALICE, "Alicia3")) === "changed");
  check("rate: change 4 within 24 h is refused", (await rename(db, ALICE, "Alicia4")) === "rate");
  check("rate: refused change did not apply", (await meta(db, ALICE)).username === "Alicia3");
  await db.query("update account_private.username_change_attempts set attempted_at = now() - interval '25 hours' where user_id = $1", [ALICE]);
  check("rate: after 24 h a change works again", (await rename(db, ALICE, "Alicia4")) === "changed");
  const aliceRows = Number((await db.query("select count(*) c from account_private.username_change_attempts where user_id = $1", [ALICE])).rows[0].c);
  check("rate: rows older than 24 h were pruned", aliceRows === 1, `rows=${aliceRows}`);

  // 10 attempts per 15 minutes (same/taken count too).
  for (let i = 0; i < 9; i += 1) await rename(db, CARA, "cara");
  check("rate: attempt 10 still answers", (await rename(db, CARA, "bob")) === "taken");
  check("rate: attempt 11 within 15 min is refused", (await rename(db, CARA, "caraway")) === "rate");
  await db.query("update account_private.username_change_attempts set attempted_at = now() - interval '16 minutes' where user_id = $1", [CARA]);
  check("rate: after 15 min attempts work again", (await rename(db, CARA, "caraway")) === "changed");

  // Who may call what.
  let result = await as(db, "authenticated", null, "select account_api.account_change_username('signedout') r");
  check("not signed in (no subject): refused", result.error?.message === "ACCOUNT_CHANGE_NOT_SIGNED_IN", result.error?.message);
  result = await as(db, "anon", null, "select account_api.account_change_username('anonname') r");
  check("anon: no access to account_api", result.error?.code === "42501", result.error?.message);
  result = await as(db, "authenticated", ALICE, `select account_private.change_username_v1('${BOB}', 'hijack') r`);
  check("authenticated: inner function (any user id) not callable", result.error?.code === "42501", result.error?.message);
  result = await as(db, "authenticated", ALICE, "select count(*) from account_private.username_change_attempts");
  check("authenticated: attempts table not readable", result.error?.code === "42501", result.error?.message);
  result = await as(db, "authenticated", ALICE, "select account_api.account_resolve_username_signin_v4('x')");
  check("authenticated: existing service-role-only account_api function still not callable", result.error?.code === "42501", result.error?.message);
  result = await as(db, "service_role", null, "select account_api.account_resolve_username_signin_v4('x') r");
  check("service_role: existing account_api function still callable", !result.error, result.error?.message);
  check("a caller only ever renames itself (bob untouched)", (await meta(db, BOB)).username === "Bob");

  // Preflight and rollback.
  error = await tryExec(db, APPLY);
  check("second apply: refused by preflight", /CHANGE_USERNAME_PREFLIGHT_ALREADY_PRESENT/.test(error?.message ?? ""), error?.message);
  error = await tryExec(db, ROLLBACK);
  check("rollback: runs cleanly", error === null, error?.message);
  check("rollback: renamed accounts keep their names", (await meta(db, ALICE)).username === "Alicia4");
  result = await as(db, "authenticated", ALICE, "select account_api.account_change_username('afterrollback') r");
  check("rollback: API gone for authenticated (portal shows 'unavailable')", result.error?.code === "42501", result.error?.message);
  error = await tryExec(db, APPLY);
  check("re-apply after rollback: runs cleanly", error === null, error?.message);
  check("re-apply: works", (await rename(db, BOB, "robert")) === "changed");
  await db.close();

  db = await fresh({ guard: false });
  error = await tryExec(db, APPLY);
  check("preflight: refuses without the live username guard", /USERNAME_GUARD_TRIGGER_MISSING/.test(error?.message ?? ""), error?.message);
  await db.close();

  db = await fresh({ extra: "create function account_api.leaky() returns int language sql as 'select 1';" });
  error = await tryExec(db, APPLY);
  check("preflight: refuses when an account_api function is executable by authenticated", /EXECUTABLE_BY_AUTHENTICATED: account_api\.leaky\(\)/.test(error?.message ?? ""), error?.message);
  check("preflight failure left nothing behind", (await db.query("select to_regclass('account_private.username_change_attempts') r")).rows[0].r === null);
  await db.close();

  db = await fresh({ extra: "grant usage on schema account_api to authenticated;" });
  error = await tryExec(db, APPLY);
  check("preflight: refuses when authenticated already has USAGE (rollback must be exact)", /AUTHENTICATED_ALREADY_HAS_ACCOUNT_API_USAGE/.test(error?.message ?? ""), error?.message);
  await db.close();

  db = await fresh();
  await db.exec(APPLY);
  // A later account_api function is reachable unless its migration revokes PUBLIC (repo test enforces it).
  await db.exec("create function account_api.later_function() returns int language sql as 'select 1';");
  result = await as(db, "authenticated", ALICE, "select account_api.later_function()");
  check("known limit: a later account_api function WITHOUT a revoke is callable (why the repo test exists)", !result.error, result.error?.message);
  await db.exec("revoke execute on function account_api.later_function() from public;");
  result = await as(db, "authenticated", ALICE, "select account_api.later_function()");
  check("a later account_api function WITH the usual revoke is not callable by authenticated", result.error?.code === "42501", result.error?.message);
  await db.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
