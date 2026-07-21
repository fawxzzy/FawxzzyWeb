#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  VERCEL_PRODUCTION_CONTRACT,
  assertCiRun,
  assertReleaseSource,
  assertRemoteProject,
  assertVercelBinding,
  createDeploymentInvocation,
  getCommand,
  parseNamedArguments,
  readVercelBinding,
  runJsonCommand,
} from "./vercel-production-contract.mjs";
import { verifyProductionRelease } from "./verify-production-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values, flags } = parseNamedArguments(process.argv.slice(2));
const expectedCommit = values.get("--expected-commit");
const ciRunId = values.get("--ci-run-id");
const confirmation = values.get("--confirm-production");
const dryRun = flags.has("--dry-run");

if (!ciRunId || !/^\d+$/.test(ciRunId)) {
  throw new Error("--ci-run-id is required and must identify the exact-main GitHub Actions run.");
}
if (!dryRun && confirmation !== VERCEL_PRODUCTION_CONTRACT.projectName) {
  throw new Error(`Production release requires --confirm-production ${VERCEL_PRODUCTION_CONTRACT.projectName}.`);
}

const binding = assertVercelBinding(readVercelBinding(repoRoot));
const source = assertReleaseSource({ repoRoot, expectedCommit });
const ciRun = assertCiRun(runJsonCommand(getCommand("gh"), [
  "run",
  "view",
  ciRunId,
  "--repo",
  VERCEL_PRODUCTION_CONTRACT.repository,
  "--json",
  "status,conclusion,headSha,url",
], { cwd: repoRoot }), expectedCommit);
const project = assertRemoteProject(runJsonCommand(getCommand("vercel"), [
  "api",
  `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}`,
  "--scope",
  VERCEL_PRODUCTION_CONTRACT.teamSlug,
  "--raw",
], { cwd: repoRoot }));
const rollbackDeploymentId = project.targets?.production?.id;
if (!rollbackDeploymentId) throw new Error("No current production deployment is available as rollback preimage.");

const preflight = {
  status: dryRun ? "dry_run_ready" : "production_release_ready",
  repository: VERCEL_PRODUCTION_CONTRACT.repository,
  source,
  ci: { runId: ciRunId, url: ciRun.url, conclusion: ciRun.conclusion },
  destination: {
    teamId: binding.orgId,
    projectId: binding.projectId,
    projectName: binding.projectName,
  },
  currentProduction: {
    deploymentId: rollbackDeploymentId,
    deploymentUrl: project.targets.production.url,
    aliases: project.targets.production.alias ?? [],
  },
  rollbackDeploymentId,
  mutation: dryRun ? "none" : "pending_explicit_release",
};
console.log(JSON.stringify(preflight, null, 2));
if (dryRun) process.exit(0);

const invocation = createDeploymentInvocation(expectedCommit);
const deployment = spawnSync(invocation.command, invocation.args, {
  cwd: repoRoot,
  env: { ...process.env, ...invocation.env },
  stdio: "inherit",
  windowsHide: true,
  shell: process.platform === "win32",
});
if (deployment.error) throw deployment.error;
if (deployment.status !== 0) throw new Error(`Vercel production deployment exited with code ${deployment.status ?? "unknown"}.`);

let postProject;
for (let attempt = 0; attempt < 12; attempt += 1) {
  postProject = assertRemoteProject(runJsonCommand(getCommand("vercel"), [
    "api",
    `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}`,
    "--scope",
    VERCEL_PRODUCTION_CONTRACT.teamSlug,
    "--raw",
  ], { cwd: repoRoot }));
  if (postProject.targets?.production?.id && postProject.targets.production.id !== rollbackDeploymentId) break;
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
const deploymentId = postProject?.targets?.production?.id;
if (!deploymentId || deploymentId === rollbackDeploymentId) {
  throw new Error("Vercel did not move the expected production target after deployment.");
}

const result = await verifyProductionRelease({
  deploymentId,
  expectedCommit,
  sourceTree: source.tree,
  rollbackDeploymentId,
  receiptPath: values.get("--receipt"),
});
console.log(JSON.stringify(result, null, 2));
