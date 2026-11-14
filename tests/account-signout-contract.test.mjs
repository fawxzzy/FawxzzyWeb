import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * MAZER-ACCT-041: contract for GET https://account.fawxzzy.com/signout?returnTo=<url> and for the
 * password-reset session revocation. It runs the real route logic (the return allowlist) and reads
 * the sources that cannot be run without a browser, so a change that opens the redirect, widens
 * the allowlist, or reorders/drops the "end the other sessions" call fails here.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const signout = loadPortalModule("src/config/account-signout.ts");
const ACCOUNT = "https://account.fawxzzy.com";
const LOGIN = `${ACCOUNT}/login`;
const resolveTo = (raw, origin = ACCOUNT) => signout.resolveSignOutDestination(raw, origin);

test("the allowlist is exactly the Mazer product origin and the account host", () => {
  assert.deepEqual([...signout.SIGNOUT_ALLOWED_ORIGINS].sort(), [
    "https://account.fawxzzy.com",
    "https://mazer.fawxzzy.com",
  ]);
});

test("allowed targets are followed, keeping origin, path and query only", () => {
  assert.equal(resolveTo("https://mazer.fawxzzy.com"), "https://mazer.fawxzzy.com/");
  assert.equal(resolveTo("https://mazer.fawxzzy.com/"), "https://mazer.fawxzzy.com/");
  assert.equal(resolveTo("https://mazer.fawxzzy.com/play?x=1"), "https://mazer.fawxzzy.com/play?x=1");
  assert.equal(resolveTo("https://mazer.fawxzzy.com/#access_token=secret"), "https://mazer.fawxzzy.com/");
  assert.equal(resolveTo("https://account.fawxzzy.com/login?app=mazer"), `${ACCOUNT}/login?app=mazer`);
  assert.equal(resolveTo("/login?app=mazer"), `${ACCOUNT}/login?app=mazer`);
  assert.equal(resolveTo("/account"), `${ACCOUNT}/account`);
});

test("missing or empty returnTo goes to the account sign-in page", () => {
  for (const raw of [undefined, null, "", "   "]) assert.equal(resolveTo(raw), LOGIN);
});

const HOSTILE = [
  "//evil.example",
  "//evil.example/path",
  "///evil.example",
  "////evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "\\/evil.example",
  "https://evil.example",
  "https://evil.example/https://mazer.fawxzzy.com",
  "https://mazer.fawxzzy.com.evil.example",
  "https://mazer.fawxzzy.com.evil.example/",
  "https://evilmazer.fawxzzy.com",
  "https://mazer.fawxzzy.com@evil.example",
  "https://mazer.fawxzzy.com:evil@evil.example",
  "https://user:pass@mazer.fawxzzy.com/",
  "https://evil.example#@mazer.fawxzzy.com",
  "https://evil.example?https://mazer.fawxzzy.com",
  "https://mazer.fawxzzy.com:444/",
  "https://mazer.fawxzzy.com:80/",
  "http://mazer.fawxzzy.com/",
  "http://account.fawxzzy.com/",
  "ftp://mazer.fawxzzy.com/",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "  javascript:alert(1)",
  "java\nscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "blob:https://mazer.fawxzzy.com/abc",
  "file:///etc/passwd",
  "about:blank",
  "https%3A%2F%2Fevil.example",
  "%2F%2Fevil.example",
  "https:%2F%2Fevil.example",
  "https://evil.example%2F@mazer.fawxzzy.com",
  "https://mazer.fawxzzy.com%2F.evil.example",
  "https://mazer.fawxzzy.com%00.evil.example",
  "https://mazer%2Efawxzzy.com.evil.example",
  "https://mazer.fawxzzy.com\\@evil.example",
  "https://mazer.fawxzzy.com\t.evil.example",
  "https://xn--mazer-fawxzzy.com/",
  "https://fawxzzy-mazer.vercel.app/",
  "https://fitness.fawxzzy.com/",
  "https://fawxzzy.com/",
  "https://www.fawxzzy.com/",
  "https://fawxzzy.com.evil.example/",
  `${ACCOUNT}/signout`,
  `${ACCOUNT}/signout?returnTo=${encodeURIComponent("https://mazer.fawxzzy.com")}`,
  "/signout",
  "https://mazer.fawxzzy.com/" + "a".repeat(3000),
  "\u0000https://mazer.fawxzzy.com",
  "https://mazer.fawxzzy.com/\u0000",
];

test("hostile and lookalike targets all fall back to the account sign-in page", () => {
  for (const raw of HOSTILE) {
    const destination = resolveTo(raw);
    assert.equal(destination, LOGIN, `open redirect for ${JSON.stringify(raw).slice(0, 80)} -> ${destination}`);
  }
});

test("the destination is always on an allowlisted origin, whatever the input", () => {
  const allowed = new Set(signout.SIGNOUT_ALLOWED_ORIGINS);
  const alphabet = ["https://", "http://", "//", "/", "\\", "@", ":", ".", "%2F", "%40", "mazer", "fawxzzy", "com", "evil", "account", "#", "?", "javascript:", " ", "\t", "signout", "="];
  let seed = 0x2f6e2b1;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  for (let i = 0; i < 4000; i += 1) {
    let raw = "";
    for (let j = 0, n = 1 + (next() % 8); j < n; j += 1) raw += alphabet[next() % alphabet.length];
    const destination = new URL(resolveTo(raw));
    assert.ok(allowed.has(destination.origin), `escaped allowlist for ${JSON.stringify(raw)} -> ${destination.href}`);
    assert.equal(destination.hash, "");
    assert.equal(destination.username + destination.password, "");
  }
});

test("on a local test origin that origin counts as the account host, nothing else is added", () => {
  const local = "http://127.0.0.1:3210";
  assert.equal(resolveTo("/login?app=mazer", local), `${local}/login?app=mazer`);
  assert.equal(resolveTo("https://mazer.fawxzzy.com/", local), "https://mazer.fawxzzy.com/");
  assert.equal(resolveTo("https://evil.example/", local), `${local}/login`);
  assert.equal(resolveTo("http://127.0.0.1:3211/", local), `${local}/login`);
});

test("the sign-out page ends the session locally, clears the owner hint, and only then navigates", () => {
  const portal = read("src/components/account/account-portal.tsx");
  const start = portal.indexOf("function SignOutPanel");
  assert.ok(start > 0, "SignOutPanel missing");
  const panel = portal.slice(start, portal.indexOf("export function AccountPortal"));
  const order = [
    'adapter.signOut("this-session")',
    "writeOwnerHint(false)",
    "resolveSignOutDestination(",
    "window.location.replace(destination)",
  ].map((needle) => {
    const index = panel.indexOf(needle);
    assert.ok(index > 0, `${needle} missing from SignOutPanel`);
    return index;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "sign-out steps are out of order");
  assert.ok(!panel.includes('signOut("everywhere")'), "/signout must not end the person's other devices");
  assert.ok(!/location\.(?:assign|replace)\([^)]*returnTo/i.test(panel), "returnTo must go through the allowlist");
  const page = read("src/app/signout/page.tsx");
  assert.match(page, /AccountPortal mode="signout"/);
  assert.match(page, /"\/signout"/);
});

test("password reset ends the other sessions first, then the recovery session itself", () => {
  const portal = read("src/components/account/account-portal.tsx");
  const update = portal.indexOf("await adapter.updatePassword(password)");
  const others = portal.indexOf('await adapter.signOut("other-sessions")');
  const local = portal.indexOf('await adapter.signOut("this-session")', update);
  assert.ok(update > 0 && others > update && local > others, "expected updatePassword, other-sessions, this-session in that order");
});

test("the scope mapping matches the installed supabase-js sign-out API", () => {
  // browser-adapter.ts imports the SDK, which the sandbox loader cannot run: read the mapping.
  const source = read("src/lib/auth/browser-adapter.ts");
  const mapping = /PORTAL_SIGN_OUT_SCOPES = \{([^}]+)\}/.exec(source)?.[1] ?? "";
  assert.deepEqual(
    [...mapping.matchAll(/"?([a-z-]+)"?:\s*"([a-z]+)"/g)].map((m) => [m[1], m[2]]),
    [["everywhere", "global"], ["this-session", "local"], ["other-sessions", "others"]],
  );
  const types = read("node_modules/@supabase/auth-js/dist/module/lib/types.d.ts");
  assert.match(types, /scope\?: 'global' \| 'local' \| 'others'/);
  const client = read("node_modules/@supabase/auth-js/dist/module/GoTrueClient.js");
  // 'others' keeps the local session (no removal, no sign-out event): the caller must follow up.
  assert.match(client, /if \(scope !== 'others'\)/);
});

test("the partial-failure sentence exists and stays inside the copy cap", () => {
  const errors = loadPortalModule("src/lib/auth/errors.ts");
  const text = errors.safeAuthSuccess("reset-others");
  assert.match(text, /^Password updated\./);
  assert.ok(text.length <= 70);
  assert.notEqual(text, errors.safeAuthSuccess("reset-complete"));
});

test("the sign-out capability ping answers 204 for Mazer only, with no cookies or credentials", () => {
  const ping = loadPortalModule("api/account/signout-ping.ts");
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const response = ping[method](new Request("https://account.fawxzzy.com/signout/ping", { method }));
    assert.equal(response.status, 204, method);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://mazer.fawxzzy.com");
    assert.match(response.headers.get("access-control-allow-methods"), /GET/);
    assert.equal(response.headers.get("vary"), "Origin");
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
  }
  assert.equal(ping.POST().status, 405);
  const config = JSON.parse(read("vercel.json"));
  assert.deepEqual(config.rewrites, [{ source: "/signout/ping", destination: "/api/account/signout-ping" }]);
});

test("the Mazer authorization loading state has no visible text", () => {
  const source = read("src/components/account/mazer-oauth-authorization.tsx");
  assert.ok(!source.includes("One moment."), "the pending card is replaced by the bare dark page");
  assert.match(source, /className="oauth-bare"/);
  assert.match(read("src/styles/page-families/account-forms.css"), /\.oauth-bare \{[^}]*background: #02080f;/);
});
