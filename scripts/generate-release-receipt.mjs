import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

export async function writeSourceReleaseReceipt({ outputDirectory, commitSha }) {
  const resolvedCommit = git("rev-parse", "HEAD");
  if (commitSha !== resolvedCommit) {
    throw new Error(`Evidence commit ${commitSha} does not match checked-out HEAD ${resolvedCommit}.`);
  }

  const repository = process.env.GITHUB_REPOSITORY ?? "fawxzzy/FawxzzyWeb";
  const runId = process.env.GITHUB_RUN_ID ?? null;
  const receipt = {
    schemaVersion: 1,
    status: "source_evidence_only",
    generatedAt: new Date().toISOString(),
    repository,
    branch: process.env.EVIDENCE_BRANCH ?? git("branch", "--show-current"),
    source: {
      commit: resolvedCommit,
      tree: git("rev-parse", "HEAD^{tree}"),
      visualManifest: "visual-manifest.json",
      ciRun: runId ? `https://github.com/${repository}/actions/runs/${runId}` : null,
    },
    release: {
      reviewedHead: null,
      mergeCommit: null,
      deploymentId: null,
      deploymentUrl: null,
      productionAliases: [],
      smokeResult: null,
      rollbackDeploymentId: null,
    },
    boundary: "This source receipt is not merge or production deployment authority.",
  };

  const receiptPath = path.join(outputDirectory, "release-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { receiptPath, receipt };
}
