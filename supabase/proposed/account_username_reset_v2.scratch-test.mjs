// Scratch test for the PROPOSED username reset v2 SQL (in-memory Postgres 17 via pglite; never touches
// Supabase). Owner-run before approving the SQL; not part of CI (CI runs the Edge Function handler and the
// file shape in tests/username-password-reset.test.mjs).
//
// Layers, in order:
//   1. stand-ins for Supabase: roles anon/authenticated/service_role, auth.users (only the columns used);
//   2. the REAL sign-in index objects and attempts table from
//      supabase/migrations/20260826163000_account_username_signin_index.sql (everything before the v1
//      sign-in resolver), so usernames resolve exactly as production's index does;
//   3. the REAL v1 reset file (what production runs today), then the file under test, run verbatim; its
//      rollback; a re-apply;
//   4. the Edge Function's real handler (supabase/functions/username-password-reset/handler.mjs) wired to
//      this database (resolver AND release, through the handler's own RPC functions), to show one answer
//      and one timing for known, unknown, banned and unconfirmed names, for the first request AND for the
//      repeat from another browser inside the window;
//   5. the review-hold scenarios: a decoy request claims nothing; a request the provider refuses (no or
//      bad captcha, 4xx, 5xx) gives its window back, so an attacker with the public key and no captcha
//      cannot keep anyone on "wait"; a 429 keeps the window (no existence oracle); a late clock never
//      answers more than the window.
// Stand-ins: auth.users (columns only), the three roles, schema grants. Everything else is repo SQL.
// NOT covered: true concurrency (pglite is one connection, so the row-lock race in step 6 of the
// resolver is argued from ON CONFLICT semantics, not run), and the provider's own limit (never called).
//
// Also checks the prod-vs-repo md5: the md5 of the v1 function bodies in the repo equals the md5 saved in
// 20261126190000_account_username_reset_v2.preimage.json (read-only query of the live database).
//
// Usage (pglite pinned at 0.5.13, installed with `npm ci --ignore-scripts` in its own folder):
//   PGLITE_SANDBOX=<folder with node_modules/@electric-sql/pglite> node supabase/proposed/account_username_reset_v2.scratch-test.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECOY_RECIPIENT,
  SEND_WINDOW_SECONDS,
  createUsernameResetHandler,
  recipientFrom,
  releaseUsernameResetRpc,
  resolveUsernameResetRpc,
} from "../functions/username-password-reset/handler.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sandbox = process.env.PGLITE_SANDBOX;
if (!sandbox) {
  console.error("Set PGLITE_SANDBOX to a folder with node_modules/@electric-sql/pglite.");
  process.exit(2);
}
const { PGlite } = createRequire(path.join(sandbox, "package.json"))("@electric-sql/pglite");

const root = path.resolve(__dirname, "../..");
const V1_PATH = path.join(__dirname, "20261115210000_account_username_reset_v1.sql");
const APPLY_PATH = path.join(__dirname, "20261126190000_account_username_reset_v2.sql");
const ROLLBACK_PATH = path.join(__dirname, "20261126190000_account_username_reset_v2.rollback.sql");
const PREIMAGE_PATH = path.join(__dirname, "20261126190000_account_username_reset_v2.preimage.json");
const INDEX_PATH = path.join(root, "supabase/migrations/20260826163000_account_username_signin_index.sql");
const V1 = fs.readFileSync(V1_PATH, "utf8");
const APPLY = fs.readFileSync(APPLY_PATH, "utf8");
const ROLLBACK = fs.readFileSync(ROLLBACK_PATH, "utf8");
const INDEX_SQL = fs.readFileSync(INDEX_PATH, "utf8");
const INDEX_AND_ATTEMPTS = INDEX_SQL.slice(0, INDEX_SQL.indexOf("create or replace function public.account_resolve_username_signin("));
const WINDOW = 65; // the SQL send_window (provider minute + 5 s)
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hex = (text) => crypto.createHash("sha256").update(text).digest("hex");
const md5 = (text) => crypto.createHash("md5").update(text).digest("hex");

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
const sendKeyAccount = (id) => hex(`username-reset-send-v2:account:${id}`);
const sendKeyName = (name) => hex(`username-reset-send-v2:name:${name}`);

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

/** A database shaped like production: sign-in index + attempts table + v1 reset (live today), then v2. */
async function fresh({ apply = true, v1 = true, extra = "", afterV1 = "" } = {}) {
  const db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(INDEX_AND_ATTEMPTS);
  await db.exec(USERS);
  if (extra) await db.exec(extra);
  if (v1) await db.exec(V1);
  if (afterV1) await db.exec(afterV1);
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
const repeatKnownNoClaim = (row) => row.claimedAt === null && row.userId === null && row.wait > 0;
/** One v2 resolver call as the Edge Function makes it (service role). */
async function resolveAs(db, username, client, role = "service_role") {
  const keys = keysFor(username, client);
  const result = await as(
    db,
    role,
    `select resolved_user_id, throttled, wait_seconds, to_json(claimed_at) #>> '{}' as claimed_at
     from account_api.account_resolve_username_reset_v2($1, $2, $3)`,
    [username, keys.client, keys.pair],
  );
  if (result.error) return { error: result.error };
  const row = result.rows[0];
  return { claimedAt: row.claimed_at, throttled: row.throttled, userId: row.resolved_user_id, wait: row.wait_seconds };
}
const rowCount = async (db, key) =>
  (await db.query("select attempt_count from account_private.username_signin_attempts where attempt_key = $1", [key])).rows[0]?.attempt_count ?? 0;
const startedAt = async (db, key) =>
  (await db.query("select extract(epoch from window_started_at)::float8 s from account_private.username_signin_attempts where attempt_key = $1", [key])).rows[0]?.s ?? null;
/** Moves a send window `seconds` into the past (the clock cannot be injected into the SQL). */
const age = (db, key, seconds) =>
  db.query("update account_private.username_signin_attempts set window_started_at = now() - make_interval(secs => $2) where attempt_key = $1", [key, seconds]);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const v1Bodies = async (db) =>
  (await db.query(`select p.proname, md5(p.prosrc) m from pg_proc p where p.proname in ('account_resolve_username_reset_v1', 'resolve_username_reset_v1') order by 1`)).rows;

(async () => {
  console.log(`apply    sha256: ${sha(APPLY_PATH)}`);
  console.log(`rollback sha256: ${sha(ROLLBACK_PATH)}\n`);

  // Prod-vs-repo: the live v1 bodies (saved read-only preimage) equal the repo's v1 file.
  const preimage = JSON.parse(fs.readFileSync(PREIMAGE_PATH, "utf8").replace(/^﻿/, "")).rows[0];
  const repoBodies = [...V1.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((match) => md5(match[1]));
  const liveBodies = preimage.reset_functions.map((fn) => fn.body_md5);
  check("prod-vs-repo md5: both live v1 function bodies equal the repo v1 file",
    repoBodies.length === 2 && repoBodies.every((value) => liveBodies.includes(value)) && liveBodies.length === 2,
    `repo ${repoBodies.join(",")} live ${liveBodies.join(",")}`);
  check("preimage: live v1 functions are service_role only, security definer, empty search_path; v2 absent; nothing blocking",
    preimage.reset_functions.every((fn) => fn.service_role_exec && !fn.anon_exec && !fn.authenticated_exec && fn.definer
      && JSON.stringify(fn.fn_config) === JSON.stringify(["search_path=\"\""]))
      && preimage.v2_api_present === false && preimage.v2_inner_present === false
      && preimage.v2_release_api_present === false && preimage.v2_release_inner_present === false
      && typeof preimage.captured_at === "string" && preimage.blocking.length === 0
      && preimage.sha256_builtin_abc === hex("abc"),
    JSON.stringify(preimage.blocking));

  // Apply.
  let db = await fresh({ apply: false });
  const v1Before = await v1Bodies(db);
  let error = await tryExec(db, APPLY);
  check("apply: runs cleanly on a database shaped like production (v1 live)", error === null, error?.message);
  check("apply: v1 functions are byte-identical afterwards (additive)", JSON.stringify(await v1Bodies(db)) === JSON.stringify(v1Before));
  const v1Still = await as(db, "service_role", "select resolved_user_id, throttled from account_api.account_resolve_username_reset_v1($1, $2, $3)",
    ["known", keysFor("known", "9.9.9.9").client, keysFor("known", "9.9.9.9").pair]);
  check("apply: v1 still answers (the deployed function keeps working until redeployed)", !v1Still.error && v1Still.rows[0].resolved_user_id === KNOWN, v1Still.error?.message);

  // Same result shape for known and unknown on the first request.
  const known = await resolveAs(db, "known", "198.51.100.1");
  const unknown = await resolveAs(db, "nobody", "198.51.100.1");
  check("first request, known: account returned, no wait", known.userId === KNOWN && known.throttled === false && known.wait === 0, JSON.stringify(known));
  check("first request, unknown: same shape, null account, no wait", unknown.userId === null && unknown.throttled === false && unknown.wait === 0, JSON.stringify(unknown));
  check("both rows have the same columns", JSON.stringify(Object.keys(known)) === JSON.stringify(Object.keys(unknown)));
  check("first request, known and unknown alike: a claim comes back (the reservation to release if the provider refuses)",
    typeof known.claimedAt === "string" && typeof unknown.claimedAt === "string", JSON.stringify([known.claimedAt, unknown.claimedAt]));
  check("a turned-away repeat claims nothing", repeatKnownNoClaim(await resolveAs(db, "known", "203.0.113.76")));

  // THE FIX: a repeat from ANOTHER client inside the minute waits, for known and unknown alike.
  const repeatKnown = await resolveAs(db, "known", "203.0.113.77");
  const repeatUnknown = await resolveAs(db, "nobody", "203.0.113.78");
  check("repeat from another client inside the minute: known waits, no account", repeatKnown.userId === null && repeatKnown.throttled === false && repeatKnown.wait >= WINDOW - 3 && repeatKnown.wait <= WINDOW, JSON.stringify(repeatKnown));
  check("repeat from another client inside the minute: unknown waits identically (no existence oracle)",
    repeatUnknown.userId === null && repeatUnknown.throttled === false && Math.abs(repeatUnknown.wait - repeatKnown.wait) <= 1, JSON.stringify(repeatUnknown));

  // Keys: sha256 of the account id for a known name, of the name for an unknown one; nothing raw.
  check("stored send key: sha256 of the account id for a known username", (await rowCount(db, sendKeyAccount(KNOWN))) === 1);
  check("stored send key: sha256 of the name for an unknown username", (await rowCount(db, sendKeyName("nobody"))) === 1);
  const rawRows = (await db.query(`select count(*)::int n from account_private.username_signin_attempts
    where attempt_key !~ '^[0-9a-f]{64}$' or attempt_key like '%known%' or attempt_key like '%nobody%' or attempt_key like '%@%'`)).rows[0].n;
  check("no row key holds a username, email or account id in clear", rawRows === 0);
  check("the table's own constraint accepts only 64 hex keys", Boolean((await tryExec(db, "insert into account_private.username_signin_attempts values ('known', now(), 1)"))));

  // A wait does not extend the window and does not use the send cap.
  const known1 = sendKeyAccount(KNOWN);
  const t0 = await startedAt(db, known1);
  const globalBefore = await rowCount(db, GLOBAL_RESET_ROW);
  await resolveAs(db, "known", "203.0.113.79");
  await resolveAs(db, "known", "203.0.113.80");
  check("a turned-away request does not move the window start", (await startedAt(db, known1)) === t0);
  check("a wait is not counted per (username, client): the repeat client's pair row was never written",
    (await rowCount(db, keysFor("known", "203.0.113.77").pair)) === 0);
  check("a wait still counts against the client's own limit (20 per 15 min)", (await rowCount(db, keysFor("known", "203.0.113.77").client)) === 1);
  check("a wait does not touch the shared reset row", (await rowCount(db, GLOBAL_RESET_ROW)) === globalBefore, `${globalBefore} -> ${await rowCount(db, GLOBAL_RESET_ROW)}`);

  // The window lasts 65 s from the claim: 35 s left at 30 s old, free at 66 s old.
  await age(db, known1, 30);
  const half = await resolveAs(db, "known", "203.0.113.81");
  check("30 s into the window: waits about 35 s more", half.wait >= 34 && half.wait <= 36 && half.userId === null, JSON.stringify(half));
  await age(db, known1, 64);
  const nearEnd = await resolveAs(db, "known", "203.0.113.82");
  check("64 s into the window: waits 1-2 s", nearEnd.wait >= 1 && nearEnd.wait <= 2, JSON.stringify(nearEnd));
  await age(db, known1, 66);
  const reopened = await resolveAs(db, "known", "203.0.113.83");
  check("66 s after the claim: the account is sent to again", reopened.userId === KNOWN && reopened.wait === 0 && reopened.throttled === false, JSON.stringify(reopened));
  check("the claim restarts the window at now", Math.abs((await startedAt(db, known1)) - Date.now() / 1000) < 5);

  // Repeats by name vs by account: a renamed account keeps ONE window (account id), not one per name.
  db = await fresh();
  await resolveAs(db, "known", "198.51.100.1");
  await db.query(`update auth.users set raw_user_meta_data = '{"username":"Renamed"}' where id = '${KNOWN}'`);
  const renamedIndex = (await db.query("select normalized_username from account_private.username_signin_index where user_id = $1", [KNOWN])).rows[0]?.normalized_username;
  const viaNewName = await resolveAs(db, "renamed", "198.51.100.2");
  check("rename: the sign-in index follows the account (stand-in trigger is the real one)", renamedIndex === "renamed", String(renamedIndex));
  check("rename: the new name hits the same account's window", viaNewName.wait > 0 && viaNewName.userId === null, JSON.stringify(viaNewName));

  // Privileges: never anon or authenticated; the service role only through account_api.
  db = await fresh();
  for (const role of ["anon", "authenticated"]) {
    const denied = await resolveAs(db, "known", "198.51.100.2", role);
    check(`${role} cannot call the API function`, denied.error?.code === "42501", denied.error?.message ?? "no error");
    const inner = await as(db, role, "select * from account_private.resolve_username_reset_v2('known', $1, $2)", [
      "a".repeat(64), "b".repeat(64),
    ]);
    check(`${role} cannot call the inner function`, Boolean(inner.error), inner.error?.message ?? "no error");
    const table = await as(db, role, "select count(*) from account_private.username_signin_attempts");
    check(`${role} cannot read the counters`, Boolean(table.error));
  }
  for (const role of ["anon", "authenticated"]) {
    const outer = await as(db, role, "select account_api.account_release_username_reset_v2('known', now())");
    check(`${role} cannot call the release API function`, outer.error?.code === "42501", outer.error?.message ?? "no error");
    const inner = await as(db, role, "select account_private.release_username_reset_v2('known', now())");
    check(`${role} cannot call the inner release function`, Boolean(inner.error), inner.error?.message ?? "no error");
  }
  const acl = (await db.query(`
    select p.proname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('account_resolve_username_reset_v2', 'resolve_username_reset_v2', 'account_release_username_reset_v2', 'release_username_reset_v2')
    order by p.proname`)).rows;
  check("all four v2 functions are security definer with an empty search_path",
    acl.length === 4 && acl.every((row) => row.prosecdef && JSON.stringify(row.proconfig) === JSON.stringify(["search_path=\"\""])),
    JSON.stringify(acl));
  const execPublic = (await db.query(`select
      has_function_privilege('public', 'account_api.account_resolve_username_reset_v2(text, text, text)', 'execute') a,
      has_function_privilege('public', 'account_private.resolve_username_reset_v2(text, text, text)', 'execute') b,
      has_function_privilege('public', 'account_api.account_release_username_reset_v2(text, timestamptz)', 'execute') c,
      has_function_privilege('public', 'account_private.release_username_reset_v2(text, timestamptz)', 'execute') d,
      has_function_privilege('service_role', 'account_api.account_release_username_reset_v2(text, timestamptz)', 'execute') e`)).rows[0];
  check("PUBLIC has no execute on any v2 function; service_role may release", !execPublic.a && !execPublic.b && !execPublic.c && !execPublic.d && execPublic.e);

  // Invalid input answers (null, false, 0) and writes nothing.
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
      "select resolved_user_id, throttled, wait_seconds, claimed_at from account_api.account_resolve_username_reset_v2($1, $2, $3)", args);
    check(`invalid input (${label}) answers null/false/0 and claims nothing`,
      !result.error && result.rows[0].resolved_user_id === null && result.rows[0].throttled === false && result.rows[0].wait_seconds === 0
        && result.rows[0].claimed_at === null,
      result.error?.message ?? JSON.stringify(result.rows?.[0]));
  }
  const after = (await db.query("select count(*)::int n from account_private.username_signin_attempts")).rows[0].n;
  check("invalid input writes no counter", before === after, `${before} -> ${after}`);

  // v1 behaviour kept: per-(username, client) 5 per window, send cap 2, identical for known and unknown.
  // The send window is aged between calls so only the v1 counters are in play.
  db = await fresh();
  const knownSeq = [];
  const unknownSeq = [];
  const knownIds = [];
  const waits = [];
  for (let i = 0; i < 7; i += 1) {
    const knownRow = await resolveAs(db, "known", "203.0.113.1");
    knownSeq.push(knownRow.throttled);
    waits.push(knownRow.wait);
    knownIds.push(knownRow.userId === KNOWN ? "account" : knownRow.userId === null ? "none" : "other");
    unknownSeq.push((await resolveAs(db, "nobody", "203.0.113.2")).throttled);
    await age(db, sendKeyAccount(KNOWN), 66);
    await age(db, sendKeyName("nobody"), 66);
  }
  check("send cap kept: only requests 1-2 from one client return the account; 3-5 answer not-throttled with no account",
    JSON.stringify(knownIds) === JSON.stringify(["account", "account", "none", "none", "none", "none", "none"]), JSON.stringify(knownIds));
  check("pair limit kept: requests 1-5 pass, the 6th is throttled", JSON.stringify(knownSeq) === JSON.stringify([false, false, false, false, false, true, true]), JSON.stringify(knownSeq));
  check("pair limit kept: an unknown name throttles at exactly the same request", JSON.stringify(knownSeq) === JSON.stringify(unknownSeq), JSON.stringify(unknownSeq));
  check("no wait was reported while the window was aged out", waits.every((value) => value === 0), JSON.stringify(waits));
  const throttledKnown = await resolveAs(db, "known", "203.0.113.1");
  check("a throttled answer carries no account and no wait", throttledKnown.userId === null && throttledKnown.throttled === true && throttledKnown.wait === 0);
  const otherClient = await resolveAs(db, "known", "203.0.113.3");
  check("no per-username lock: the owner on another network still gets through", otherClient.userId === KNOWN && !otherClient.throttled);

  // A wait between two real requests does not eat the send cap: ask, wait, (window passes), ask again.
  db = await fresh();
  const first = await resolveAs(db, "known", "203.0.113.4");
  const waited = await resolveAs(db, "known", "203.0.113.4");
  await age(db, sendKeyAccount(KNOWN), 66);
  const second = await resolveAs(db, "known", "203.0.113.4");
  check("ask, wait, ask again from one client: both real requests get the account (cap is 2 real requests)",
    first.userId === KNOWN && waited.wait > 0 && second.userId === KNOWN, JSON.stringify([first, waited, second]));
  check("the waiting request left the pair counter at 2, not 3", (await rowCount(db, keysFor("known", "203.0.113.4").pair)) === 2);

  // Rate limit wins over the wait for a client already over its own limit.
  db = await fresh();
  for (let i = 0; i < 20; i += 1) await resolveAs(db, `ghost${i}`, "203.0.113.50");
  const overClient = await resolveAs(db, "known", "203.0.113.50");
  check("a client over its limit is throttled (not told to wait), known name included", overClient.throttled && overClient.wait === 0 && overClient.userId === null, JSON.stringify(overClient));

  // Per-client: 20 per window across names, then throttled; known and unknown names count alike.
  db = await fresh();
  const clientSeq = [];
  for (let i = 0; i < 22; i += 1) {
    const name = i % 2 === 0 ? `ghost${i}` : (i === 21 ? "known" : `user${i}`);
    clientSeq.push((await resolveAs(db, name, "203.0.113.51")).throttled);
  }
  check("client limit kept: requests 1-20 pass, the 21st is throttled", clientSeq.slice(0, 20).every((v) => !v) && clientSeq[20] && clientSeq[21], JSON.stringify(clientSeq));

  // Reset-only shared row: 100 per window, then throttled; never touches the sign-in shared row.
  db = await fresh();
  await db.query("insert into account_private.username_signin_attempts values ($1, now(), 7)", [SIGNIN_GLOBAL_ROW]);
  const globalSeq = [];
  for (let i = 0; i < 102; i += 1) globalSeq.push((await resolveAs(db, i === 101 ? "known" : `name${i}`, `192.0.2.${i}`)).throttled);
  check("shared limit kept: requests 1-100 pass, the 101st is throttled", globalSeq.slice(0, 100).every((v) => !v) && globalSeq[100] && globalSeq[101], `first throttled at ${globalSeq.indexOf(true) + 1}`);
  check("the sign-in shared row is untouched", (await rowCount(db, SIGNIN_GLOBAL_ROW)) === 7);
  check("a request throttled by the shared limit does not claim a send window", (await rowCount(db, sendKeyAccount(KNOWN))) === 0 && (await rowCount(db, sendKeyName("name100"))) === 0);

  // Window: rows older than 15 minutes are dropped (counters and stale send windows alike).
  db = await fresh();
  await resolveAs(db, "known", "203.0.113.9");
  await age(db, sendKeyAccount(KNOWN), 16 * 60);
  await resolveAs(db, "nobody", "203.0.113.10");
  check("rows older than 15 minutes are cleaned by the next call", (await rowCount(db, sendKeyAccount(KNOWN))) === 0);

  // Timing at the SQL layer: known and unknown names do the same work, including the wait path.
  db = await fresh();
  const sqlTimes = { known: [], unknown: [], knownWait: [], unknownWait: [] };
  for (let i = 0; i < 60; i += 1) {
    for (const [kind, name] of [["known", "known"], ["unknown", `nobody${i}`]]) {
      await age(db, sendKeyAccount(KNOWN), 66);
      const started = performance.now();
      await resolveAs(db, name, `198.18.${kind === "known" ? 1 : 2}.${i}`);
      sqlTimes[kind].push(performance.now() - started);
      const waitStarted = performance.now();
      await resolveAs(db, name, `198.19.${kind === "known" ? 1 : 2}.${i}`);
      sqlTimes[`${kind}Wait`].push(performance.now() - waitStarted);
    }
  }
  const diff = (a, b) => Math.abs(median(sqlTimes[a]) - median(sqlTimes[b]));
  check("SQL timing: known and unknown medians within 2 ms (claim path)", diff("known", "unknown") < 2,
    `known ${median(sqlTimes.known).toFixed(2)} ms, unknown ${median(sqlTimes.unknown).toFixed(2)} ms`);
  check("SQL timing: known and unknown medians within 2 ms (wait path)", diff("knownWait", "unknownWait") < 2,
    `known ${median(sqlTimes.knownWait).toFixed(2)} ms, unknown ${median(sqlTimes.unknownWait).toFixed(2)} ms`);

  // End to end: the real Edge Function handler on this database.
  db = await fresh();
  const sent = [];
  const tokens = [];
  const scheduled = [];
  const floor = 300;
  let providerStatus = 200; // what the provider answers; the review-hold scenarios flip it
  const releaseCalls = [];
  // PostgREST stand-in for the real RPC wire functions: named arguments, JSON in, JSON out.
  const rpcFetch = async (url, init) => {
    const args = JSON.parse(init.body);
    if (url.endsWith("/account_release_username_reset_v2")) {
      const result = await as(db, "service_role",
        "select account_api.account_release_username_reset_v2(p_normalized_username => $1, p_claimed_at => $2::timestamptz) as released",
        [args.p_normalized_username, args.p_claimed_at]);
      if (result.error) return new Response(JSON.stringify({ message: result.error.message }), { status: 404 });
      return new Response(JSON.stringify(result.rows[0].released), { status: 200 });
    }
    const result = await as(db, "service_role",
      `select resolved_user_id, throttled, wait_seconds, to_json(claimed_at) #>> '{}' as claimed_at
       from account_api.account_resolve_username_reset_v2(p_normalized_username => $1, p_client_key => $2, p_pair_key => $3)`,
      [args.p_normalized_username, args.p_client_key, args.p_pair_key]);
    if (result.error) return new Response(JSON.stringify({ message: result.error.message }), { status: 404 });
    return new Response(JSON.stringify(result.rows), { status: 200 });
  };
  const handle = createUsernameResetHandler({
    admitKey: async () => true,
    background: (task) => scheduled.push(task),
    async findRecipient(userId) {
      const user = (await db.query("select email, to_json(banned_until) #>> '{}' banned_until, to_json(deleted_at) #>> '{}' deleted_at from auth.users where id = $1", [userId])).rows[0];
      await new Promise((done) => setTimeout(done, 150)); // a slow admin API call, existing accounts only
      return recipientFrom(user ?? null, Date.now());
    },
    minimumResponseMs: floor,
    async release({ claimedAt, normalized }) {
      const released = await releaseUsernameResetRpc({
        args: { p_claimed_at: claimedAt, p_normalized_username: normalized },
        fetchImpl: rpcFetch,
        serviceRole: "service-role-fixture",
        url: "https://project.example.test",
      });
      releaseCalls.push({ normalized, released });
      return released;
    },
    async resolve({ clientKey, normalized, pairKey }) {
      return resolveUsernameResetRpc({
        args: { p_client_key: clientKey, p_normalized_username: normalized, p_pair_key: pairKey },
        fetchImpl: rpcFetch,
        serviceRole: "service-role-fixture",
        url: "https://project.example.test",
      });
    },
    async sendRecovery(input) {
      sent.push(input.email);
      tokens.push(input.captchaToken);
      return providerStatus;
    },
    sha256: async (text) => hex(text),
  });
  const request = (identifier, ip, captchaToken = "turnstile-token-fixture") => new Request("https://project.example.test/functions/v1/username-password-reset", {
    body: JSON.stringify({
      code_challenge: "A".repeat(43),
      captchaToken,
      code_challenge_method: "s256",
      identifier,
      redirect_to: "https://account.fawxzzy.com/reset-password?recovery=1",
    }),
    headers: { apikey: "sb_publishable_fixture", "cf-connecting-ip": ip, "content-type": "application/json", origin: "https://account.fawxzzy.com" },
    method: "POST",
  });
  const kinds = { known: "known", unknown: "nobody", banned: "banned", unconfirmed: "unconfirmed" };
  const answers = { first: {}, repeat: {} };
  const times = { first: {}, repeat: {} };
  for (const [kind, name] of Object.entries(kinds)) {
    for (const [phase, ip] of [["first", "100.64.1.1"], ["repeat", "100.64.2.2"]]) {
      const started = performance.now();
      const response = await handle(request(name, ip));
      const body = await response.text();
      (times[phase][kind] ??= []).push(performance.now() - started);
      answers[phase][kind] = `${response.status} ${body} ${[...response.headers.entries()].filter(([key]) => key !== "retry-after").sort().join("|")} ra=${response.headers.get("retry-after")}`;
    }
  }
  const firstSet = new Set(Object.values(answers.first));
  const repeatSet = new Set(Object.values(answers.repeat));
  check("handler: first request: known, unknown, banned and unconfirmed get the identical 200 answer",
    firstSet.size === 1 && answers.first.known.startsWith("200 "), answers.first.known.slice(0, 40));
  check("handler: repeat from another browser: all four get the identical 429 reset_wait (Retry-After included)",
    repeatSet.size === 1 && answers.repeat.known.startsWith("429 {\"code\":\"reset_wait\"}") && /ra=\d+$/.test(answers.repeat.known), answers.repeat.known.slice(0, 60));
  const allTimes = Object.values(times).flatMap((phase) => Object.values(phase).map(median));
  check(`handler: every answer, first or wait, takes the ${floor} ms floor, spread under 40 ms`,
    allTimes.every((value) => value >= floor - 2) && Math.max(...allTimes) - Math.min(...allTimes) < 40,
    allTimes.map((value) => value.toFixed(0)).join(", "));
  await Promise.all(scheduled);
  check("handler: one provider call per FIRST request (4), none for the waits, each carrying the captcha token",
    sent.length === 4 && tokens.every((token) => token === "turnstile-token-fixture"), `${sent.length} calls`);
  check("handler: mail only to the known and unconfirmed accounts; unknown and banned go to the decoy",
    JSON.stringify([...sent].sort()) === JSON.stringify([DECOY_RECIPIENT, DECOY_RECIPIENT, "known@example.test", "unconfirmed@example.test"].sort()), JSON.stringify(sent));
  // After the minute the repeat goes out.
  for (const key of [sendKeyAccount(KNOWN), sendKeyAccount(UNCONFIRMED), sendKeyAccount(BANNED), sendKeyName("nobody")]) await age(db, key, 66);
  sent.length = 0;
  const later = await handle(request("known", "100.64.3.3"));
  await Promise.all(scheduled);
  check("handler: a minute later the same username sends again, same 200 answer", later.status === 200 && sent[0] === "known@example.test", JSON.stringify(sent));
  // Rate limit stays 429 reset_throttled, distinct from the wait.
  for (let i = 0; i < 20; i += 1) await handle(request(`ghost${i}`, "100.64.9.9"));
  const limited = await handle(request("known", "100.64.9.9"));
  check("handler: a client over its limit still gets 429 reset_throttled (Retry-After 900)",
    limited.status === 429 && (await limited.json()).code === "reset_throttled" && limited.headers.get("retry-after") === "900");
  check("handler: a successful send released nothing", releaseCalls.length === 0, JSON.stringify(releaseCalls));
  check("handler: the wait the browser sees is within 1..65 s", /^(?:[1-9]|[1-5]\d|6[0-5])$/.test(String(answers.repeat.known.match(/ra=(\d+)$/)?.[1])), answers.repeat.known.slice(-12));

  // ---- REVIEW-HOLD SCENARIOS ----
  const reset = async () => {
    await db.query("delete from account_private.username_signin_attempts");
    sent.length = 0;
    tokens.length = 0;
    releaseCalls.length = 0;
    scheduled.length = 0;
  };
  const answerOf = async (name, ip, captcha) => {
    const started = performance.now();
    const response = await handle(request(name, ip, captcha));
    const text = await response.text();
    return { ms: performance.now() - started, text: `${response.status} ${text} ${[...response.headers.entries()].filter(([key]) => key !== "retry-after").sort().join("|")} ra=${response.headers.get("retry-after")}`, status: response.status };
  };
  const windowRows = async () => (await db.query(
    "select count(*)::int n from account_private.username_signin_attempts where attempt_key in ($1, $2)",
    [sendKeyAccount(KNOWN), sendKeyName("nobody")])).rows[0].n;

  // P1a. The attacker case: the public key, no (valid) captcha, a fresh IP per request. The provider
  // refuses every call (400), so every window is given back and the owner is never held.
  await reset();
  providerStatus = 400;
  const attackerAnswers = [];
  for (let i = 0; i < 12; i += 1) {
    attackerAnswers.push(await answerOf("known", `198.18.7.${i}`, "no-captcha"));
    await Promise.all(scheduled.splice(0));
  }
  check("attack: twelve captcha-less requests for one known username, a new IP each: every answer is the same 200",
    attackerAnswers.every((entry) => entry.text === answers.first.known), attackerAnswers[0].text.slice(0, 40));
  check("attack: each failed send gave its window back (nothing is held after twelve)", (await windowRows()) === 0);
  check("attack: each release found its own claim", releaseCalls.length === 12 && releaseCalls.every((call) => call.released === true), JSON.stringify(releaseCalls.slice(0, 2)));
  providerStatus = 200;
  sent.length = 0;
  const owner = await answerOf("known", "203.0.113.200", "real-captcha");
  await Promise.all(scheduled.splice(0));
  check("attack: the owner's real request right after is NOT told to wait and goes out", owner.status === 200 && sent[0] === "known@example.test", `${owner.status} ${JSON.stringify(sent)}`);

  // The same for an unknown username: the attacker gets the same answer and the same release.
  await reset();
  providerStatus = 400;
  const attackUnknown = await answerOf("nobody", "198.18.8.1", "no-captcha");
  await Promise.all(scheduled.splice(0));
  check("attack on an unknown name: same 200 answer as for a known one", attackUnknown.text === answers.first.known, attackUnknown.text.slice(0, 40));
  check("attack on an unknown name: its window is released too (same behaviour as a known one)", (await windowRows()) === 0 && releaseCalls.length === 1 && releaseCalls[0].released === true);

  // P1b. A 429 from the provider keeps the window (the provider answers 429 only for accounts that
  // exist, so releasing on 429 would turn the wait into an existence oracle); 2xx keeps it too.
  for (const status of [429, 200]) {
    await reset();
    providerStatus = status;
    await answerOf("known", "198.18.9.1", "captcha");
    await answerOf("nobody", "198.18.9.2", "captcha");
    await Promise.all(scheduled.splice(0));
    check(`provider ${status}: both the known and the unknown name keep their window (no oracle), nothing released`,
      (await windowRows()) === 2 && releaseCalls.length === 0, `rows ${await windowRows()}, releases ${releaseCalls.length}`);
  }

  // An attacker cannot release (or even touch) a window a REAL send holds: its own request is turned away
  // with a wait, claims nothing and so never calls release.
  await reset();
  providerStatus = 200;
  await answerOf("known", "198.18.10.1", "captcha");
  await Promise.all(scheduled.splice(0));
  const heldSince = await startedAt(db, sendKeyAccount(KNOWN));
  providerStatus = 400;
  const turnedAway = await answerOf("known", "198.18.10.2", "no-captcha");
  await Promise.all(scheduled.splice(0));
  check("a real send's window survives an attacker's request (turned away, no release, start unchanged)",
    turnedAway.status === 429 && releaseCalls.length === 0 && (await startedAt(db, sendKeyAccount(KNOWN))) === heldSince);
  // Worst case left: a real send blocks the next one for at most the window (65 s), never longer.
  await age(db, sendKeyAccount(KNOWN), 66);
  providerStatus = 200;
  sent.length = 0;
  const afterWindow = await answerOf("known", "198.18.10.3", "captcha");
  await Promise.all(scheduled.splice(0));
  check("65 s after the last real send the next request goes out", afterWindow.status === 200 && sent[0] === "known@example.test");

  // P1c. Decoy (past the v1 send cap): claims nothing, answers like any other, and holds nobody.
  await reset();
  providerStatus = 200;
  const decoyClient = "198.18.11.1";
  const decoyRows = [];
  for (let i = 0; i < 3; i += 1) {
    decoyRows.push(await resolveAs(db, "known", decoyClient));
    await age(db, sendKeyAccount(KNOWN), 66);
  }
  const startBefore = await startedAt(db, sendKeyAccount(KNOWN));
  const decoyKnown = await resolveAs(db, "known", decoyClient);
  check("decoy: the 4th request from one client is a decoy (no account) with no claim and no wait",
    decoyKnown.userId === null && decoyKnown.claimedAt === null && decoyKnown.wait === 0 && decoyKnown.throttled === false, JSON.stringify(decoyKnown));
  check("decoy: the send window row is untouched (a decoy never holds the window)", (await startedAt(db, sendKeyAccount(KNOWN))) === startBefore);
  const afterDecoy = await resolveAs(db, "known", "198.18.11.2");
  check("decoy: the owner from another network is sent to straight away", afterDecoy.userId === KNOWN && afterDecoy.wait === 0 && typeof afterDecoy.claimedAt === "string", JSON.stringify(afterDecoy));
  for (let i = 0; i < 3; i += 1) {
    await resolveAs(db, "nobody", "198.18.11.3");
    await age(db, sendKeyName("nobody"), 66);
  }
  const decoyUnknown4 = await resolveAs(db, "nobody", "198.18.11.3");
  check("decoy: an unknown name behaves the same (no claim, no wait)", decoyUnknown4.claimedAt === null && decoyUnknown4.wait === 0 && decoyUnknown4.userId === null, JSON.stringify(decoyUnknown4));
  // The caller sees one answer for real and decoy: status, body, headers, same floor.
  await reset();
  const mixed = [];
  for (let i = 0; i < 4; i += 1) {
    await db.query("delete from account_private.username_signin_attempts where attempt_key in ($1, $2)", [sendKeyAccount(KNOWN), sendKeyName("nobody")]);
    mixed.push(await answerOf(i % 2 === 0 ? "known" : "nobody", "198.18.12.1", "captcha"));
    await Promise.all(scheduled.splice(0));
  }
  check("decoy vs real: one answer text for all four (the 3rd and 4th from this client are decoys)", new Set(mixed.map((entry) => entry.text)).size === 1 && mixed[0].status === 200);
  check("decoy vs real: every answer takes the floor and the spread is under 40 ms",
    mixed.every((entry) => entry.ms >= floor - 2) && Math.max(...mixed.map((entry) => entry.ms)) - Math.min(...mixed.map((entry) => entry.ms)) < 40,
    mixed.map((entry) => entry.ms.toFixed(0)).join(", "));

  // P2. A late clock never answers more than the window. A window row that starts in the future (a
  // request that began later than this one but committed first) must give wait = 65, not 66 or more.
  await reset();
  await resolveAs(db, "known", "198.18.13.1");
  for (const ahead of [1, 5, 120]) {
    await db.query("update account_private.username_signin_attempts set window_started_at = now() + make_interval(secs => $2) where attempt_key = $1", [sendKeyAccount(KNOWN), ahead]);
    const late = await resolveAs(db, "known", `198.18.13.${10 + ahead}`);
    check(`late clock (window starts ${ahead} s in the future): the answer is clamped to ${WINDOW}`, late.wait === WINDOW && late.userId === null && late.claimedAt === null, JSON.stringify(late));
  }
  // End to end through the handler: such a row answers 429 reset_wait with Retry-After 65, not a 503.
  await db.query("update account_private.username_signin_attempts set window_started_at = now() + interval '3 seconds' where attempt_key = $1", [sendKeyAccount(KNOWN)]);
  const lateAnswer = await handle(request("known", "198.18.13.99"));
  check("late clock through the handler: 429 reset_wait with Retry-After 65 (the two-browser case, not a 503)",
    lateAnswer.status === 429 && lateAnswer.headers.get("retry-after") === String(SEND_WINDOW_SECONDS), `${lateAnswer.status} ra=${lateAnswer.headers.get("retry-after")}`);
  check("the clamp constants agree: handler 65 = SQL window 65", SEND_WINDOW_SECONDS === WINDOW);

  // The release function itself.
  await reset();
  const claim = await resolveAs(db, "known", "198.18.14.1");
  const unknownClaim = await resolveAs(db, "nobody", "198.18.14.2");
  const release = async (name, at) => (await as(db, "service_role", "select account_api.account_release_username_reset_v2($1, $2::timestamptz) as r", [name, at])).rows?.[0]?.r;
  const otherClaim = await resolveAs(db, "known", "198.18.14.3"); // held by the first claim: a wait, claims nothing
  check("release setup: a request inside the window gets no claim to release", otherClaim.claimedAt === null && otherClaim.wait > 0);
  check("release: a wrong timestamp (a window another request took over) releases nothing", (await release("known", "2000-01-01T00:00:00+00:00")) === false && (await rowCount(db, sendKeyAccount(KNOWN))) === 1);
  check("release: the exact claim is released", (await release("known", claim.claimedAt)) === true && (await rowCount(db, sendKeyAccount(KNOWN))) === 0);
  check("release: releasing again finds nothing", (await release("known", claim.claimedAt)) === false);
  check("release: an unknown name's claim is released by name", (await release("nobody", unknownClaim.claimedAt)) === true && (await rowCount(db, sendKeyName("nobody"))) === 0);
  const again = await resolveAs(db, "known", "198.18.14.4");
  check("release: a claim cannot be released under another name",
    typeof again.claimedAt === "string" && (await release("nobody", again.claimedAt)) === false && (await rowCount(db, sendKeyAccount(KNOWN))) === 1);
  const countersBefore = (await db.query("select count(*)::int n from account_private.username_signin_attempts where attempt_key not in ($1, $2)", [sendKeyAccount(KNOWN), sendKeyName("nobody")])).rows[0].n;
  check("release: invalid name and null timestamp release nothing",
    (await release("a b", claim.claimedAt)) === false && (await release("Known", claim.claimedAt)) === false && (await release("known", null)) === false);
  const countersAfter = (await db.query("select count(*)::int n from account_private.username_signin_attempts where attempt_key not in ($1, $2)", [sendKeyAccount(KNOWN), sendKeyName("nobody")])).rows[0].n;
  check("release never touches the client, pair or shared counters", countersAfter === countersBefore, `${countersBefore} -> ${countersAfter}`);
  const counterRow = (await db.query("select attempt_key, window_started_at from account_private.username_signin_attempts where attempt_key = $1", [keysFor("known", "198.18.14.1").client])).rows[0];
  check("release: a counter row cannot be released even with its own timestamp",
    (await release("known", counterRow.window_started_at.toISOString())) === false && (await rowCount(db, keysFor("known", "198.18.14.1").client)) === 1);

  // Preflight refuses a second apply; rollback removes only v2; re-apply works.
  db = await fresh();
  const v1AtStart = await v1Bodies(db);
  error = await tryExec(db, APPLY);
  check("preflight: a second apply is refused", /USERNAME_RESET_V2_PREFLIGHT_ALREADY_PRESENT/.test(error?.message ?? ""), error?.message);
  error = await tryExec(db, ROLLBACK);
  check("rollback: runs cleanly", error === null, error?.message);
  const residue = (await db.query(`select count(*)::int n from pg_proc where proname in ('account_resolve_username_reset_v2', 'resolve_username_reset_v2', 'account_release_username_reset_v2', 'release_username_reset_v2')`)).rows[0].n;
  check("rollback: all four v2 functions are gone", residue === 0);
  check("rollback: v1 functions untouched", JSON.stringify(await v1Bodies(db)) === JSON.stringify(v1AtStart));
  const afterRollback = await resolveAs(db, "known", "198.51.100.77");
  check("rollback: the v2 API answers 'function does not exist' (the new Edge Function maps it to 503)", afterRollback.error?.code === "42883", afterRollback.error?.message);
  const v1Works = await as(db, "service_role", "select resolved_user_id from account_api.account_resolve_username_reset_v1($1, $2, $3)",
    ["known", keysFor("known", "198.51.100.78").client, keysFor("known", "198.51.100.78").pair]);
  check("rollback: v1 still resolves (the previous Edge Function works)", !v1Works.error && v1Works.rows[0].resolved_user_id === KNOWN, v1Works.error?.message);
  error = await tryExec(db, ROLLBACK);
  check("rollback: running it twice is harmless", error === null, error?.message);
  error = await tryExec(db, APPLY);
  check("re-apply after rollback works", error === null, error?.message);
  check("re-apply: resolver works again", (await resolveAs(db, "known", "198.51.100.79")).userId === KNOWN);

  // A half-present v2 (only a release function) is refused too.
  db = await fresh({ apply: false, afterV1: "create function account_private.release_username_reset_v2(text, timestamptz) returns boolean language sql as $$ select false $$;" });
  error = await tryExec(db, APPLY);
  check("preflight: refuses when only a release function already exists", /USERNAME_RESET_V2_PREFLIGHT_ALREADY_PRESENT/.test(error?.message ?? ""), error?.message);

  // Preflights on a database missing what the function needs.
  db = await fresh({ apply: false, v1: false });
  error = await tryExec(db, APPLY);
  check("preflight: refuses without v1 (rollback target must exist)", /USERNAME_RESET_V2_PREFLIGHT_V1_MISSING/.test(error?.message ?? ""), error?.message);
  db = await fresh({ apply: false, v1: false, extra: "drop table account_private.username_signin_attempts;" });
  error = await tryExec(db, APPLY);
  check("preflight: refuses without the attempts table", /USERNAME_RESET_V2_PREFLIGHT_ATTEMPTS_TABLE_MISSING/.test(error?.message ?? ""), error?.message);
  db = await fresh({ apply: false, afterV1: "revoke usage on schema account_api from service_role;" });
  error = await tryExec(db, APPLY);
  check("preflight: refuses when service_role cannot use account_api", /USERNAME_RESET_V2_PREFLIGHT_SERVICE_ROLE_HAS_NO_ACCOUNT_API_USAGE/.test(error?.message ?? ""), error?.message);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
