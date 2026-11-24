import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * Mazer name on the account page (MAZER-ACCT-047): the pure rules and failure mapping in
 * src/lib/auth/mazer-name.ts, and the live adapter's use of the existing auth-bound rename function
 * (no new database object: the account site calls the same mazer.mazer_set_username the old in-game
 * editor called).
 */
const mazer = loadPortalModule("src/lib/auth/mazer-name.ts");
const { AUTH_MESSAGES } = loadPortalModule("src/lib/auth/copy-matrix.ts");

test("every id the Mazer name flow can return is a real matrix row", () => {
  const ids = new Set([
    mazer.mazerNameProblem("x", "Mazer-123456")?.id,
    mazer.mazerNameProblem("same", "same")?.id,
    ...[
      { code: "23505" },
      { code: "22023" },
      { message: "MAZER_USERNAME_INVALID" },
      { code: "28000" },
      { status: 401 },
      { code: "42501" },
      { code: "PGRST202" },
      new TypeError("fetch failed"),
      { status: 429 },
      {},
    ].map(mazer.mazerNameFailure),
    "mazer.namedone",
  ]);
  for (const id of ids) assert.ok(id && Object.hasOwn(AUTH_MESSAGES, id), `missing matrix row ${id}`);
});

test("local checks: 2 to 15 letters, numbers, dot, underscore or hyphen; same name", () => {
  assert.equal(mazer.mazerNameProblem("a", "old")?.id, "signup.userinvalid", "under 2 characters");
  assert.equal(mazer.mazerNameProblem("a".repeat(16), "old")?.id, "signup.userinvalid", "over 15 characters");
  assert.equal(mazer.mazerNameProblem("bad name", "old")?.id, "signup.userinvalid", "no spaces");
  assert.equal(mazer.mazerNameProblem("emoji\u{1F600}", "old")?.id, "signup.userinvalid");
  assert.equal(mazer.mazerNameProblem("ab", "old"), null, "2 characters is fine");
  assert.equal(mazer.mazerNameProblem("a.b_c-9".padEnd(15, "x"), "old"), null, "15 characters is fine");
  assert.equal(mazer.mazerNameProblem(" Mazer-123456 ", "Mazer-123456")?.id, "mazer.namesame");
  assert.equal(mazer.mazerNameProblem("mazer-123456", "Mazer-123456"), null, "a case-only change is a real change");
  assert.equal(mazer.mazerNameProblem("first", null), null, "no profile yet: any valid name");
});

test("database answers map to plain lines (taken, invalid, session, unavailable, offline, rate)", () => {
  assert.equal(mazer.mazerNameFailure({ code: "23505", status: 409 }), "signup.taken");
  assert.equal(mazer.mazerNameFailure({ code: "22023", message: "MAZER_USERNAME_INVALID" }), "signup.userinvalid");
  assert.equal(mazer.mazerNameFailure({ code: "28000" }), "signin.session", "account mismatch");
  assert.equal(mazer.mazerNameFailure({ code: "PGRST301", status: 401 }), "signin.session");
  assert.equal(mazer.mazerNameFailure({ code: "42501", status: 403 }), "change.unavailable");
  assert.equal(mazer.mazerNameFailure({ code: "PGRST106", status: 406 }), "change.unavailable", "schema not exposed");
  assert.equal(mazer.mazerNameFailure({ code: "PGRST202", status: 404 }), "change.unavailable");
  assert.equal(mazer.mazerNameFailure(new TypeError("fetch failed")), "signin.offline");
  assert.equal(mazer.mazerNameFailure({ status: 0 }), "signin.offline");
  assert.equal(mazer.mazerNameFailure({ status: 429 }), "change.rate");
  assert.equal(mazer.mazerNameFailure({ code: "XX000", status: 500 }), "change.savefail");
  assert.equal(mazer.mazerNameFailure(null), "change.savefail");
});

test("a missing profile is recognised by code or marker", () => {
  assert.equal(mazer.isMazerProfileMissing({ code: "P0002" }), true);
  assert.equal(mazer.isMazerProfileMissing({ message: "MAZER_PROFILE_MISSING" }), true);
  assert.equal(mazer.isMazerProfileMissing({ code: "23505" }), false);
  assert.equal(mazer.isMazerProfileMissing(null), false);
});

test("the row shows for a Mazer profile or a visit from Mazer, never for a Fitness-only account", () => {
  assert.equal(mazer.showMazerNameRow("website", "Mazer-123456"), true);
  assert.equal(mazer.showMazerNameRow("fitness", "zac"), true);
  assert.equal(mazer.showMazerNameRow("mazer", null), true);
  assert.equal(mazer.showMazerNameRow("fitness", null), false);
  assert.equal(mazer.showMazerNameRow("website", null), false);
});

test("only Mazer collapses to one name, labelled Username; every other context keeps both rows", () => {
  assert.equal(mazer.mazerNameIsSoleUsername("mazer", true), true);
  assert.equal(mazer.mazerNameIsSoleUsername("mazer", false), false);
  assert.equal(mazer.mazerNameIsSoleUsername("website", true), false);
  assert.equal(mazer.mazerNameIsSoleUsername("fitness", true), false);
});

test("the live adapter uses the existing auth-bound Mazer functions, bound to the signed-in id", () => {
  assert.equal(mazer.MAZER_SCHEMA, "mazer");
  assert.equal(mazer.MAZER_SET_USERNAME_RPC, "mazer_set_username");
  assert.equal(mazer.MAZER_ENSURE_PROFILE_RPC, "mazer_ensure_profile");
  const source = readFileSync(new URL("../src/lib/auth/browser-adapter.ts", import.meta.url), "utf8");
  const live = source.slice(source.indexOf("async saveMazerName(name) {"), source.indexOf("async requestEmailChange("));
  assert.match(live, /mazer\.rpc\(MAZER_SET_USERNAME_RPC, \{ p_expected_user_id: userId, p_username: name \}\)/);
  assert.match(live, /mazer\.rpc\(MAZER_ENSURE_PROFILE_RPC, \{/);
  // One ensure, one retry: the rename call appears exactly twice (first try + retry), never in a loop.
  assert.equal((live.match(/await rename\(\)/g) ?? []).length, 2);
  assert.doesNotMatch(live, /\bwhile\b|\bfor\s*\(/);
  // No direct table write: the profile row is read only.
  assert.doesNotMatch(source, /from\(MAZER_PROFILE_TABLE\)[\s\S]{0,80}\.(update|insert|upsert|delete)\(/);
});

test("a rename sits behind the same password check as Change username, before any save", () => {
  const portal = readFileSync(new URL("../src/components/account/account-portal.tsx", import.meta.url), "utf8");
  const panel = portal.slice(portal.indexOf("function MazerNamePanel("), portal.indexOf("const DELETE_FIELD_IDS = {"));
  assert.ok(panel.length > 0, "MazerNamePanel exists");
  assert.match(panel, /useState<"password" \| "value">\("password"\)/, "starts on the password step");
  assert.match(panel, /await adapter\.reauthenticate\(password, captchaToken\)/);
  assert.match(panel, /<TurnstileField /);
  // The save only runs from the value step.
  assert.match(panel, /if \(step === "password"\) \{\s*await confirmPassword\([\s\S]*?\} else \{\s*await saveName\(\);/);
});

test("the Mazer name copy stays within the matrix rules", () => {
  assert.equal(AUTH_MESSAGES["mazer.namedone"][0], "success");
  assert.equal(AUTH_MESSAGES["mazer.namesame"][0], "error");
});
