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
 * Scope: every copy-matrix line and label (src/lib/auth/copy-matrix.ts, Auth Surface v2) is
 * collected by calling it; the portal components are scanned for any string literal or JSX text run
 * that is longer than the cap. Raise the cap only with a written reason in the PR.
 */
const MAX_MESSAGE_LENGTH = 70;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const matrix = loadPortalModule("src/lib/auth/copy-matrix.ts");

function collectModuleMessages() {
  const messages = new Map();
  const add = (label, text) => {
    assert.equal(typeof text, "string", `${label} must be a string`);
    messages.set(`${label}: ${text}`, text);
  };
  for (const id of Object.keys(matrix.AUTH_MESSAGES)) {
    // A typical masked address (the cap is about sentence length, not the domain).
    const notice = matrix.authNotice(id, "zac@icloud.com");
    add(id, notice.text);
    if (notice.action) add(`${id} action`, notice.action);
  }
  const walk = (prefix, value) => {
    if (typeof value === "string") add(prefix, value);
    else if (typeof value === "function") add(prefix, value(prefix.startsWith("resendIn") ? 30 : "Fitness"));
    else for (const [key, entry] of Object.entries(value)) walk(`${prefix}.${key}`, entry);
  };
  walk("AUTH_COPY", matrix.AUTH_COPY);
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

test("the reset request success line never confirms that an account exists", () => {
  assert.equal(matrix.authNotice("reset.sentany").text, "If that account exists, we sent a reset link to its email.");
  assert.doesNotMatch(matrix.authNotice("reset.sentany").text, /\{e\}|@/);
});

test("portal components hold no string literal or JSX text over the length cap", () => {
  for (const file of [
    "src/components/account/account-portal.tsx",
    "src/components/account/mazer-oauth-authorization.tsx",
    "src/components/account/auth-surface.tsx",
    "src/components/account/auth-status.tsx",
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
