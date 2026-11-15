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
const matrix = loadPortalModule("src/lib/auth/copy-matrix.ts");
const outcomes = loadPortalModule("src/lib/auth/auth-outcomes.ts");
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

test("anti-enumeration: a signed-out request answers with one fixed sentence, failures name only the sending", () => {
  // Signed out, the success line is the same whether or not an account uses the address.
  assert.equal(matrix.authNotice("reset.sentany").text, "If that account exists, we sent a reset link to its email.");
  // The provider rate-limits per address, so a 429 only ever happens for an address with an account.
  // Signed out, it must read exactly like a sent link (changed deliberately 2026-11-15: it used to
  // show "Too many reset requests", which told a stranger the account exists).
  const rateLimits = [{ status: 429 }, { code: "over_email_send_rate_limit" }];
  for (const error of rateLimits) {
    assert.equal(outcomes.resetRequestFailure(error, false), "reset.sentany", JSON.stringify(error));
    assert.equal(outcomes.resetRequestFailure(error, true), "reset.rate", JSON.stringify(error));
  }
  // Every other failure line is about sending, not the account.
  const failures = [
    ...rateLimits.map((error) => outcomes.resetRequestFailure(error, true)),
    ...[{ status: 500 }, { code: "unexpected_failure" }, {}].flatMap((error) => [
      outcomes.resetRequestFailure(error, false),
      outcomes.resetRequestFailure(error, true),
    ]),
  ];
  assert.deepEqual([...new Set(failures)].sort(), ["reset.rate", "reset.sendfail"]);
  for (const id of failures) {
    assert.ok(!/exist|found|unknown|registered|no account/i.test(matrix.authNotice(id).text), id);
  }
  // Signed in, the masked address shown is the one already on the screen.
  assert.equal(matrix.authNotice("reset.sent", "zac@icloud.com").text, "Reset link sent to z•••@icloud.com. It expires in 1 hour.");
});

test("confirm/callback destinations pass the allowlist again right before the browser moves", () => {
  const fitness = account.accountContract.productOrigins.fitness;
  // Allowed: sanitized return targets and the exact Fitness landing a completed handoff returns.
  for (const allowed of ["/account", "/oauth/authorize", "/projects", `${fitness}/`, `${fitness}/entry`, `${fitness}/today`]) {
    assert.equal(callback.sanitizeLinkDestination(allowed), allowed, allowed);
  }
  assert.equal(callback.sanitizeLinkDestination("https://mazer.fawxzzy.com/"), "https://mazer.fawxzzy.com/");
  // Anything else falls back to the account page.
  for (const hostile of [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    `${fitness}/entry?next=https://evil.example/`,
    `${fitness}/entry#token`,
    `${fitness.replace("https://", "https://user:pass@")}/entry`,
    `${fitness.replace("https://", "http://")}/entry`,
    "/login?notice=callback",
    "",
    null,
    undefined,
  ]) {
    assert.equal(callback.sanitizeLinkDestination(hostile), "/account", String(hostile));
  }
});

test("request form guidance names what is needed and never reads like an account lookup", () => {
  for (const bad of ["", "abc", "a@b", "a b@example.com", "@example.com", "a@@example.com"]) {
    assert.deepEqual(outcomes.resetRequestProblem(bad), { id: "signup.emailinvalid", fields: ["email"] }, bad);
  }
  assert.equal(matrix.authNotice("signup.emailinvalid").text, "Enter a valid email address.");
  assert.equal(outcomes.resetRequestProblem("name@example.com"), null);
});

test("new-password rules: minimum length first, then the confirmation must match", () => {
  const problem = (password, confirmation) => outcomes.newPasswordProblem(password, confirmation)?.id ?? null;
  assert.equal(policy.PASSWORD_MINIMUM, 10);
  assert.equal(problem("", ""), "signup.pwshort");
  assert.equal(problem("short", "short"), "signup.pwshort");
  assert.equal(problem("long-enough-1", ""), "reset.mismatch");
  assert.equal(problem("long-enough-1", "long-enough-2"), "reset.mismatch");
  assert.deepEqual(outcomes.newPasswordProblem("long-enough-1", "x").fields, ["confirmation"]);
  assert.equal(problem("exactly-10!", "exactly-10!"), null);
  assert.equal(problem("0123456789", "0123456789"), null);
});

test("a dead link sends the person to a fresh request, not to a dead end", () => {
  assert.equal(matrix.authNotice("reset.expired").text, "That reset link expired. Send a new one.");
  assert.equal(matrix.authNotice("reset.invalid").text, "That reset link is not valid. Send a new one.");
  assert.equal(outcomes.passwordSaveFailure({ code: "same_password" }), "reset.same");
  assert.equal(outcomes.passwordSaveFailure({ status: 500 }), "reset.savefail");
});
