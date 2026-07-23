#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERCEL_PRODUCTION_CONTRACT,
  assertCiRun,
  assertReleaseSource,
  assertRemoteProject,
  assertVercelBinding,
  createDeploymentInvocation,
  getCommand,
  readVercelBinding,
} from "./vercel-production-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function createFixture(binding = VERCEL_PRODUCTION_CONTRACT) {
  const root = mkdtempSync(path.join(os.tmpdir(), "fawxzzyweb-binding-"));
  mkdirSync(path.join(root, ".vercel"), { recursive: true });
  writeFileSync(path.join(root, ".vercel", "project.json"), JSON.stringify({
    orgId: binding.teamId,
    projectId: binding.projectId,
    projectName: binding.projectName,
  }));
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "FawxzzyWeb fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  writeFileSync(path.join(root, ".gitignore"), ".vercel\n");
  writeFileSync(path.join(root, "fixture.txt"), "one\n");
  git(root, "add", ".gitignore", "fixture.txt");
  git(root, "commit", "-m", "fixture");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}

const cleanup = [];
try {
  const valid = createFixture();
  cleanup.push(valid);
  const head = git(valid, "rev-parse", "HEAD");
  assert.doesNotThrow(() => assertVercelBinding(readVercelBinding(valid)));
  assert.equal(assertReleaseSource({ repoRoot: valid, expectedCommit: head }).commit, head);

  const missing = mkdtempSync(path.join(os.tmpdir(), "fawxzzyweb-binding-missing-"));
  cleanup.push(missing);
  assert.throws(() => readVercelBinding(missing), /binding is missing/);

  const malformed = mkdtempSync(path.join(os.tmpdir(), "fawxzzyweb-binding-malformed-"));
  cleanup.push(malformed);
  mkdirSync(path.join(malformed, ".vercel"));
  writeFileSync(path.join(malformed, ".vercel", "project.json"), "not-json");
  assert.throws(() => readVercelBinding(malformed), /binding is malformed/);

  for (const override of [
    { teamId: "team_wrong" },
    { projectId: "prj_wrong" },
    { projectName: "wrong-project" },
  ]) {
    const fixture = createFixture({ ...VERCEL_PRODUCTION_CONTRACT, ...override });
    cleanup.push(fixture);
    assert.throws(() => assertVercelBinding(readVercelBinding(fixture)), /does not match/);
  }

  writeFileSync(path.join(valid, "fixture.txt"), "dirty\n");
  assert.throws(() => assertReleaseSource({ repoRoot: valid, expectedCommit: head }), /dirty/);
  writeFileSync(path.join(valid, "fixture.txt"), "one\n");
  assert.throws(() => assertReleaseSource({ repoRoot: valid, expectedCommit: "0".repeat(40) }), /does not match/);

  writeFileSync(path.join(valid, "fixture.txt"), "two\n");
  git(valid, "add", "fixture.txt");
  git(valid, "commit", "-m", "not on remote main");
  const divergent = git(valid, "rev-parse", "HEAD");
  assert.throws(() => assertReleaseSource({ repoRoot: valid, expectedCommit: divergent }), /not reachable/);

  const successfulMainRun = {
    headSha: head,
    headBranch: "main",
    event: "push",
    status: "completed",
    conclusion: "success",
  };
  assert.doesNotThrow(() => assertCiRun(successfulMainRun, head));
  assert.throws(() => assertCiRun({ ...successfulMainRun, headSha: "0".repeat(40) }, head), /does not cover/);
  assert.throws(() => assertCiRun({ ...successfulMainRun, headBranch: "codex/release-candidate", event: "pull_request" }, head), /not an exact-main push/);
  assert.throws(() => assertCiRun({ ...successfulMainRun, headBranch: "release" }, head), /not an exact-main push/);
  assert.throws(() => assertCiRun({ ...successfulMainRun, event: "workflow_dispatch" }, head), /not an exact-main push/);
  assert.throws(() => assertCiRun({ ...successfulMainRun, conclusion: "failure" }, head), /not successful/);

  assert.doesNotThrow(() => assertRemoteProject({
    id: VERCEL_PRODUCTION_CONTRACT.projectId,
    name: VERCEL_PRODUCTION_CONTRACT.projectName,
    accountId: VERCEL_PRODUCTION_CONTRACT.teamId,
  }));
  assert.throws(() => assertRemoteProject({ id: "prj_wrong" }), /does not match/);

  assert.equal(
    getCommand("gh", {
      platform: "win32",
      isAvailable: (candidate) => candidate === "gh.exe",
    }),
    "gh.exe",
  );
  assert.equal(
    getCommand("vercel", {
      platform: "win32",
      isAvailable: (candidate) => candidate === "vercel.cmd",
    }),
    "vercel.cmd",
  );
  assert.equal(
    getCommand("gh", {
      platform: "linux",
      isAvailable: () => false,
    }),
    "gh",
  );
  assert.throws(
    () => getCommand("missing", { platform: "win32", isAvailable: () => false }),
    /unavailable on PATH/,
  );

  const invocation = createDeploymentInvocation(head);
  assert.deepEqual(invocation.args.slice(0, 3), ["deploy", "--prod", "--yes"]);
  assert.equal(invocation.env.VERCEL_ORG_ID, VERCEL_PRODUCTION_CONTRACT.teamId);
  assert.equal(invocation.env.VERCEL_PROJECT_ID, VERCEL_PRODUCTION_CONTRACT.projectId);
  assert(!invocation.args.includes("link"));

  const deploySource = readFileSync(path.join(repoRoot, "scripts", "deploy-production.mjs"), "utf8");
  assert(!deploySource.includes("vercel link"), "The production wrapper must never link or create a project.");
  assert(deploySource.includes("--confirm-production"), "The wrapper must require explicit production confirmation.");

  console.log("Deployment binding guard fixtures passed.");
} finally {
  for (const directory of cleanup) rmSync(directory, { recursive: true, force: true });
}
