#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  VERCEL_PRODUCTION_CONTRACT,
  assertCiRun,
  assertDeploymentCandidate,
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
import { assertCanonicalAliasBindings, recoverFailedProductionRelease } from "./recover-production-release.mjs";

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
  "status,conclusion,headSha,headBranch,event,url",
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
const rollbackDeployment = runJsonCommand(getCommand("vercel"), [
  "api", `/v13/deployments/${rollbackDeploymentId}`,
  "--scope", VERCEL_PRODUCTION_CONTRACT.teamSlug, "--raw",
], { cwd: repoRoot });
if (rollbackDeployment.id !== rollbackDeploymentId || rollbackDeployment.readyState !== "READY"
  || rollbackDeployment.projectId !== VERCEL_PRODUCTION_CONTRACT.projectId) {
  throw new Error("The exact production rollback deployment is not READY on this project.");
}
const rollbackAliases = runJsonCommand(getCommand("vercel"), [
  "api", `/v4/aliases?projectId=${VERCEL_PRODUCTION_CONTRACT.projectId}`,
  "--scope", VERCEL_PRODUCTION_CONTRACT.teamSlug, "--raw",
], { cwd: repoRoot });
assertCanonicalAliasBindings(rollbackAliases, rollbackDeploymentId);

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

const releaseAttemptId = randomUUID();
const invocation = createDeploymentInvocation(expectedCommit, releaseAttemptId);
const deployment = spawnSync(invocation.command, invocation.args, {
  cwd: repoRoot,
  env: { ...process.env, ...invocation.env },
  encoding: "utf8",
  stdio: ["inherit", "pipe", "inherit"],
  windowsHide: true,
  shell: process.platform === "win32",
});
const deploymentUrl = deployment.stdout?.trim();
if (!/^https:\/\/[a-z0-9.-]+\.vercel\.app\/?$/u.test(deploymentUrl ?? "")) {
  throw new Error("Vercel did not return one exact deployment URL; provider effect is uncertain and must be reconciled before any retry.",
    { cause: deployment.error });
}
const candidate = assertDeploymentCandidate(runJsonCommand(getCommand("vercel"), [
  "api", `/v13/deployments/${new URL(deploymentUrl).hostname}`,
  "--scope", VERCEL_PRODUCTION_CONTRACT.teamSlug, "--raw",
], { cwd: repoRoot }), { deploymentUrl, expectedCommit, releaseAttemptId });
const deploymentId = candidate.id;
console.log(JSON.stringify({ deploymentUrl, deploymentId, commandExit: deployment.status }));

let postProject;
for (let attempt = 0; attempt < 12; attempt += 1) {
  postProject = assertRemoteProject(runJsonCommand(getCommand("vercel"), [
    "api",
    `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}`,
    "--scope",
    VERCEL_PRODUCTION_CONTRACT.teamSlug,
    "--raw",
  ], { cwd: repoRoot }));
  const target = postProject.targets?.production?.id;
  if (target === deploymentId) break;
  if (target !== rollbackDeploymentId) {
    throw new Error("Production target moved to a different deployment; writer drift is held.");
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (postProject?.targets?.production?.id !== deploymentId) {
  throw new Error("The exact candidate did not become the production target before the bounded deadline; provider effect is uncertain.");
}

try {
  if (deployment.error || deployment.status !== 0) {
    throw new Error(`Vercel production deployment exited with code ${deployment.status ?? "unknown"}.`,
      { cause: deployment.error });
  }
  const result = await verifyProductionRelease({
    deploymentId,
    expectedCommit,
    sourceTree: source.tree,
    rollbackDeploymentId,
    receiptPath: values.get("--receipt"),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (acceptanceError) {
  let recovery;
  try {
    recovery = await recoverFailedProductionRelease({
      candidateDeploymentId: deploymentId,
      rollbackDeploymentId,
      readProject: () => assertRemoteProject(runJsonCommand(getCommand("vercel"), [
        "api", `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}`,
        "--scope", VERCEL_PRODUCTION_CONTRACT.teamSlug, "--raw",
      ], { cwd: repoRoot })),
      readAliases: () => runJsonCommand(getCommand("vercel"), [
        "api", `/v4/aliases?projectId=${VERCEL_PRODUCTION_CONTRACT.projectId}`,
        "--scope", VERCEL_PRODUCTION_CONTRACT.teamSlug, "--raw",
      ], { cwd: repoRoot }),
      rollback: (priorDeploymentId) => {
        const outcome = spawnSync(getCommand("vercel"), [
          "rollback", priorDeploymentId, "--scope", VERCEL_PRODUCTION_CONTRACT.teamSlug,
          "--non-interactive",
        ], { cwd: repoRoot, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
        if (outcome.error || outcome.status !== 0) {
          throw new Error("Exact Vercel rollback command failed.", { cause: outcome.error });
        }
      },
    });
  } catch (recoveryError) {
    throw new AggregateError([acceptanceError, recoveryError],
      "Production acceptance failed and exact rollback was not verified.");
  }
  console.error(JSON.stringify(recovery));
  throw new Error("Production acceptance failed; exact rollback was verified.", { cause: acceptanceError });
}
