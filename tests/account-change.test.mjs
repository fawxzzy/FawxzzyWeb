import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * Change username / change email (design point 12): the pure outcome mapping in
 * src/lib/auth/account-change.ts, the email-change redirect, and the shape of the owner-gated SQL in
 * supabase/proposed/ (never applied by CI; the pglite scratch test next to it runs it for real).
 */
const change = loadPortalModule("src/lib/auth/account-change.ts");
const { AUTH_MESSAGES } = loadPortalModule("src/lib/auth/copy-matrix.ts");
const { accountEmailChangeUrl, accountConfirmUrl } = loadPortalModule("src/config/account.ts");
const { parseConfirmPayload } = loadPortalModule("src/lib/auth/callback-contract.ts");

const SQL_PATH = "supabase/proposed/20261115190000_account_change_username_v1.sql";
const ROLLBACK_PATH = "supabase/proposed/20261115190000_account_change_username_v1.rollback.sql";

test("every id the change flow can return is a real matrix row", () => {
  const ids = new Set([
    change.reauthProblem("")?.id,
    change.usernameChangeProblem("x", "a")?.id,
    change.usernameChangeProblem("same", "same")?.id,
    change.emailChangeProblem("nope", "a@example.test")?.id,
    change.emailChangeProblem("A@example.test", "a@example.test")?.id,
    ...change.USERNAME_CHANGE_STATUSES.map(change.usernameChangeNotice),
    change.reauthFailure(new change.ReauthMismatchError()),
    change.reauthFailure({ status: 500 }),
    change.usernameChangeFailure({ code: "PGRST202" }),
    change.usernameChangeFailure({}),
    change.emailChangeFailure({ code: "email_exists" }),
    "change.emailsent",
    ...["emaildone", "emailhalf", "emaillink"].map((key) => change.accountNoticeFromQuery([key])),
  ]);
  for (const id of ids) assert.ok(id && Object.hasOwn(AUTH_MESSAGES, id), `missing matrix row ${id}`);
});

test("local checks: empty password, sign-up username rules, same value", () => {
  assert.deepEqual(change.reauthProblem(""), { id: "change.pwempty", fields: ["password"] });
  assert.equal(change.reauthProblem("anything"), null);

  assert.equal(change.usernameChangeProblem("a", "old")?.id, "signup.userinvalid", "under 2 characters");
  assert.equal(change.usernameChangeProblem("a".repeat(16), "old")?.id, "signup.userinvalid", "over 15 characters");
  assert.equal(change.usernameChangeProblem("bad name", "old")?.id, "signup.userinvalid");
  assert.equal(change.usernameChangeProblem("ab", "old"), null, "2 characters is fine");
  assert.equal(change.usernameChangeProblem("a".repeat(15), "old"), null, "15 characters is fine");
  assert.equal(change.usernameChangeProblem(" old ", "old")?.id, "change.usersame");
  assert.equal(change.usernameChangeProblem("Old", "old"), null, "a case-only change is a real change");

  assert.equal(change.emailChangeProblem("not-an-email", "a@example.test")?.id, "signup.emailinvalid");
  assert.equal(change.emailChangeProblem(" A@Example.test ", "a@example.test")?.id, "change.emailsame");
  assert.equal(change.emailChangeProblem("b@example.test", "a@example.test"), null);
  assert.equal(change.emailChangeProblem("b@example.test", null), null);
});

test("each problem outlines the box it is about", () => {
  assert.deepEqual(change.changeFieldsFor("change.pwwrong"), ["password"]);
  assert.deepEqual(change.changeFieldsFor("signup.taken"), ["username"]);
  assert.deepEqual(change.changeFieldsFor("change.emailexists"), ["email"]);
  assert.deepEqual(change.changeFieldsFor("change.rate"), []);
  assert.deepEqual(change.changeFieldsFor("change.unavailable"), []);
});

test("password step failures: wrong password and another account read the same", () => {
  assert.equal(change.reauthFailure(new change.ReauthMismatchError()), "change.pwwrong");
  assert.equal(change.reauthFailure({ code: "invalid_credentials", status: 400 }), "change.pwwrong");
  assert.equal(change.reauthFailure(new TypeError("Failed to fetch")), "signin.offline");
  assert.equal(change.reauthFailure({ code: "captcha_failed", status: 400 }), "captcha.fail");
  assert.equal(change.reauthFailure({ code: "over_request_rate_limit", status: 429 }), "change.rate");
  assert.equal(change.reauthFailure({ status: 503 }), "change.unavailable");
});

test("username save outcomes, and a missing backend says unavailable (never 'taken')", () => {
  assert.equal(change.usernameChangeNotice("changed"), "change.userdone");
  assert.equal(change.usernameChangeNotice("same"), "change.usersame");
  assert.equal(change.usernameChangeNotice("taken"), "signup.taken");
  assert.equal(change.usernameChangeNotice("invalid"), "signup.userinvalid");
  assert.equal(change.usernameChangeNotice("rate"), "change.rate");
  assert.equal(change.isUsernameChangeStatus("changed"), true);
  assert.equal(change.isUsernameChangeStatus("ok"), false);
  assert.equal(change.isUsernameChangeStatus(null), false);

  assert.equal(change.usernameChangeFailure({ message: "ACCOUNT_USERNAME_TAKEN", code: "23505" }), "signup.taken");
  for (const code of ["PGRST202", "PGRST106", "PGRST205", "42883", "42501", "3F000"]) {
    assert.equal(change.usernameChangeFailure({ code, status: 400 }), "change.unavailable", code);
  }
  assert.equal(change.usernameChangeFailure({ status: 404 }), "change.unavailable");
  assert.equal(change.usernameChangeFailure({ status: 0 }), "signin.offline", "supabase-js reports a failed fetch as status 0");
  assert.equal(change.usernameChangeFailure({ status: 429 }), "change.rate");
  assert.equal(change.usernameChangeFailure({ code: "XX000", status: 500 }), "change.savefail");
});

test("email request failures", () => {
  assert.equal(change.emailChangeFailure({ code: "email_exists", status: 422 }), "change.emailexists");
  assert.equal(change.emailChangeFailure({ code: "user_already_exists", status: 422 }), "change.emailexists");
  assert.equal(change.emailChangeFailure({ code: "email_address_invalid", status: 400 }), "signup.emailinvalid");
  assert.equal(change.emailChangeFailure({ code: "over_email_send_rate_limit", status: 429 }), "change.rate");
  assert.equal(change.emailChangeFailure({ status: 503 }), "change.unavailable");
  assert.equal(change.emailChangeFailure(new TypeError("Failed to fetch")), "signin.offline");
  assert.equal(change.emailChangeFailure({ code: "unexpected_failure", status: 400 }), "change.savefail");
});

test("account notices come only from the allowlist, one value only", () => {
  assert.equal(change.ACCOUNT_NOTICE_PARAM, "notice");
  assert.equal(change.accountNoticeFromQuery(["emaildone"]), "change.emaildone");
  assert.equal(change.accountNoticeFromQuery(["emailhalf"]), "change.emailhalf");
  assert.equal(change.accountNoticeFromQuery(["emaillink"]), "change.linkfail");
  assert.equal(change.accountNoticeFromQuery([]), null);
  assert.equal(change.accountNoticeFromQuery(["emaildone", "emaildone"]), null);
  assert.equal(change.accountNoticeFromQuery(["signup.taken"]), null);
  assert.equal(change.accountNoticeFromQuery(["toString"]), null, "no prototype keys");
  assert.equal(change.emailChangeLandingKey("session"), "emaildone");
  assert.equal(change.emailChangeLandingKey("no-session"), "emailhalf");
  assert.equal(change.emailChangeLandingKey("error"), "emaillink");
});

test("the remembered sign-in name follows a username change only when it was that name", () => {
  assert.equal(change.nextRememberedIdentity("OldName", "oldname", "NewName"), "NewName");
  assert.equal(change.nextRememberedIdentity("person@example.test", "oldname", "NewName"), null);
  assert.equal(change.nextRememberedIdentity(null, "oldname", "NewName"), null);
  assert.equal(change.nextRememberedIdentity("oldname", null, "NewName"), null);
});

test("the email-change redirect is the confirm route, themed, with no product return or state", () => {
  assert.equal(accountEmailChangeUrl("website"), "https://account.fawxzzy.com/auth/confirm");
  for (const id of ["fitness", "mazer"]) {
    const url = new URL(accountEmailChangeUrl(id));
    assert.equal(url.searchParams.get("app"), id);
    assert.equal(url.searchParams.has("returnTo"), false);
    assert.equal(url.searchParams.has("state"), false);
    assert.notEqual(url.href, accountConfirmUrl(id, "s"), "differs from the sign-up confirm URL");
    url.searchParams.set("token_hash", "abc");
    url.searchParams.set("type", "email_change");
    assert.equal(parseConfirmPayload(url)?.type, "email_change", "the confirm route accepts the link");
  }
});

test("portal: the confirm route sends email_change to /account before any product handoff", () => {
  const source = readFileSync("src/components/account/account-portal.tsx", "utf8");
  const branch = source.indexOf('payload.type === "email_change"');
  const fitness = source.indexOf("isFitnessReturnTarget(payload.returnTo)", branch - 2000);
  assert.ok(branch > 0, "email_change branch exists");
  assert.ok(fitness > branch, "email_change is handled before the Fitness return check");
  assert.match(source.slice(branch, branch + 1200), /emailChangeLandingKey/);
});

test("proposed SQL: owner-gated shape (preflight, rate limits, guard lock order, narrow grants, rollback)", () => {
  const sql = readFileSync(SQL_PATH, "utf8");
  const rollback = readFileSync(ROLLBACK_PATH, "utf8");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /set local lock_timeout/);
  assert.match(sql, /account_guard_username_claim/, "preflight requires the live username guard");
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('account_username:'/, "same claim lock as the guard");
  assert.match(sql, /'rate'/);
  assert.match(sql, /'taken'/);
  assert.match(sql, /when unique_violation/);
  assert.match(sql, /revoke all on function account_api\.account_change_username\(text\) from public, anon/);
  assert.match(sql, /grant execute on function account_api\.account_change_username\(text\) to authenticated/);
  assert.doesNotMatch(sql, /grant [^;]* to anon/i, "never callable signed out");
  assert.doesNotMatch(sql, /grant [^;]*account_private\.change_username_v1[^;]* to authenticated/i, "inner function stays private");
  assert.match(sql, /notify pgrst, 'reload schema'/);
  for (const object of [
    "drop function if exists account_api.account_change_username(text)",
    "drop function if exists account_private.change_username_v1(uuid, text)",
    "drop table if exists account_private.username_change_attempts",
    "revoke usage on schema account_api from authenticated",
  ]) {
    assert.ok(rollback.includes(object), `rollback: ${object}`);
  }
  assert.ok(!readFileSync("supabase/config.toml", "utf8").includes("proposed"), "proposed/ is not a migrations path");
});

test("every account_api function in a migration or proposal revokes execute from public", () => {
  // Once authenticated has USAGE on account_api (change-username v1), a function there without this
  // revoke would be callable by every signed-in person: PUBLIC holds EXECUTE by default.
  const dirs = ["supabase/migrations", "supabase/proposed"];
  let seen = 0;
  for (const dir of dirs) {
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql") && !file.endsWith(".rollback.sql"))) {
      const sql = readFileSync(`${dir}/${name}`, "utf8");
      for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+account_api\.(\w+)\s*\(/gi)) {
        seen += 1;
        const revoke = new RegExp(`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+account_api\\.${match[1]}\\s*\\([^)]*\\)\\s+from\\s+public`, "i");
        assert.match(sql, revoke, `${dir}/${name}: account_api.${match[1]} must revoke execute from public`);
      }
    }
  }
  assert.ok(seen >= 6, `scan found the account_api functions (${seen})`);
});
