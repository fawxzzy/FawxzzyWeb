import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";
import { SUPABASE_REDIRECT_ALLOWLIST } from "./fixtures/supabase-redirect-allowlist.mjs";

/**
 * Every redirect URL the portal hands to Supabase must be a member of the pinned allow list
 * (tests/fixtures/supabase-redirect-allowlist.mjs, mirrored from the live dashboard 2026-11-15).
 */
const { accountEmailChangeUrl, accountConfirmUrl, accountRecoveryUrl } = loadPortalModule("src/config/account.ts");
const allowed = new Set(SUPABASE_REDIRECT_ALLOWLIST);
const CONTEXTS = ["website", "fitness", "mazer"];

test("email-change redirect is exactly an allow-listed URL for every skin", () => {
  for (const id of CONTEXTS) assert.ok(allowed.has(accountEmailChangeUrl(id)), `${id}: ${accountEmailChangeUrl(id)}`);
});

test("password-recovery redirect is exactly an allow-listed URL for every skin", () => {
  assert.ok(allowed.has(accountRecoveryUrl("website")) || accountRecoveryUrl("website") === "https://account.fawxzzy.com/reset-password");
  for (const id of ["fitness", "mazer"]) assert.ok(allowed.has(accountRecoveryUrl(id)), accountRecoveryUrl(id));
});

test("sign-up redirect without a browser-bound state is allow-listed for every skin", () => {
  for (const id of CONTEXTS) assert.ok(allowed.has(accountConfirmUrl(id)), accountConfirmUrl(id));
});

// Known gaps, pinned so they cannot grow silently. Each is a redirect the portal really sends that
// is NOT on the live list, so Supabase falls back to the Site URL for it. Fixing them needs either a
// provider allow-list change (owner) or a code redesign; remove an entry here when it is fixed.
test("known off-list redirects are exactly the pinned set", () => {
  const offList = [
    accountConfirmUrl("fitness", "state"),
    accountConfirmUrl("mazer", undefined, "/oauth/authorize"),
    accountRecoveryUrl("mazer", "/oauth/authorize"),
  ].filter((url) => !allowed.has(url));
  assert.deepEqual(offList, [
    "https://account.fawxzzy.com/auth/confirm?app=fitness&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F&state=state",
    "https://account.fawxzzy.com/auth/confirm?app=mazer&returnTo=%2Foauth%2Fauthorize",
    "https://account.fawxzzy.com/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize",
  ]);
});

test("the browser adapter passes only these builders to supabase (no inline redirect URLs)", () => {
  const src = readFileSync("src/lib/auth/browser-adapter.ts", "utf8");
  const uses = [...src.matchAll(/(emailRedirectTo|redirectTo)\s*:\s*([^,}\n]+)/g)].map((m) => m[2].trim());
  assert.equal(uses.length, 3, uses.join(" | "));
  for (const expr of uses) assert.match(expr, /^account(Confirm|Recovery|EmailChange)Url\(/, expr);
});
