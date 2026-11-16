import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * Delete account: the pure outcome mapping in src/lib/auth/account-delete.ts, the copy it points at,
 * the portal wiring, and the shape of the owner-gated SQL in supabase/proposed/ (never applied by CI;
 * supabase/proposed/account_delete_self_v1.scratch-test.mjs runs it for real in pglite).
 */
const del = loadPortalModule("src/lib/auth/account-delete.ts");
const change = loadPortalModule("src/lib/auth/account-change.ts");
const { AUTH_MESSAGES, AUTH_COPY, authNotice } = loadPortalModule("src/lib/auth/copy-matrix.ts");
const { loginNoticeFromQuery } = loadPortalModule("src/lib/auth/auth-outcomes.ts");

const BASE = "supabase/proposed/20261115200000_account_delete_self_v1";
const SQL = readFileSync(`${BASE}.sql`, "utf8");
const ROLLBACK = readFileSync(`${BASE}.rollback.sql`, "utf8");
const PREIMAGE = readFileSync(`${BASE}.preimage.sql`, "utf8");

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

test("the server answers are exactly the six the SQL returns", () => {
  assert.deepEqual([...del.ACCOUNT_DELETE_STATUSES].sort(), ["billing", "confirm", "deleted", "gone", "rate", "reauth"]);
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
  assert.equal(del.deleteReauthFailure({ code: "invalid_credentials", status: 400 }), "change.pwwrong");
  assert.equal(del.deleteReauthFailure({ code: "captcha_failed", status: 400 }), "captcha.fail");
  // The failure line must not promise anything about the data: the call may have committed.
  assert.doesNotMatch(authNotice("delete.fail").text, /nothing was deleted/i);
});

test("the last step says in plain words what is deleted and that it can not be undone", () => {
  const list = AUTH_COPY.deleteList.join(" ");
  for (const word of [/profile/i, /username/i, /Fitness/, /Mazer/, /scores/i, /can not be undone/i]) {
    assert.match(list, word);
  }
  assert.equal(authNotice("signin.deleted").tone, "success");
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
  assert.match(SQL, /UNLISTED_ACCOUNT_COLUMNS/);
  assert.match(SQL, /create function account_private\.delete_account_v1\(p_user_id uuid, p_claims jsonb, p_confirm text\)/);
  assert.match(SQL, /create function account_api\.account_delete_self\(p_confirm text\)/);
  const definers = SQL.match(/security definer/g) ?? [];
  assert.ok(definers.length >= 2);
  const paths = SQL.match(/set search_path = ''/g) ?? [];
  assert.ok(paths.length >= 2, "every definer function pins an empty search_path");
  assert.match(SQL, /revoke all on function account_api\.account_delete_self\(text\) from public, anon/);
  assert.match(SQL, /grant execute on function account_api\.account_delete_self\(text\) to authenticated/);
  assert.match(SQL, /revoke all on function account_private\.delete_account_v1\(uuid, jsonb, text\) from public/);
  assert.doesNotMatch(SQL, /grant [^;]*to anon/i);
  assert.doesNotMatch(SQL, /grant [^;]*account_private\.delete_account_v1[^;]*to authenticated/i);
  assert.match(SQL, /pg_advisory_xact_lock/);
  assert.match(SQL, /interval '10 minutes'/, "fresh password window");
  assert.match(SQL, /auth\.sessions s where s\.id = session_text::uuid and s\.user_id = p_user_id/);
  assert.match(SQL, /delete from auth\.users/);
  assert.match(SQL, /fawxzzy-account-delete-v1:/, "audit row stores a salted hash, not the id");
  assert.match(SQL, /notify pgrst, 'reload schema'/);
  assert.ok(!readFileSync("supabase/config.toml", "utf8").includes("proposed"), "proposed/ is not a migrations path");
});

test("rollback drops the API, keeps the audit rows, and only takes USAGE back when unused", () => {
  assert.match(ROLLBACK, /drop function if exists account_api\.account_delete_self\(text\)/);
  assert.match(ROLLBACK, /drop function if exists account_private\.delete_account_v1\(uuid, jsonb, text\)/);
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
