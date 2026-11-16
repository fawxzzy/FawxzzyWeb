// Scratch test for the PROPOSED username reset v1 SQL (in-memory Postgres 17 via pglite; never touches
// Supabase). Owner-run before approving the SQL; not part of CI (CI runs the Edge Function handler and the
// file shape in tests/username-password-reset.test.mjs and tests/account-change.test.mjs).
//
// Layers, in order:
//   1. stand-ins for Supabase: roles anon/authenticated/service_role, auth.users (only the columns used);
//   2. the REAL sign-in index objects and attempts table from
//      supabase/migrations/20260826163000_account_username_signin_index.sql (everything before the v1
//      sign-in resolver), so usernames resolve exactly as production's index does;
//   3. the file under test, run verbatim; its rollback; a re-apply;
//   4. the Edge Function's real handler (supabase/functions/username-password-reset/handler.mjs) wired to
//      this database, to show one answer and one timing for known, unknown, banned and unconfirmed names.
//
// Usage (pglite pinned at 0.5.13, installed with `npm ci --ignore-scripts` in its own folder):
//   PGLITE_SANDBOX=<folder with node_modules/@electric-sql/pglite> node supabase/proposed/account_username_reset_v1.scratch-test.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECOY_RECIPIENT,
  createUsernameResetHandler,
  recipientFrom,
} from "../functions/username-password-reset/handler.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sandbox = process.env.PGLITE_SANDBOX;
if (!sandbox) {
  console.error("Set PGLITE_SANDBOX to a folder with node_modules/@electric-sql/pglite.");
  process.exit(2);
}
const { PGlite } = createRequire(path.join(sandbox, "package.json"))("@electric-sql/pglite");

const root = path.resolve(__dirname, "../..");
const APPLY_PATH = path.join(__dirname, "20261115210000_account_username_reset_v1.sql");
const ROLLBACK_PATH = path.join(__dirname, "20261115210000_account_username_reset_v1.rollback.sql");
const INDEX_PATH = path.join(root, "supabase/migrations/20260826163000_account_username_signin_index.sql");
const APPLY = fs.readFileSync(APPLY_PATH, "utf8");
const ROLLBACK = fs.readFileSync(ROLLBACK_PATH, "utf8");
const INDEX_SQL = fs.readFileSync(INDEX_PATH, "utf8");
const INDEX_AND_ATTEMPTS = INDEX_SQL.slice(0, INDEX_SQL.indexOf("create or replace function public.account_resolve_username_signin("));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hex = (text) => crypto.createHash("sha256").update(text).digest("hex");

const STANDINS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema account_private; create schema account_api;
grant usage on schema account_api to service_role;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz
);
`;

const KNOWN = "11111111-1111-4111-8111-111111111111";
const UNCONFIRMED = "22222222-2222-4222-8222-222222222222";
const BANNED = "33333333-3333-4333-8333-333333333333";
const USERS = `
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, banned_until) values
  ('${KNOWN}', 'known@example.test', '{"username":"Known"}', now(), null),
  ('${UNCONFIRMED}', 'unconfirmed@example.test', '{"username":"unconfirmed"}', null, null),
  ('${BANNED}', 'banned@example.test', '{"username":"banned"}', now(), now() + interval '10 years');
`;
const GLOBAL_RESET_ROW = hex("username-reset-global-v1");
const SIGNIN_GLOBAL_ROW = "0".repeat(64);

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

async function fresh({ apply = true, extra = "" } = {}) {
  const db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(INDEX_AND_ATTEMPTS);
  await db.exec(USERS);
  if (extra) await db.exec(extra);
  if (apply) await db.exec(APPLY);
  return db;
}

async function as(db, role, sql, params = []) {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      return { rows: (await tx.query(sql, params)).rows };
    });
  } catch (error) {
    return { error };
  }
}

const keysFor = (username, client) => ({
  client: hex(`username-reset-client-v1:${client}`),
  pair: hex(`username-reset-pair-v1:${username}:${client}`),
});
/** One resolver call as the Edge Function makes it (service role). */
async function resolveAs(db, username, client, role = "service_role") {
  const keys = keysFor(username, client);
  const result = await as(
    db,
    role,
    "select resolved_user_id, throttled from account_api.account_resolve_username_reset_v1($1, $2, $3)",
    [username, keys.client, keys.pair],
  );
  if (result.error) return { error: result.error };
  return { throttled: result.rows[0].throttled, userId: result.rows[0].resolved_user_id };
}
const rowCount = async (db, key) =>
  (await db.query("select attempt_count from account_private.username_signin_attempts where attempt_key = $1", [key])).rows[0]?.attempt_count ?? 0;

(async () => {
  console.log(`apply    sha256: ${sha(APPLY_PATH)}`);
  console.log(`rollback sha256: ${sha(ROLLBACK_PATH)}\n`);

  // Apply.
  let db = await fresh({ apply: false });
  let error = await tryExec(db, APPLY);
  check("apply: runs cleanly on a database shaped like production", error === null, error?.message);

  // Same result shape for known and unknown; the existence answer only reaches the service role.
  const known = await resolveAs(db, "known", "198.51.100.1");
  const unknown = await resolveAs(db, "nobody", "198.51.100.1");
  check("known username resolves to its account", known.userId === KNOWN && known.throttled === false, JSON.stringify(known));
  check("unknown username: same shape, null account", unknown.userId === null && unknown.throttled === false, JSON.stringify(unknown));
  check("both rows have the same columns", JSON.stringify(Object.keys(known)) === JSON.stringify(Object.keys(unknown)));

  // Privileges: never anon or authenticated; the service role only through account_api.
  for (const role of ["anon", "authenticated"]) {
    const denied = await resolveAs(db, "known", "198.51.100.2", role);
    check(`${role} cannot call the API function`, denied.error?.code === "42501", denied.error?.message ?? "no error");
    const inner = await as(db, role, "select * from account_private.resolve_username_reset_v1('known', $1, $2)", [
      "a".repeat(64), "b".repeat(64),
    ]);
    check(`${role} cannot call the inner function`, Boolean(inner.error), inner.error?.message ?? "no error");
    const table = await as(db, role, "select count(*) from account_private.username_signin_attempts");
    check(`${role} cannot read the counters`, Boolean(table.error));
  }
  const acl = (await db.query(`
    select p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('account_resolve_username_reset_v1', 'resolve_username_reset_v1')
    order by p.proname`)).rows;
  check("both functions are security definer with an empty search_path",
    acl.length === 2 && acl.every((row) => row.prosecdef && JSON.stringify(row.proconfig) === JSON.stringify(["search_path=\"\""])),
    JSON.stringify(acl));

  // Invalid input answers (null, false) and writes nothing.
  db = await fresh();
  const before = (await db.query("select count(*)::int n from account_private.username_signin_attempts")).rows[0].n;
  const invalidCalls = [
    ["bad username", ["a b", "a".repeat(64), "b".repeat(64)]],
    ["uppercase username (must arrive normalized)", ["Known", "a".repeat(64), "b".repeat(64)]],
    ["null username", [null, "a".repeat(64), "b".repeat(64)]],
    ["client key not sha256 hex", ["known", "x".repeat(64), "b".repeat(64)]],
    ["client key is the reset shared row", ["known", GLOBAL_RESET_ROW, "b".repeat(64)]],
    ["pair key is the sign-in shared row", ["known", "a".repeat(64), SIGNIN_GLOBAL_ROW]],
    ["client key equals pair key", ["known", "a".repeat(64), "a".repeat(64)]],
  ];
  for (const [label, args] of invalidCalls) {
    const result = await as(db, "service_role",
      "select resolved_user_id, throttled from account_api.account_resolve_username_reset_v1($1, $2, $3)", args);
    check(`invalid input (${label}) answers null/false`,
      !result.error && result.rows[0].resolved_user_id === null && result.rows[0].throttled === false,
      result.error?.message ?? JSON.stringify(result.rows?.[0]));
  }
  const after = (await db.query("select count(*)::int n from account_private.username_signin_attempts")).rows[0].n;
  check("invalid input writes no counter", before === after, `${before} -> ${after}`);

  // Per-(username, client): 5 per window, then throttled; identical for a known and an unknown name.
  db = await fresh();
  const knownSeq = [];
  const unknownSeq = [];
  const knownIds = [];
  for (let i = 0; i < 7; i += 1) {
    const knownRow = await resolveAs(db, "known", "203.0.113.1");
    knownSeq.push(knownRow.throttled);
    knownIds.push(knownRow.userId === KNOWN ? "account" : knownRow.userId === null ? "none" : "other");
    unknownSeq.push((await resolveAs(db, "nobody", "203.0.113.2")).throttled);
  }
  check("send cap: only requests 1-2 from one client return the account; 3-5 answer not-throttled with no account",
    JSON.stringify(knownIds) === JSON.stringify(["account", "account", "none", "none", "none", "none", "none"])
      && knownSeq.slice(2, 5).every((value) => value === false), JSON.stringify(knownIds));
  check("pair limit: requests 1-5 pass, the 6th is throttled", JSON.stringify(knownSeq) === JSON.stringify([false, false, false, false, false, true, true]), JSON.stringify(knownSeq));
  check("pair limit: an unknown name throttles at exactly the same request", JSON.stringify(knownSeq) === JSON.stringify(unknownSeq), JSON.stringify(unknownSeq));
  const throttledKnown = await resolveAs(db, "known", "203.0.113.1");
  check("a throttled answer carries no account", throttledKnown.userId === null && throttledKnown.throttled === true);
  const otherClient = await resolveAs(db, "known", "203.0.113.3");
  check("no per-username lock: the owner on another network still gets through", otherClient.userId === KNOWN && !otherClient.throttled);

  // Per-client: 20 per window across names, then throttled; known and unknown names count alike.
  db = await fresh();
  const clientSeq = [];
  for (let i = 0; i < 22; i += 1) {
    const name = i % 2 === 0 ? `ghost${i}` : (i === 21 ? "known" : `user${i}`);
    clientSeq.push((await resolveAs(db, name, "203.0.113.50")).throttled);
  }
  check("client limit: requests 1-20 pass, the 21st is throttled", clientSeq.slice(0, 20).every((v) => !v) && clientSeq[20] && clientSeq[21], JSON.stringify(clientSeq));
  const knownOverClient = await resolveAs(db, "known", "203.0.113.50");
  check("client limit applies to a known name too, with no account in the answer", knownOverClient.throttled && knownOverClient.userId === null);

  // Reset-only shared row: 100 per window, then throttled; never touches the sign-in shared row.
  db = await fresh();
  await db.query("insert into account_private.username_signin_attempts values ($1, now(), 7)", [SIGNIN_GLOBAL_ROW]);
  const globalSeq = [];
  for (let i = 0; i < 102; i += 1) globalSeq.push((await resolveAs(db, i === 101 ? "known" : `name${i}`, `192.0.2.${i}`)).throttled);
  check("shared limit: requests 1-100 pass, the 101st is throttled", globalSeq.slice(0, 100).every((v) => !v) && globalSeq[100] && globalSeq[101], `first throttled at ${globalSeq.indexOf(true) + 1}`);
  check("shared reset row counts every request that passed the client and pair limits", (await rowCount(db, GLOBAL_RESET_ROW)) === 102, String(await rowCount(db, GLOBAL_RESET_ROW)));
  check("the sign-in shared row is untouched", (await rowCount(db, SIGNIN_GLOBAL_ROW)) === 7);

  // Window: rows older than 15 minutes are dropped, so the caller gets through again.
  db = await fresh();
  for (let i = 0; i < 6; i += 1) await resolveAs(db, "known", "203.0.113.9");
  check("window: throttled inside 15 minutes", (await resolveAs(db, "known", "203.0.113.9")).throttled === true);
  await db.query("update account_private.username_signin_attempts set window_started_at = now() - interval '16 minutes'");
  const reopened = await resolveAs(db, "known", "203.0.113.9");
  check("window: a new window opens after 15 minutes", reopened.throttled === false && reopened.userId === KNOWN);
  const pairKey = keysFor("known", "203.0.113.9").pair;
  check("window: the counter restarted at 1", (await rowCount(db, pairKey)) === 1);

  // Timing at the SQL layer: known and unknown names do the same work (same counters, one index probe).
  db = await fresh();
  const sqlTimes = { known: [], unknown: [] };
  for (let i = 0; i < 60; i += 1) {
    for (const [kind, name] of [["known", "known"], ["unknown", `nobody${i}`]]) {
      const started = performance.now();
      await resolveAs(db, name, `198.18.${kind === "known" ? 1 : 2}.${i}`);
      sqlTimes[kind].push(performance.now() - started);
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const sqlKnown = median(sqlTimes.known);
  const sqlUnknown = median(sqlTimes.unknown);
  check("SQL timing: known and unknown medians within 2 ms", Math.abs(sqlKnown - sqlUnknown) < 2,
    `known ${sqlKnown.toFixed(2)} ms, unknown ${sqlUnknown.toFixed(2)} ms`);

  // End to end: the real Edge Function handler on this database.
  db = await fresh();
  const sent = [];
  const tokens = [];
  const scheduled = [];
  const floor = 300;
  const handle = createUsernameResetHandler({
    admitKey: async () => true,
    background: (task) => scheduled.push(task),
    async findRecipient(userId) {
      const user = (await db.query("select email, to_json(banned_until) #>> '{}' banned_until, to_json(deleted_at) #>> '{}' deleted_at from auth.users where id = $1", [userId])).rows[0];
      await new Promise((done) => setTimeout(done, 150)); // a slow admin API call, existing accounts only
      return recipientFrom(user ?? null, Date.now());
    },
    minimumResponseMs: floor,
    async resolve({ clientKey, normalized, pairKey }) {
      const result = await as(db, "service_role",
        "select resolved_user_id, throttled from account_api.account_resolve_username_reset_v1($1, $2, $3)",
        [normalized, clientKey, pairKey]);
      if (result.error) return null;
      return { throttled: result.rows[0].throttled, userId: result.rows[0].resolved_user_id };
    },
    async sendRecovery(input) {
      sent.push(input.email);
      tokens.push(input.captchaToken);
      return 200;
    },
    sha256: async (text) => hex(text),
  });
  const request = (identifier, ip) => new Request("https://project.example.test/functions/v1/username-password-reset", {
    body: JSON.stringify({
      code_challenge: "A".repeat(43),
      captchaToken: "turnstile-token-fixture",
      code_challenge_method: "s256",
      identifier,
      redirect_to: "https://account.fawxzzy.com/reset-password?recovery=1",
    }),
    headers: { apikey: "sb_publishable_fixture", "cf-connecting-ip": ip, "content-type": "application/json", origin: "https://account.fawxzzy.com" },
    method: "POST",
  });
  const kinds = { known: "known", unknown: "nobody", banned: "banned", unconfirmed: "unconfirmed" };
  const answers = {};
  const times = {};
  for (let round = 0; round < 3; round += 1) {
    for (const [kind, name] of Object.entries(kinds)) {
      const started = performance.now();
      const response = await handle(request(name, `100.64.${round}.${kind.length}`));
      const body = await response.text();
      (times[kind] ??= []).push(performance.now() - started);
      answers[kind] = `${response.status} ${body} ${[...response.headers.entries()].sort().join("|")}`;
    }
  }
  check("handler: known, unknown, banned and unconfirmed get the identical answer",
    new Set(Object.values(answers)).size === 1, answers.known.slice(0, 40));
  const handlerMedians = Object.fromEntries(Object.entries(times).map(([kind, values]) => [kind, median(values)]));
  const spread = Math.max(...Object.values(handlerMedians)) - Math.min(...Object.values(handlerMedians));
  check(`handler: every kind answers at the ${floor} ms floor, spread under 40 ms`,
    Object.values(handlerMedians).every((value) => value >= floor - 2) && spread < 40,
    Object.entries(handlerMedians).map(([kind, value]) => `${kind} ${value.toFixed(0)}`).join(", "));
  await Promise.all(scheduled);
  check("handler: one provider call per request (12), each carrying the captcha token",
    sent.length === 12 && tokens.every((token) => token === "turnstile-token-fixture"), `${sent.length} calls`);
  check("handler: mail only for the known and unconfirmed accounts; unknown and banned go to the decoy",
    JSON.stringify([...new Set(sent)].sort()) === JSON.stringify([DECOY_RECIPIENT, "known@example.test", "unconfirmed@example.test"].sort())
      && sent.filter((email) => email === DECOY_RECIPIENT).length === 6, JSON.stringify(sent));
  // Send cap end to end: the 3rd request for one username from one client goes to the decoy.
  sent.length = 0;
  for (let i = 0; i < 3; i += 1) await handle(request("known", "100.64.7.7"));
  await Promise.all(scheduled);
  check("handler: the 3rd request for one username from one client goes to the decoy, same answer",
    JSON.stringify(sent) === JSON.stringify(["known@example.test", "known@example.test", DECOY_RECIPIENT]), JSON.stringify(sent));
  for (let i = 0; i < 5; i += 1) await handle(request("nobody", "100.64.9.9"));
  const sixthUnknown = await handle(request("nobody", "100.64.9.9"));
  for (let i = 0; i < 5; i += 1) await handle(request("known", "100.64.9.8"));
  const sixthKnown = await handle(request("known", "100.64.9.8"));
  check("handler: the 6th request from one client is 429 for known and unknown alike",
    sixthUnknown.status === 429 && sixthKnown.status === 429 && (await sixthUnknown.text()) === (await sixthKnown.text()));

  // Preflight refuses a second apply; rollback removes everything; re-apply works.
  db = await fresh();
  error = await tryExec(db, APPLY);
  check("preflight: a second apply is refused", /USERNAME_RESET_PREFLIGHT_ALREADY_PRESENT/.test(error?.message ?? ""), error?.message);
  error = await tryExec(db, ROLLBACK);
  check("rollback: runs cleanly", error === null, error?.message);
  const residue = (await db.query(`select count(*)::int n from pg_proc where proname in ('account_resolve_username_reset_v1', 'resolve_username_reset_v1')`)).rows[0].n;
  check("rollback: both functions are gone", residue === 0);
  const afterRollback = await resolveAs(db, "known", "198.51.100.77");
  check("rollback: the API answers 'function does not exist' (the Edge Function maps it to 503)", afterRollback.error?.code === "42883", afterRollback.error?.message);
  error = await tryExec(db, ROLLBACK);
  check("rollback: running it twice is harmless", error === null, error?.message);
  error = await tryExec(db, APPLY);
  check("re-apply after rollback works", error === null, error?.message);
  check("re-apply: resolver works again", (await resolveAs(db, "known", "198.51.100.78")).userId === KNOWN);

  // Preflights on a database missing what the function needs.
  db = await fresh({ apply: false, extra: "drop table account_private.username_signin_attempts;" });
  error = await tryExec(db, APPLY);
  check("preflight: refuses without the attempts table", /USERNAME_RESET_PREFLIGHT_ATTEMPTS_TABLE_MISSING/.test(error?.message ?? ""), error?.message);
  db = await fresh({ apply: false, extra: "revoke usage on schema account_api from service_role;" });
  error = await tryExec(db, APPLY);
  check("preflight: refuses when service_role cannot use account_api", /USERNAME_RESET_PREFLIGHT_SERVICE_ROLE_HAS_NO_ACCOUNT_API_USAGE/.test(error?.message ?? ""), error?.message);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
