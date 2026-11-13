import assert from "node:assert/strict";
import test from "node:test";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * MAZER-ACCT-039: password-reset contract that needs no inbox. It runs the portal's real route
 * logic (recovery payload parsing, return-target allowlist, recovery redirect URL, form guidance,
 * safe copy), so a change to any of them that would reopen an open redirect, leak token material
 * or break the one-sentence anti-enumeration answer fails here.
 */
const callback = loadPortalModule("src/lib/auth/callback-contract.ts");
const returns = loadPortalModule("src/config/account-return.ts");
const account = loadPortalModule("src/config/account.ts");
const errors = loadPortalModule("src/lib/auth/errors.ts");
const guidance = loadPortalModule("src/lib/auth/form-guidance.ts");
const policy = loadPortalModule("src/lib/auth/password-policy.ts");

const ORIGIN = "https://account.fawxzzy.com";
const recovery = (query, hash = "") => new URL(`${ORIGIN}/reset-password${query}${hash}`);

test("recovery landing accepts exactly one PKCE code and nothing else", () => {
  assert.deepEqual(callback.parseRecoveryPayload(recovery("?recovery=1&code=abc")), { code: "abc" });
  assert.deepEqual(callback.parseRecoveryPayload(recovery("?recovery=1")), { code: null });
  assert.deepEqual(callback.parseRecoveryPayload(recovery("?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize&code=abc")), {
    code: "abc",
  });
});

test("recovery landing rejects token material, hashes, repeated keys and a missing flag", () => {
  const rejected = [
    "?recovery=1&token_hash=abc&type=recovery",
    "?recovery=1&token=abc",
    "?recovery=1&access_token=a&refresh_token=b",
    "?recovery=1&state=abc&code=abc",
    "?recovery=1&code=a&code=b",
    "?recovery=1&recovery=1&code=a",
    "?recovery=0&code=a",
    "?code=a",
    "",
  ];
  for (const query of rejected) {
    assert.equal(callback.parseRecoveryPayload(recovery(query)), null, query);
  }
  assert.equal(
    callback.parseRecoveryPayload(recovery("?recovery=1&code=a", "#access_token=x&type=recovery")),
    null,
    "a hash fragment (implicit flow or provider error) never opens the password form",
  );
  assert.equal(
    callback.parseRecoveryPayload(
      recovery("?recovery=1", "#error=access_denied&error_code=otp_expired"),
    ),
    null,
  );
});

test("return targets are an allowlist: no open redirect through returnTo, next or redirect_to", () => {
  const fallback = account.accountContract.accountPath;
  const hostile = [
    "https://evil.example/",
    "http://account.fawxzzy.com/account",
    "//evil.example/",
    "/\\evil.example/",
    "\\\\evil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "https://account.fawxzzy.com.evil.example/",
    "https://fawxzzy.com@evil.example/",
    "https://user:pass@fawxzzy.com/",
    "https://fawxzzy.com/#frag",
    "https://fawxzzy.com/?next=https://evil.example/",
    "https://fawxzzy.com/?returnTo=//evil.example",
    "/reset-password?recovery=1&code=secret",
    "/projects?access_token=x",
    "/account#token",
    "/anything-else",
    "",
    null,
    undefined,
  ];
  for (const target of hostile) {
    assert.equal(returns.sanitizeReturnTarget(target), fallback, String(target));
  }
  // Allowed values stay allowed, so the Mazer hand-off keeps working.
  assert.equal(returns.sanitizeReturnTarget("/oauth/authorize"), "/oauth/authorize");
  assert.equal(returns.sanitizeReturnTarget("/reset-password?recovery=1"), "/reset-password?recovery=1");
  assert.equal(returns.sanitizeReturnTarget("https://fawxzzy.com/"), "https://fawxzzy.com/");
});

test("the reset page's own params never choose the destination: only the Mazer continuation survives", () => {
  const mazer = account.accountExperienceContexts.mazer;
  const website = account.accountExperienceContexts.website;
  assert.equal(returns.sanitizePostAuthReturnTarget("/oauth/authorize", mazer), "/oauth/authorize");
  assert.notEqual(returns.sanitizePostAuthReturnTarget("/oauth/authorize", website), "/oauth/authorize");
  for (const hostile of ["https://evil.example/", "//evil.example", "/projects"]) {
    const result = returns.sanitizePostAuthReturnTarget(hostile, mazer);
    assert.notEqual(result, hostile === "/projects" ? "/projects" : hostile);
    assert.ok(!result.includes("evil.example"));
  }
});

test("the emailed redirect lands on the account host and only carries an allowed continuation", () => {
  assert.equal(account.accountRecoveryUrl("website"), `${ORIGIN}/reset-password?recovery=1`);
  assert.equal(account.accountRecoveryUrl("mazer"), `${ORIGIN}/reset-password?recovery=1&app=mazer`);
  assert.equal(
    account.accountRecoveryUrl("mazer", "/oauth/authorize"),
    `${ORIGIN}/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize`,
  );
  // A hostile or non-Mazer return target is dropped, never echoed into the email link.
  for (const [context, target] of [
    ["mazer", "https://evil.example/"],
    ["fitness", "/oauth/authorize"],
    ["website", "/oauth/authorize"],
  ]) {
    const url = new URL(account.accountRecoveryUrl(context, target));
    assert.equal(url.origin, ORIGIN);
    assert.equal(url.searchParams.has("returnTo"), false, `${context} ${target}`);
  }
});

test("anti-enumeration: a request answers with one fixed sentence whatever happened", () => {
  assert.equal(errors.safeAuthSuccess("reset-request"), "Check your email.");
  assert.equal(errors.safeAuthError("reset-request"), errors.safeAuthSuccess("reset-request"));
  assert.ok(!/exist|found|unknown|registered|no account|not an? /i.test(errors.safeAuthError("reset-request")));
});

test("request form guidance names what is needed and never reads like an account lookup", () => {
  assert.deepEqual(guidance.guidanceForResetRequest("").map((p) => p.message), ["Enter your email address."]);
  for (const bad of ["abc", "a@b", "a b@example.com", "@example.com", "a@@example.com"]) {
    assert.deepEqual(
      guidance.guidanceForResetRequest(bad).map((p) => p.message),
      ["Enter a full email, like name@example.com."],
      bad,
    );
  }
  assert.deepEqual(guidance.guidanceForResetRequest("name@example.com"), []);
});

test("new-password rules: minimum length, confirmation required, confirmation must match", () => {
  const messages = (password, confirmation) =>
    guidance.guidanceForNewPassword(password, confirmation).map((p) => `${p.field}:${p.message}`);
  assert.equal(policy.PASSWORD_MINIMUM, 10);
  assert.deepEqual(messages("", ""), [
    "password:Enter a new password, at least 10 characters.",
    "confirmation:Confirm your new password.",
  ]);
  assert.deepEqual(messages("short", "short"), ["password:Use at least 10 characters."]);
  assert.deepEqual(messages("long-enough-1", ""), ["confirmation:Confirm your new password."]);
  assert.deepEqual(messages("long-enough-1", "long-enough-2"), ["confirmation:Passwords do not match."]);
  assert.deepEqual(messages("exactly-10!", "exactly-10!"), []);
  assert.deepEqual(messages("0123456789", "0123456789"), []);
});

test("a dead link sends the person to a fresh request, not to a dead end", () => {
  assert.equal(errors.safeAuthError("reset-complete"), "Password not saved. Request a new link.");
  assert.equal(errors.safeAuthError("confirm"), "Link failed. Request a new link.");
});
