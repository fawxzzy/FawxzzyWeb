import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * Auth Surface v2 copy lint (owner-approved 2026-11-15). The copy matrix
 * (src/lib/auth/copy-matrix.ts) is the only source of words on the account screens. This test reads
 * every auth screen component, pulls out each JSX text run and each string literal that reads like
 * copy, and fails on anything that is not a matrix line, a matrix label, or one of the few
 * allowlisted strings below (each with its reason). Retired lines must appear nowhere.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrix = loadPortalModule("src/lib/auth/copy-matrix.ts");

export const AUTH_SCREEN_FILES = [
  "src/components/account/account-portal.tsx",
  "src/components/account/auth-surface.tsx",
  "src/components/account/mazer-oauth-authorization.tsx",
  "src/components/account/turnstile-field.tsx",
  "src/components/system/not-found-state.tsx",
  "src/app/error.tsx",
  "src/app/global-error.tsx",
];

/** Strings outside the matrix on purpose. Add one only with a reason. */
const ALLOWLIST = new Map([
  // Runtime origin note: shown only off the production account host (local tests, previews).
  ["Local verification surface", "non-production origin note"],
  ["Non-production Preview — account.fawxzzy.com is not attached", "non-production origin note"],
  ["The canonical account origin is account.fawxzzy.com", "non-production origin note"],
  // Retained Mazer consent card: consent removal/auto-approve is a later lane (out of PR-A scope).
  ["Continue to Mazer?", "consent card (later lane)"],
  ["Mazer will use your Fawxzzy email to open the same account.", "consent card (later lane)"],
  ["Continue to Mazer", "consent card (later lane)"],
  // Screen-reader text on Mazer's bare loader (no visible text by design).
  ["Checking your sign-in.", "screen-reader only"],
  // Developer console messages (never rendered).
  ["Fawxzzy route rendering failed.", "console only"],
  ["Fawxzzy root rendering failed.", "console only"],
]);

function leafStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") {
    for (const sample of ["Fawxzzy", "Fitness", "Mazer", 30, 5]) {
      try {
        const result = value(sample);
        if (typeof result === "string") out.push(result);
      } catch {
        // Not callable with this sample.
      }
    }
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) leafStrings(entry, out);
  }
  return out;
}

function allowedCopy() {
  const allowed = new Set(ALLOWLIST.keys());
  for (const id of Object.keys(matrix.AUTH_MESSAGES)) {
    const notice = matrix.authNotice(id, "zac@icloud.com");
    allowed.add(notice.text);
    if (notice.action) allowed.add(notice.action);
  }
  for (const text of leafStrings(matrix.AUTH_COPY)) allowed.add(text);
  return allowed;
}

/** Drops comments so code notes never count as visible copy. */
function stripComments(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;,{(])\/\/.*$/gm, "$1");
}

/** Reads like words a person sees: starts with a capitalised word and has a space or ends a sentence. */
function readsLikeCopy(text) {
  return /^[A-Z][a-z]/.test(text) && (/\s/.test(text) || /[.?!…]$/.test(text));
}

export function visibleCopy(rawSource) {
  const source = stripComments(rawSource)
    .split("\n")
    .filter((line) => !/^\s*import\s/.test(line) && !/^\s*}\s*from\s/.test(line))
    .join("\n");
  const found = new Set();
  // JSX text runs between tags or expression braces (an arrow "=>" or a generic ">" is not a tag end).
  for (const match of source.matchAll(/(?<![=\-])>\s*([A-Za-z][^<>{}"`;=]*?)\s*[<{]/g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (/[a-z]/.test(text) && /\s|[.?!…]$|^[A-Z]/.test(text)) found.add(text);
  }
  // Double-quoted and template literals (attributes, props, returns). Template slots become "…".
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const text = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, "").trim();
    if (readsLikeCopy(text)) found.add(text);
  }
  return [...found];
}

test("every auth screen shows only copy-matrix words", () => {
  const allowed = allowedCopy();
  const stray = [];
  for (const file of AUTH_SCREEN_FILES) {
    for (const text of visibleCopy(readFileSync(resolve(root, file), "utf8"))) {
      if (!allowed.has(text)) stray.push(`${file}: ${JSON.stringify(text)}`);
    }
  }
  assert.deepEqual(stray, [], "text outside the copy matrix (add it to the matrix, or allowlist it with a reason)");
});

test("retired lines appear on no auth screen and in no matrix entry", () => {
  const matrixText = JSON.stringify([matrix.AUTH_MESSAGES, leafStrings(matrix.AUTH_COPY)]);
  for (const retired of matrix.RETIRED_AUTH_COPY) {
    assert.ok(!matrixText.includes(retired), `matrix carries retired "${retired}"`);
    for (const file of AUTH_SCREEN_FILES) {
      const source = stripComments(readFileSync(resolve(root, file), "utf8"));
      assert.ok(!source.includes(retired), `${file} carries retired "${retired}"`);
    }
  }
});

test("labels are sentence case and messages are complete sentences", () => {
  // Leads are sentences that may quote a button ("tap Sign in"); every label must be sentence case.
  const { button, working, link, title, field, aria } = matrix.AUTH_COPY;
  for (const label of leafStrings({ button, working, link, title, field, aria })) {
    const words = label.replace(/…$/, "").split(/\s+/).slice(1);
    for (const raw of words) {
      const word = raw.replace(/[.,?!…]+$/, "");
      if (["Fawxzzy", "Fitness", "Mazer"].includes(word)) continue;
      assert.doesNotMatch(word, /^[A-Z][a-z]/, `"${label}" must be sentence case`);
    }
  }
  for (const id of Object.keys(matrix.AUTH_MESSAGES)) {
    assert.match(matrix.authNotice(id, "a@b.co").text, /[.?]$/, `${id} must end as a sentence`);
  }
});

test("the masked email always comes from the address on the same screen", () => {
  assert.equal(matrix.maskEmail("zac@icloud.com"), "z•••@icloud.com");
  assert.equal(matrix.authNotice("signup.sent", "Lee@example.com").text, "Check L•••@example.com for a link to confirm your account.");
  assert.equal(matrix.maskEmail(""), "your email");
});

test("the copy scan itself catches stray text, attributes and retired lines", () => {
  const allowed = allowedCopy();
  const probe = [
    '<p className="x">Something went wrong</p>',
    '<AuthHead title="Hello there friend" />',
    "const label = busy ? `Working on ${thing}…` : AUTH_COPY.button.signIn;",
    'console.log(value > 0 ? "a" : "b");',
    '<button type="button">{AUTH_COPY.link.signIn}</button>',
    '<p>Sign in</p>',
  ].join("\n");
  const stray = visibleCopy(probe).filter((text) => !allowed.has(text));
  assert.deepEqual(stray.sort(), ["Hello there friend", "Something went wrong", "Working on …"]);
  assert.deepEqual(visibleCopy('import { x } from "@/lib/Some Module";\n// Long note: Nothing here.'), []);
});
