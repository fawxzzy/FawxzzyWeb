import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * Length contract for every status text a person can read on the account portal screens
 * (sign-in, sign-up, reset, new password, confirm, callback, sign-out, account status, Mazer
 * authorization). Long explanatory sentences crept into button boxes once; this keeps them out.
 *
 * Scope: the shared copy modules (errors, form guidance, password policy, Fitness handoff) are
 * collected by calling them; the portal components are scanned for any string literal or JSX text
 * run that is longer than the cap. Raise the cap only with a written reason in the PR.
 */
const MAX_MESSAGE_LENGTH = 70;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const errors = loadPortalModule("src/lib/auth/errors.ts");
const guidance = loadPortalModule("src/lib/auth/form-guidance.ts");
const passwordPolicy = loadPortalModule("src/lib/auth/password-policy.ts");
const handoff = loadPortalModule("src/lib/auth/fitness-handoff.ts");

function authActions() {
  const source = readFileSync(resolve(root, "src/lib/auth/errors.ts"), "utf8");
  const union = /export type AuthAction =([^;]+);/.exec(source);
  assert.ok(union, "AuthAction union not found in errors.ts");
  const actions = [...union[1].matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(actions.length >= 11, "expected every auth action to be listed");
  return actions;
}

function collectModuleMessages() {
  const messages = new Map();
  const add = (label, text) => {
    assert.equal(typeof text, "string", `${label} must be a string`);
    messages.set(`${label}: ${text}`, text);
  };

  for (const action of authActions()) {
    add(`safeAuthError(${action})`, errors.safeAuthError(action));
    add(`safeAuthSuccess(${action})`, errors.safeAuthSuccess(action));
  }
  add("USERNAME_TAKEN_MESSAGE", errors.USERNAME_TAKEN_MESSAGE);
  add("USERNAME_VISIBILITY_NOTE", guidance.USERNAME_VISIBILITY_NOTE);
  add("FITNESS_HANDOFF_UNAVAILABLE", handoff.FITNESS_HANDOFF_UNAVAILABLE);

  const credentialInputs = [
    { intent: "login", email: "", password: "", username: "" },
    { intent: "signup", email: "", password: "", username: "" },
    { intent: "signup", email: "not-an-email", password: "short", username: "a b" },
    { intent: "signup", email: "a@b.co", password: "short", username: "ok-name" },
  ];
  for (const input of credentialInputs) {
    for (const problem of guidance.guidanceForCredentials(input)) {
      add(`guidanceForCredentials(${input.intent}/${problem.field})`, problem.message);
    }
  }
  for (const email of ["", "nope"]) {
    for (const problem of guidance.guidanceForResetRequest(email)) {
      add(`guidanceForResetRequest(${problem.field})`, problem.message);
    }
  }
  for (const [password, confirmation] of [["", ""], ["short", ""], ["long-enough-password", "other"]]) {
    for (const problem of guidance.guidanceForNewPassword(password, confirmation)) {
      add(`guidanceForNewPassword(${problem.field})`, problem.message);
    }
  }
  for (const action of ["login", "signup", "reset", "change"]) {
    for (const password of ["", "short"]) {
      const result = passwordPolicy.validatePassword(password, action);
      if (!result.valid) add(`validatePassword(${action})`, result.message);
    }
  }
  return messages;
}

/** Drops comments so explanatory code notes never count as user-facing copy. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;,{(])\/\/.*$/gm, "$1")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function longLiterals(rawSource) {
  const source = stripComments(rawSource);
  const findings = [];
  // Double-quoted and template string literals (JSX attributes, text properties, returns).
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const text = match[1] ?? match[2] ?? "";
    // Import specifiers, class lists and URLs carry no spaces-with-prose; copy always has a space.
    if (text.length > MAX_MESSAGE_LENGTH && /\s/.test(text.trim())) findings.push(text);
  }
  // JSX text runs between tags or expression braces (an arrow "=>" or generic ">" is not a tag end).
  for (const match of source.matchAll(/(?<![=\-])>\s*([A-Za-z][^<>{}"`;=]*?)\s*[<{]/g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (text.length > MAX_MESSAGE_LENGTH) findings.push(text);
  }
  return findings;
}

function longPortalLiterals(relativePath) {
  return longLiterals(readFileSync(resolve(root, relativePath), "utf8"));
}

test("every shared portal message stays within the length cap", () => {
  const messages = collectModuleMessages();
  assert.ok(messages.size >= 25, `expected the full message set, got ${messages.size}`);
  const tooLong = [...messages.entries()].filter(([, text]) => text.length > MAX_MESSAGE_LENGTH);
  assert.deepEqual(
    tooLong.map(([key, text]) => `${key} (${text.length} characters)`),
    [],
    `portal messages must stay at ${MAX_MESSAGE_LENGTH} characters or fewer`,
  );
  for (const [key, text] of messages) {
    assert.ok(text.trim().length > 0, `${key} must not be empty`);
    assert.equal(text, text.trim(), `${key} must not carry stray whitespace`);
  }
});

test("status messages in button boxes and notices carry no hedging clause", () => {
  for (const action of authActions()) {
    for (const text of [errors.safeAuthError(action), errors.safeAuthSuccess(action)]) {
      assert.doesNotMatch(text, /\bif\b/i, `"${text}" must not hedge`);
      assert.doesNotMatch(text, /^We could not/i, `"${text}" must be a plain statement`);
    }
  }
});

test("reset request outcome is one fixed line that reveals nothing about the address", () => {
  assert.equal(errors.safeAuthSuccess("reset-request"), "Check your email.");
  assert.equal(errors.safeAuthError("reset-request"), errors.safeAuthSuccess("reset-request"));
  assert.doesNotMatch(errors.safeAuthSuccess("reset-request"), /account|registered|exists|found/i);
});

test("portal components hold no string literal or JSX text over the length cap", () => {
  for (const file of [
    "src/components/account/account-portal.tsx",
    "src/components/account/mazer-oauth-authorization.tsx",
    "src/config/account.ts",
  ]) {
    assert.deepEqual(
      longPortalLiterals(file),
      [],
      `${file} holds portal copy over ${MAX_MESSAGE_LENGTH} characters`,
    );
  }
});

test("the long-literal scan itself catches an over-long portal message", () => {
  const probe = `${"word ".repeat(MAX_MESSAGE_LENGTH / 5)}tail`;
  assert.ok(probe.length > MAX_MESSAGE_LENGTH);
  assert.deepEqual(longLiterals(`const notice = { text: "${probe}" };`), [probe]);
  assert.deepEqual(longLiterals(`<p>${probe}</p>`), [probe]);
  assert.deepEqual(longLiterals(`// ${probe}\nconst short = "Check your email.";`), []);
  assert.deepEqual(longLiterals('const description = "Start again in Mazer.";'), []);
});
