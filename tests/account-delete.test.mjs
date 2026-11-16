import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * Delete account: the pure outcome mapping in src/lib/auth/account-delete.ts, the copy it points at,
 * the portal wiring, and the shape of the owner-gated SQL in supabase/proposed/ (never applied by CI;
 * supabase/proposed/account_delete_self_v2.scratch-test.mjs runs it for real in pglite). v2 supersedes
 * v1 (v1 refused the live database on 2026-11-16: unlisted account columns).
 */
const del = loadPortalModule("src/lib/auth/account-delete.ts");
const change = loadPortalModule("src/lib/auth/account-change.ts");
const { AUTH_MESSAGES, AUTH_COPY, authNotice } = loadPortalModule("src/lib/auth/copy-matrix.ts");
const { loginNoticeFromQuery } = loadPortalModule("src/lib/auth/auth-outcomes.ts");
const account = loadPortalModule("src/config/account.ts");

const BASE = "supabase/proposed/20261116090000_account_delete_self_v2";
const SQL = readFileSync(`${BASE}.sql`, "utf8");
const ROLLBACK = readFileSync(`${BASE}.rollback.sql`, "utf8");
const PREIMAGE = readFileSync(`${BASE}.preimage.sql`, "utf8");
const LIVE_BODIES = JSON.parse(readFileSync("supabase/proposed/account_delete_self_v2.live-bodies.json", "utf8"));
const V1_BASE = "supabase/proposed/20261115200000_account_delete_self_v1";
const INNER = "create function account_private.delete_account_v2";

test("every id the delete flow can return is a real matrix row", () => {
  const ids = new Set([
    del.deleteReauthProblem("")?.id,
    del.deleteConfirmProblem("nope", "fawxzzy")?.id,
    ...del.ACCOUNT_DELETE_STATUSES.map((status) => del.accountDeleteNotice(status).id).filter(Boolean),
    del.deleteReauthFailure(new change.ReauthMismatchError()),
    del.deleteReauthFailure({ status: 429 }),
    del.deleteReauthFailure({ status: 503 }),
    del.accountDeleteFailure({ code: "PGRST202" }),
    del.accountDeleteFailure({ status: 0 }),
    del.accountDeleteFailure({ status: 429 }),
    del.accountDeleteFailure({}),
    loginNoticeFromQuery(["deleted"]),
  ]);
  for (const id of ids) assert.ok(id && Object.hasOwn(AUTH_MESSAGES, id), `missing matrix row ${id}`);
});

test("the server answers are exactly the seven the SQL returns", () => {
  assert.deepEqual([...del.ACCOUNT_DELETE_STATUSES].sort(), ["billing", "confirm", "deleted", "gone", "rate", "reauth", "support"]);
  for (const status of del.ACCOUNT_DELETE_STATUSES) {
    assert.match(SQL, new RegExp(`return '${status}'`), `SQL returns '${status}'`);
    assert.equal(del.isAccountDeleteStatus(status), true);
  }
  assert.equal(del.isAccountDeleteStatus("ok"), false);
  assert.equal(del.isAccountDeleteStatus(null), false);
  assert.equal(del.isAccountGone("deleted"), true);
  assert.equal(del.isAccountGone("gone"), true);
  assert.equal(del.isAccountGone("billing"), false);
});

test("typed confirmation: username first, email when there is none, trimmed and any case", () => {
  assert.equal(del.deleteConfirmTarget("  Fawxzzy ", "a@b.co"), "Fawxzzy");
  assert.equal(del.deleteConfirmTarget("", "a@b.co"), "a@b.co");
  assert.equal(del.deleteConfirmTarget(undefined, " a@b.co "), "a@b.co");
  assert.equal(del.deleteConfirmTarget(42, null), "");
  assert.equal(del.deleteConfirmMatches(" FAWXZZY ", "fawxzzy"), true);
  assert.equal(del.deleteConfirmMatches("fawxzz", "fawxzzy"), false);
  assert.equal(del.deleteConfirmMatches("", ""), false, "an empty target never matches");
  assert.equal(del.deleteConfirmProblem("fawxzzy", "Fawxzzy"), null);
  assert.deepEqual(del.deleteConfirmProblem("x", "fawxzzy"), { id: "delete.confirmwrong", fields: ["confirmation"] });
  assert.deepEqual(del.deleteReauthProblem(""), { id: "change.pwempty", fields: ["password"] });
  assert.equal(del.deleteReauthProblem("secret"), null);
  // Same rule in SQL: lower(trim(...)) against the username, else the email.
  assert.match(SQL, /typed text := lower\(trim\(coalesce\(p_confirm, ''\)\)\)/);
  assert.match(SQL, /case when account_name <> '' then account_name else account_email end/);
});

test("each answer goes to the right step with the right line", () => {
  assert.deepEqual(del.accountDeleteNotice("reauth"), { id: "delete.reauth", step: "password" });
  assert.deepEqual(del.accountDeleteNotice("confirm"), { id: "delete.confirmwrong", step: "type" });
  assert.deepEqual(del.accountDeleteNotice("billing"), { id: "delete.billing", step: "warning" });
  assert.deepEqual(del.accountDeleteNotice("rate"), { id: "delete.rate", step: "warning" });
  assert.deepEqual(del.accountDeleteNotice("support"), { id: "delete.support", step: "warning" });
  assert.equal(del.accountDeleteNotice("deleted").id, null);
  assert.equal(del.accountDeleteNotice("gone").id, null);
  assert.deepEqual(del.deleteFieldsFor("change.pwwrong"), ["password"]);
  assert.deepEqual(del.deleteFieldsFor("delete.confirmwrong"), ["confirmation"]);
  assert.deepEqual(del.deleteFieldsFor("delete.billing"), []);
});

test("failures: backend missing reads unavailable, never 'nothing happened' guesses", () => {
  for (const code of ["PGRST202", "PGRST106", "42883", "42501", "3F000"]) {
    assert.equal(del.accountDeleteFailure({ code }), "delete.unavailable", code);
  }
  assert.equal(del.accountDeleteFailure({ status: 404 }), "delete.unavailable");
  assert.equal(del.accountDeleteFailure(new TypeError("fetch failed")), "signin.offline");
  assert.equal(del.accountDeleteFailure({ status: 500, code: "XX000" }), "delete.fail");
  // A key the function does not know rolled the call back: retrying can not help, so it is the support
  // line (same as the 'support' refusal), never "Try again".
  assert.equal(del.accountDeleteFailure({ status: 409, code: "23503" }), "delete.support");
  assert.equal(del.accountDeleteFailure({ status: 400, code: "23001" }), "delete.support");
  assert.doesNotMatch(authNotice("delete.support").text, /try again/i);
  assert.match(authNotice("delete.support").text, /support/i);
  assert.equal(del.deleteReauthFailure({ code: "invalid_credentials", status: 400 }), "change.pwwrong");
  assert.equal(del.deleteReauthFailure({ code: "captcha_failed", status: 400 }), "captcha.fail");
  // The failure line must not promise anything about the data: the call may have committed.
  assert.doesNotMatch(authNotice("delete.fail").text, /nothing was deleted/i);
});

test("the last step says in plain words what is deleted and that it cannot be undone", () => {
  const list = AUTH_COPY.deleteList.join(" ");
  for (const word of [/profile/i, /username/i, /Fitness/, /Mazer/, /scores/i, /cannot be undone/i]) {
    assert.match(list, word);
  }
  // No over-promise: Discord feedback and moderation records stay (without the account link), so the
  // copy never says everything goes "in every app" or "everywhere".
  assert.ok(AUTH_COPY.deleteList.some((line) => /Discord feedback and moderation records stay/.test(line)));
  const all = [list, AUTH_COPY.lead.deleteWarning, AUTH_COPY.field.deleteAccountValue].join(" ");
  assert.doesNotMatch(all, /every app|everywhere|all your data|for good/i);
  assert.equal(authNotice("signin.deleted").tone, "success");
  // GoTrue's audit log and the retained archives/backups keep some data (owner decision 2026-11-16
  // "delete live data, keep archives"): the copy says so and the success line does not claim the data
  // is gone.
  assert.ok(AUTH_COPY.deleteList.some((line) => /sign-in logs and backups may keep some data for a while/i.test(line)));
  assert.doesNotMatch(authNotice("signin.deleted").text, /data/i);
});

test("flag: DELETE_ACCOUNT_LIVE is on, the live adapter reads it and the row is gated on it", () => {
  // Live since 2026-11-16 (v2 applied and dry-run proven). Rollback is setting this back to false.
  assert.equal(account.DELETE_ACCOUNT_LIVE, true);
  const adapter = readFileSync("src/lib/auth/browser-adapter.ts", "utf8");
  assert.match(adapter, /deleteAccountLive: DELETE_ACCOUNT_LIVE,/);
  assert.match(adapter, /deleteAccountLive: scenario !== "delete-off",/);
  const portal = readFileSync("src/components/account/account-portal.tsx", "utf8");
  assert.match(portal, /\{session && adapter\?\.deleteAccountLive \? \(\s+<AuthField[\s\S]{0,200}id="account-delete-row"/);
  // The short-screen rule that hides the lead applies only when the row is there.
  const css = readFileSync("src/styles/page-families/auth-surface.css", "utf8");
  assert.match(css, /\[data-auth-surface="account-status"\]:has\(\.auth-field\[data-danger\]\) \.auth-lead/);
  assert.doesNotMatch(css, /\[data-auth-surface="account-status"\] \.auth-lead/);
});

test("portal wiring: danger row last, three steps, danger dock only on the last one", () => {
  const portal = readFileSync("src/components/account/account-portal.tsx", "utf8");
  const row = portal.indexOf('id="account-delete-row"');
  assert.ok(row > portal.indexOf('id="account-current-email"'), "Delete account is the last row");
  assert.ok(row < portal.indexOf("<AuthNoticeSlot", row), "the row sits above the shared notice slot");
  assert.match(portal, /data-auth-surface="account-delete"/);
  assert.match(portal, /danger=\{step === "warning"\}/);
  assert.match(portal, /adapter\.beginAccountDelete\(password, captchaToken\)/);
  assert.match(portal, /adapter\.deleteAccount\(typed\)/);
  assert.match(portal, /adapter\.endAccountDelete\(\)/);
  assert.match(portal, /LOGIN_NOTICE_PARAM\}=deleted/);
  assert.match(portal, /signingOutRef\.current = true/);
});

test("live adapter: the delete call uses the step-1 session, never the page's own", () => {
  const adapter = readFileSync("src/lib/auth/browser-adapter.ts", "utf8");
  assert.match(adapter, /const checker = deleteChecker;\s+if \(!checker\) return "reauth";/);
  assert.match(adapter, /await checker\s+\.schema\("account_api"\)\s+\.rpc\("account_delete_self", \{ p_confirm: confirm \}\)/);
  assert.match(adapter, /persistSession: false/);
});

test("proposed SQL: owner-gated shape (one transaction, preflight, private inner function, narrow grants)", () => {
  assert.match(SQL, /PROPOSED, OWNER-GATED\. NOT APPLIED\./);
  assert.match(SQL, /^begin;$/m);
  assert.match(SQL, /^commit;$/m);
  assert.match(SQL, /set local lock_timeout/);
  assert.match(SQL, /UNKNOWN_ACCOUNT_COLUMNS/);
  assert.match(SQL, /create function account_private\.delete_account_v2\(p_user_id uuid, p_claims jsonb, p_confirm text\)/);
  assert.match(SQL, /create function account_api\.account_delete_self\(p_confirm text\)/);
  const definers = SQL.match(/security definer/g) ?? [];
  assert.ok(definers.length >= 2);
  const paths = SQL.match(/set search_path = ''/g) ?? [];
  assert.ok(paths.length >= 2, "every definer function pins an empty search_path");
  assert.match(SQL, /revoke all on function account_api\.account_delete_self\(text\) from public, anon/);
  assert.match(SQL, /grant execute on function account_api\.account_delete_self\(text\) to authenticated/);
  assert.match(SQL, /revoke all on function account_private\.delete_account_v2\(uuid, jsonb, text\) from public/);
  assert.doesNotMatch(SQL, /grant [^;]*to anon/i);
  assert.doesNotMatch(SQL, /grant [^;]*account_private\.delete_account_v2[^;]*to authenticated/i);
  assert.match(SQL, /pg_advisory_xact_lock/);
  assert.match(SQL, /interval '10 minutes'/, "fresh password window");
  assert.match(SQL, /auth\.sessions s where s\.id = session_text::uuid and s\.user_id = p_user_id/);
  assert.match(SQL, /delete from auth\.users/);
  assert.match(SQL, /fawxzzy-account-delete-v1:/, "audit row stores a hash, not the id");
  // Honest wording: the hash is plain (fixed public prefix), not salted.
  assert.doesNotMatch(SQL.replace(/not salted/gi, ""), /salted/i);
  assert.match(SQL, /PLAIN sha256/);
  assert.match(SQL, /It is not salted/);
  assert.ok(SQL.includes("ORDER: apply change username v1 (20261115190000_account_change_username_v1.sql) FIRST"));
  assert.match(SQL, /statement_timeout/);
  assert.match(SQL, /CASCADE_REACHES_UNLISTED_TABLE/);
  assert.match(SQL, /UNREVIEWED_TRIGGER/);
  assert.match(SQL, /p\.user_number = 0/, "the reserved member #0 profile is refused");
  assert.match(SQL, /notify pgrst, 'reload schema'/);
  assert.ok(!readFileSync("supabase/config.toml", "utf8").includes("proposed"), "proposed/ is not a migrations path");
});

test("rate limit: reauth refusals are not recorded or counted; the count runs after the proof", () => {
  const body = SQL.slice(SQL.indexOf(INNER));
  assert.ok(!body.includes("values (p_user_id, 'reauth')"), "a reauth refusal writes nothing");
  assert.ok(body.includes("values (p_user_id, 'confirm')"), "the same insert shape exists for counted refusals");
  assert.ok(SQL.includes("check (outcome in ('confirm', 'billing', 'support'))"));
  const reauth = body.indexOf("return 'reauth'");
  const rate = body.indexOf("return 'rate'");
  assert.ok(reauth > 0 && rate > reauth, "the rate check runs only after the password proof passed");
});

test("cross-account guard: another account's rows on this account's data refuse the call", () => {
  const body = SQL.slice(SQL.indexOf(INNER));
  const guard = body.indexOf("for ref in");
  assert.ok(guard > body.indexOf("return 'billing'") && guard < body.indexOf("-- Delete and unlink, in order."), "checked before any delete");
  assert.ok(body.includes("from pg_catalog.pg_constraint k"));
  assert.match(body, /s\.%I is distinct from \$1/);
});

test("cross-account guard: this account's rows are locked FOR UPDATE before the walk", () => {
  const body = SQL.slice(SQL.indexOf(INNER));
  const lock = body.indexOf("for update) locked");
  const guard = body.indexOf("for ref in");
  assert.ok(lock > body.indexOf("return 'billing'") && lock < guard, "the row locks come right before the walk");
  assert.ok(body.indexOf("foreach item in array steps loop") < lock);
  // FOR UPDATE needs UPDATE: the preflight checks it for every table the call deletes from.
  assert.match(SQL, /SELECT \.\.\. FOR UPDATE \(the row locks before the cross-account walk\) needs UPDATE/);
});

test("storage: a file owned through owner or owner_id refuses the call and the apply", () => {
  const body = SQL.slice(SQL.indexOf(INNER));
  const storage = body.indexOf("to_regclass('storage.objects')");
  assert.ok(storage > body.indexOf("return 'billing'") && storage < body.indexOf("for update) locked"));
  assert.match(body, /a\.attname in \('owner', 'owner_id'\)/);
  const preflight = SQL.slice(0, SQL.indexOf(INNER));
  assert.match(preflight, /a\.attname in \('owner', 'owner_id'\)/);
  assert.match(preflight, /DELETE_ACCOUNT_PREFLIGHT_CANNOT_READ_STORAGE_OBJECTS/);
  assert.match(preflight, /rolbypassrls/);
  // Review P3: FORCE row level security binds the owner too, so the readability check looks at it.
  assert.match(preflight, /relforcerowsecurity/);
});

/** The quoted items of a `name text[] := array[ ... ];` (SQL) or `name(...) as (values ...)` block. */
const quotedIn = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `block ${start} found`);
  const block = text.slice(from, text.indexOf(end, from));
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

test("v2: retained allow-list, trigger pins and key effects are the same in the apply and the preimage", () => {
  const retained = quotedIn(SQL, "  retained text[] := array[", "];");
  assert.ok(retained.length >= 30, `retained list (${retained.length})`);
  for (const item of retained) {
    assert.match(item, /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/, `retained items are schema.table.column: ${item}`);
    assert.ok(PREIMAGE.includes(`'${item}'`), `the preimage lists retained ${item}`);
  }
  // No live table is on the retained list: a retained column never belongs to a table the call deletes.
  for (const live of ["fitness.sets.", "fitness.profiles.", "mazer.mazer_profiles.", "auth.users."]) {
    assert.ok(!retained.some((item) => item.startsWith(live)), `${live} is not retained`);
  }
  const pins = (text) => [...new Set(text.match(/'[a-z_.]+\|[a-z_]+\|[a-z_.]+\|[0-9a-f]{32}\|\d+'/g) ?? [])].sort();
  assert.equal(pins(SQL).length, 4, "four reviewed triggers");
  assert.deepEqual(pins(PREIMAGE), pins(SQL));
  // Preflight and call-time copies of the pins are identical.
  for (const pin of pins(SQL)) assert.equal(SQL.split(pin).length - 1, 2, `${pin} pinned in the preflight and the function`);
  // Each pin's md5 is the md5 of the live body kept in the fixture (read-only from the live database).
  for (const pin of pins(SQL)) {
    const [, , fn, hash] = pin.slice(1, -1).split("|");
    const entry = LIVE_BODIES[`${fn}()`];
    assert.ok(entry, `fixture has ${fn}`);
    assert.equal(entry.md5, hash, `${fn} fixture md5`);
    assert.equal(createHash("md5").update(entry.src, "utf8").digest("hex"), hash, `${fn} fixture body hashes to the pin`);
  }
  // The two deliberate key effects (cascade and set null), checked in both files.
  for (const effect of ["account_private.username_signin_candidates.user_id:c", "platform.identity_map.auth_user_id:n"]) {
    assert.ok(SQL.includes(`'${effect}'`), `apply expects ${effect}`);
    assert.ok(PREIMAGE.includes(effect.replace(/:([cn])$/, "")), `preimage reports ${effect}`);
  }
  assert.match(SQL, /EXPECTED_FK_EFFECT_MISSING/);
  assert.match(SQL, /EXPECTED_FK_EFFECT_IS_REFERENCED/);
  assert.match(SQL, /ACCOUNT_DELETE_FK_EFFECT_INCOMPLETE/);
});

test("v2: locked vs changed rows, call-time trigger re-check, and timeouts (review P3)", () => {
  const body = SQL.slice(SQL.indexOf(INNER));
  assert.match(body, /ACCOUNT_DELETE_ROWCOUNT_EXCEEDS_LOCKED/);
  assert.match(body, /ACCOUNT_DELETE_UNREVIEWED_TRIGGER/);
  assert.ok(body.indexOf("ACCOUNT_DELETE_UNREVIEWED_TRIGGER") < body.indexOf("-- Delete and unlink, in order."), "trigger re-check runs before any delete");
  assert.match(SQL, /set lock_timeout = '3s'/, "inner function: lock_timeout");
  assert.match(SQL, /set statement_timeout = '30s'/, "API wrapper: statement_timeout (PostgREST applies it per call)");
  assert.match(SQL, /DELETE_ACCOUNT_POSTCHECK_TIMEOUTS_NOT_SET/);
  assert.match(SQL, /'v2'/, "audit rows say v2");
});

test("v1 is kept for the record and marked superseded", () => {
  for (const file of [`${V1_BASE}.sql`, `${V1_BASE}.rollback.sql`, `${V1_BASE}.preimage.sql`, "supabase/proposed/account_delete_self_v1.scratch-test.mjs"]) {
    assert.match(readFileSync(file, "utf8").slice(0, 600), /SUPERSEDED by .*20261116090000_account_delete_self_v2/, file);
  }
  assert.match(SQL, /SUPERSEDES/);
});

test("rollback drops the API, keeps the audit rows, and only takes USAGE back when unused", () => {
  assert.match(ROLLBACK, /drop function if exists account_api\.account_delete_self\(text\)/);
  assert.match(ROLLBACK, /drop function if exists account_private\.delete_account_v2\(uuid, jsonb, text\)/);
  assert.match(ROLLBACK, /drop table if exists account_private\.account_delete_attempts/);
  assert.doesNotMatch(ROLLBACK, /drop table if exists account_private\.account_deletions/);
  assert.match(ROLLBACK, /revoke usage on schema account_api from authenticated/);
  assert.match(ROLLBACK, /does NOT bring back any deleted account or row/);
});

test("preimage is one read-only select the query runner accepts", () => {
  // Same strip and keyword list as the read-only runner (skills/atlas-supabase/sb-query.ps1).
  const body = PREIMAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "").toLowerCase();
  assert.doesNotMatch(
    body,
    /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|vacuum|reindex|cluster|call|do|copy|lock|notify|listen|refresh|merge|comment|security|reset|set|begin|commit|rollback)\b/,
  );
  assert.equal((body.match(/;/g) ?? []).length, 1, "a single statement");
});
