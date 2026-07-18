#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertBrowserSafeSupabasePublicKeyForBuild,
  isBrowserSafeSupabasePublicKey,
} from "../src/lib/auth/supabase-public-key.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const modernPublishable = `sb_publishable_${"a-b_".repeat(5)}ab_${"c-d_".repeat(2)}`;
const modernSecret = `sb_secret_${"c".repeat(22)}_${"d".repeat(8)}`;

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function legacyKey(role) {
  return [
    encodeJson({ alg: "HS256", typ: "JWT" }),
    encodeJson({ exp: 4_102_444_800, iat: 1, iss: "supabase", role }),
    Buffer.from("synthetic-signature", "utf8").toString("base64url"),
  ].join(".");
}

const legacyAnonymous = legacyKey("anon");
const legacyServiceRole = legacyKey("service_role");

for (const admitted of [modernPublishable, legacyAnonymous]) {
  assert.equal(isBrowserSafeSupabasePublicKey(admitted), true);
  assert.doesNotThrow(() => assertBrowserSafeSupabasePublicKeyForBuild(admitted));
}

for (const rejected of [
  modernSecret,
  legacyServiceRole,
  " ",
  "unsupported-public-value",
  "not.a.jwt",
  `${encodeJson({ alg: "HS256" })}.${encodeJson({ role: "anon" })}.a`,
  `${encodeJson({ alg: "none" })}.${encodeJson({ role: "anon" })}.signature`,
]) {
  assert.equal(isBrowserSafeSupabasePublicKey(rejected), false);
  assert.throws(
    () => assertBrowserSafeSupabasePublicKeyForBuild(rejected),
    /Shared account configuration is not ready for a public build\./u,
  );
}

assert.doesNotThrow(() => assertBrowserSafeSupabasePublicKeyForBuild(undefined));
assert.doesNotThrow(() => assertBrowserSafeSupabasePublicKeyForBuild(""));

const guardedBuild = spawnSync(process.execPath, ["scripts/next-cli.mjs", "build"], {
  cwd: repoRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: modernSecret,
    NEXT_PUBLIC_SUPABASE_URL: "https://synthetic-project.supabase.co",
  },
  windowsHide: true,
});
const guardedOutput = `${guardedBuild.stdout ?? ""}${guardedBuild.stderr ?? ""}`;
assert.notEqual(guardedBuild.status, 0);
assert.match(guardedOutput, /Shared account configuration is not ready for a public build\./u);
assert.equal(guardedOutput.includes(modernSecret), false);

process.stdout.write("Public account key policy and pre-bundle guard passed.\n");
