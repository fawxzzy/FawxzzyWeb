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
const recoveryLink = loadPortalModule("src/lib/auth/recovery-link.ts");

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

test("anti-enumeration: a signed-out request answers with one fixed sentence; a refused send never reads as sent", () => {
  // Signed out, the success line is the same whether or not an account uses the address.
  assert.equal(matrix.authNotice("reset.sentany").text, "If that account exists, we sent a reset link to its email.");
  // 2026-11-26: the provider's per-account refusal (429 / over_email_send_rate_limit) says that no email
  // went out, signed in or out. A signed-out 429 used to read exactly like a sent link (2026-11-15), which
  // hid nothing (the browser calls the provider itself, the 429 is in its network panel) and told a real
  // person a link was coming when none was (Mazer player report 2026-11-24).
  const rateLimits = [{ status: 429 }, { code: "over_email_send_rate_limit" }];
  for (const error of rateLimits) {
    assert.equal(outcomes.resetRequestFailure(error), "reset.wait", JSON.stringify(error));
  }
  assert.equal(matrix.authNotice("reset.wait").text, "No new email sent. Wait a minute, then try again.");
  assert.equal(matrix.authNotice("reset.wait").tone, "error");
  // Every other failure line is about sending, not the account; none of them claims a sent link.
  const failures = [
    ...rateLimits.map((error) => outcomes.resetRequestFailure(error)),
    ...[{ status: 500 }, { code: "unexpected_failure" }, {}].map((error) => outcomes.resetRequestFailure(error)),
  ];
  assert.deepEqual([...new Set(failures)].sort(), ["reset.sendfail", "reset.wait"]);
  for (const id of failures) {
    assert.ok(!/exist|found|unknown|registered|no account/i.test(matrix.authNotice(id).text), id);
    assert.ok(!/\bwe sent\b|link sent/i.test(matrix.authNotice(id).text), id);
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

// ------------------------------------------- recovery link that works in any browser (2026-11-26)

const CONFIRM = `${ORIGIN}/auth/confirm`;
const landing = (contextId, href, failure) =>
  recoveryLink.recoveryLandingPath(contextId, new URL(href).searchParams.get("returnTo"), failure);

test("recovery link: the confirm route takes token_hash + type=recovery and nothing weaker", () => {
  const payload = callback.parseConfirmPayload(new URL(`${CONFIRM}?app=mazer&returnTo=%2Foauth%2Fauthorize&token_hash=pkce_abc&type=recovery`));
  assert.equal(payload.type, "recovery");
  assert.equal(payload.tokenHash, "pkce_abc");
  for (const query of [
    "?type=recovery",
    "?token_hash=&type=recovery",
    "?token_hash=abc",
    "?token_hash=abc&type=Recovery",
    "?token_hash=abc&type=password",
    "?token=abc&type=recovery",
    "?code=abc&type=recovery",
  ]) {
    assert.equal(callback.parseConfirmPayload(new URL(`${CONFIRM}${query}`)), null, query);
  }
});

test("recovery link: an accepted token lands on the new-password form, keeping only app and the Mazer continuation", () => {
  assert.equal(landing("website", `${CONFIRM}?token_hash=h&type=recovery`), "/reset-password?recovery=1");
  assert.equal(landing("fitness", `${CONFIRM}?app=fitness&token_hash=h&type=recovery`), "/reset-password?recovery=1&app=fitness");
  assert.equal(landing("mazer", `${CONFIRM}?app=mazer&token_hash=h&type=recovery`), "/reset-password?recovery=1&app=mazer");
  assert.equal(
    landing("mazer", `${CONFIRM}?app=mazer&returnTo=%2Foauth%2Fauthorize&token_hash=h&type=recovery`),
    "/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize",
  );
  // The landing is a reset URL the recovery parser accepts (no code: it reads the session verifyOtp stored).
  for (const path of ["/reset-password?recovery=1", "/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize"]) {
    assert.deepEqual(callback.parseRecoveryPayload(new URL(path, ORIGIN)), { code: null }, path);
  }
});

test("recovery link: hostile returnTo, next and redirect_to never move the browser off the reset page", () => {
  const hostile = [
    "https://evil.example/",
    "//evil.example/oauth/authorize",
    "/\\evil.example",
    "javascript:alert(1)",
    "https://account.fawxzzy.com/oauth/authorize",
    "/oauth/authorize?next=https://evil.example",
    "/oauth/authorize#x",
    "/account",
    "%2Foauth%2Fauthorize",
  ];
  for (const contextId of ["website", "fitness", "mazer"]) {
    for (const failure of [undefined, "expired", "invalid"]) {
      for (const value of hostile) {
        const v = encodeURIComponent(value);
        const href = `${CONFIRM}?app=${contextId}&token_hash=h&type=recovery&returnTo=${v}&next=${v}&redirect_to=${v}`;
        const path = landing(contextId, href, failure);
        const url = new URL(path, ORIGIN);
        assert.equal(url.origin, ORIGIN, path);
        assert.equal(url.pathname, "/reset-password", path);
        assert.ok(path.startsWith("/reset-password?"), path);
        for (const key of url.searchParams.keys()) {
          assert.ok(["app", "link", "recovery"].includes(key), `${contextId} ${value}: ${key}`);
        }
      }
    }
  }
  // The Mazer continuation survives only as the exact authorization path, and only for Mazer.
  assert.equal(landing("fitness", `${CONFIRM}?returnTo=%2Foauth%2Fauthorize`), "/reset-password?recovery=1&app=fitness");
  assert.equal(landing("website", `${CONFIRM}?returnTo=%2Foauth%2Fauthorize`), "/reset-password?recovery=1");
});

test("recovery link: a used, wrong or expired token reads as expired; anything else as not valid", () => {
  // The provider's answer for a used, wrong or expired token_hash (verifyTokenHash: 403 otp_expired).
  assert.equal(
    recoveryLink.recoveryLinkFailure({ code: "otp_expired", status: 403, message: "Email link is invalid or has expired" }),
    "expired",
  );
  assert.equal(recoveryLink.recoveryLinkFailure({ status: 403 }), "expired");
  for (const error of [{ status: 400, code: "validation_failed" }, { status: 500 }, new TypeError("Failed to fetch"), null, "x", {}]) {
    assert.equal(recoveryLink.recoveryLinkFailure(error), "invalid", String(error?.code ?? error));
  }
  assert.equal(
    landing("mazer", `${CONFIRM}?app=mazer&returnTo=%2Foauth%2Fauthorize`, "expired"),
    "/reset-password?link=expired&app=mazer&returnTo=%2Foauth%2Fauthorize",
  );
  assert.equal(landing("website", CONFIRM, "invalid"), "/reset-password?link=invalid");
  // The reset page shows only allowlisted reasons.
  assert.equal(recoveryLink.resetLinkNotice("expired"), "reset.expired");
  assert.equal(recoveryLink.resetLinkNotice("invalid"), "reset.invalid");
  for (const value of [null, undefined, "", "EXPIRED", "reset.expired", "signin.wrong", "__proto__", "constructor"]) {
    assert.equal(recoveryLink.resetLinkNotice(value), null, String(value));
  }
});

test("recovery link: the route logs nothing and never puts the token in a destination", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/lib/auth/recovery-link.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\./);
  const portal = readFileSync(new URL("../src/components/account/account-portal.tsx", import.meta.url), "utf8");
  const start = portal.indexOf('if (payload.type === "recovery")');
  const end = portal.indexOf('if (payload.type === "email_change")');
  assert.ok(start > 0 && end > start, "recovery branch runs before the email-change branch");
  const branch = portal.slice(start, end);
  assert.ok(branch.includes(".confirm(payload.tokenHash, payload.type)"), "verifyOtp through the adapter");
  assert.ok(branch.includes("recoveryLandingPath("), "destination built from constants");
  assert.doesNotMatch(branch, /console\./);
  assert.doesNotMatch(branch, /\$\{payload\.tokenHash\}|tokenHash\s*\+/, "token never concatenated into a URL");
});

test("reset resend wait: one minute per browser, timestamp only, never locks on a bad value", () => {
  const store = () => {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
  };
  assert.equal(recoveryLink.RESET_RESEND_SECONDS, 60);
  const s = store();
  assert.equal(recoveryLink.resetWaitRemaining(s, 1_000_000), 0);
  recoveryLink.recordResetSent(s, 1_000_000);
  assert.deepEqual([...s.map.entries()], [[recoveryLink.RESET_SENT_AT_KEY, "1000000"]], "only a timestamp is stored");
  assert.equal(recoveryLink.resetWaitRemaining(s, 1_000_000), 60);
  assert.equal(recoveryLink.resetWaitRemaining(s, 1_021_000), 39);
  assert.equal(recoveryLink.resetWaitRemaining(s, 1_059_001), 1);
  assert.equal(recoveryLink.resetWaitRemaining(s, 1_060_000), 0);
  assert.equal(recoveryLink.resetWaitRemaining(s, 9_000_000), 0);
  // Clock moved back or an edited value: never a lock.
  assert.equal(recoveryLink.resetWaitRemaining(s, 999_000), 0);
  for (const bad of ["", "abc", "-5", "1e9", "12.5", "9".repeat(20)]) {
    s.map.set(recoveryLink.RESET_SENT_AT_KEY, bad);
    assert.equal(recoveryLink.resetWaitRemaining(s, 1_000_000), 0, bad);
  }
  // Blocked storage: no throw, no lock.
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => recoveryLink.recordResetSent(throwing, 1));
  assert.equal(recoveryLink.resetWaitRemaining(throwing, 1), 0);
  assert.equal(recoveryLink.resetWaitRemaining(null, 1), 0);
});
