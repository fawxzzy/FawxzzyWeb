#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  VERCEL_PRODUCTION_CONTRACT,
  assertRemoteProject,
  getCommand,
  parseNamedArguments,
  runJsonCommand,
} from "./vercel-production-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeRoutes = [
  "/",
  "/apps",
  "/apps/fitness",
  "/apps/mazer",
  "/discover",
  "/newsletter",
  "/login",
  "/account",
  "/auth/callback",
  "/auth/confirm",
  "/reset-password?recovery=1",
  "/trove",
  "/healthz.json",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
];
const accountRoutes = [
  "/login",
  "/account",
  "/auth/callback",
  "/auth/confirm",
  "/reset-password?recovery=1",
];

function runVercelJson(args) {
  return runJsonCommand(getCommand("vercel"), args, { cwd: repoRoot });
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
}

function readLogCount(deploymentId, filterArgs) {
  const output = execFileSync(getCommand("vercel"), [
    "logs",
    deploymentId,
    "--scope",
    VERCEL_PRODUCTION_CONTRACT.teamSlug,
    "--since",
    "30m",
    "--no-follow",
    "--limit",
    "100",
    "--json",
    ...filterArgs,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  }).trim();
  return output ? output.split(/\r?\n/).filter(Boolean).length : 0;
}

export async function verifyProductionRelease({ deploymentId, expectedCommit, sourceTree, rollbackDeploymentId, receiptPath }) {
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId ?? "")) {
    throw new Error("--deployment-id must identify one exact Vercel deployment.");
  }
  if (!/^[0-9a-f]{40}$/.test(expectedCommit ?? "")) {
    throw new Error("--expected-commit must be an exact 40-character lowercase Git commit.");
  }
  if (!/^dpl_[A-Za-z0-9]+$/.test(rollbackDeploymentId ?? "")) {
    throw new Error("--rollback-deployment must identify one exact rollback deployment.");
  }
  const project = assertRemoteProject(runVercelJson([
    "api",
    `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}`,
    "--scope",
    VERCEL_PRODUCTION_CONTRACT.teamSlug,
    "--raw",
  ]));
  const deployment = runVercelJson([
    "api",
    `/v13/deployments/${deploymentId}`,
    "--scope",
    VERCEL_PRODUCTION_CONTRACT.teamSlug,
    "--raw",
  ]);
  const rollbackDeployment = runVercelJson([
    "api",
    `/v13/deployments/${rollbackDeploymentId}`,
    "--scope",
    VERCEL_PRODUCTION_CONTRACT.teamSlug,
    "--raw",
  ]);

  if (deployment.id !== deploymentId || deployment.target !== "production" || deployment.readyState !== "READY") {
    throw new Error("The resulting deployment is not the expected READY production deployment.");
  }
  if (deployment.meta?.githubCommitSha !== expectedCommit) {
    throw new Error("The resulting deployment does not identify the expected source commit.");
  }
  if (project.targets?.production?.id !== deploymentId) {
    throw new Error("The FawxzzyWeb production target does not point to the resulting deployment.");
  }
  if (rollbackDeployment.id !== rollbackDeploymentId || rollbackDeployment.readyState !== "READY") {
    throw new Error("The captured rollback deployment is not READY.");
  }

  const aliases = project.targets.production.alias ?? [];
  for (const alias of VERCEL_PRODUCTION_CONTRACT.productionAliases) {
    if (!aliases.includes(alias)) throw new Error(`Required production alias is missing: ${alias}`);
  }

  const smoke = [];
  for (const route of smokeRoutes) {
    const response = await fetchWithTimeout(`https://fawxzzy.com${route}`, { redirect: "follow" });
    smoke.push({ route, status: response.status, url: response.url });
    if (response.status !== 200) throw new Error(`Production smoke failed for ${route}: ${response.status}`);
  }

  const accountSmoke = [];
  for (const route of accountRoutes) {
    const response = await fetchWithTimeout(`https://account.fawxzzy.com${route}`, { redirect: "follow" });
    const html = await response.text();
    const expectedCanonical = `https://account.fawxzzy.com${route.split("?")[0]}`;
    accountSmoke.push({ route, status: response.status, url: response.url, expectedCanonical });
    if (response.status !== 200 || !html.includes(`href="${expectedCanonical}"`)) {
      throw new Error(`Account-origin smoke failed for ${route}.`);
    }
  }

  const www = await fetchWithTimeout("https://www.fawxzzy.com/", { redirect: "manual" });
  if (www.status !== 308 || www.headers.get("location") !== "https://fawxzzy.com/") {
    throw new Error("The www canonical redirect is not exact.");
  }

  const ranges = [];
  for (const route of ["/apps/fitness/trailer.mp4", "/apps/mazer/trailer.mp4"]) {
    const response = await fetchWithTimeout(`https://fawxzzy.com${route}`, {
      headers: { Range: "bytes=0-1023" },
    });
    const proof = {
      route,
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentRange: response.headers.get("content-range"),
      contentLength: response.headers.get("content-length"),
    };
    ranges.push(proof);
    if (proof.status !== 206 || proof.contentType !== "video/mp4" || proof.contentLength !== "1024") {
      throw new Error(`Trailer range proof failed for ${route}.`);
    }
  }

  const logs = {
    errors: readLogCount(deploymentId, ["--level", "error"]),
    serverErrors: readLogCount(deploymentId, ["--status-code", "5xx"]),
  };
  if (logs.errors || logs.serverErrors) throw new Error("Production runtime logs contain release errors.");

  const receipt = {
    schemaVersion: 1,
    status: "production_verified",
    generatedAt: new Date().toISOString(),
    repository: VERCEL_PRODUCTION_CONTRACT.repository,
    source: { commit: expectedCommit, tree: sourceTree ?? null },
    provider: {
      teamId: VERCEL_PRODUCTION_CONTRACT.teamId,
      projectId: VERCEL_PRODUCTION_CONTRACT.projectId,
      projectName: VERCEL_PRODUCTION_CONTRACT.projectName,
    },
    release: {
      deploymentId,
      deploymentUrl: deployment.url,
      aliases,
      rollbackDeploymentId,
      rollbackReadyState: rollbackDeployment.readyState,
    },
    verification: { smoke, accountSmoke, wwwRedirect: 308, ranges, logs },
  };

  const targetPath = receiptPath ?? path.join(repoRoot, "visual-evidence", expectedCommit, "production-release-receipt.json");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { receipt, receiptPath: targetPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseNamedArguments(process.argv.slice(2));
  const result = await verifyProductionRelease({
    deploymentId: values.get("--deployment-id"),
    expectedCommit: values.get("--expected-commit"),
    sourceTree: values.get("--source-tree"),
    rollbackDeploymentId: values.get("--rollback-deployment"),
    receiptPath: values.get("--receipt"),
  });
  console.log(JSON.stringify(result, null, 2));
}
