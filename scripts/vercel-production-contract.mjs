import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const VERCEL_PRODUCTION_CONTRACT = Object.freeze({
  repository: "fawxzzy/FawxzzyWeb",
  mainRef: "origin/main",
  teamId: "team_CMJn7MvzFZZBnhNnjVUZF2RD",
  teamSlug: "fawxzzy",
  projectId: "prj_vhUyajI4AL6BgCF40VnKtdxrBLuV",
  projectName: "fawxzzyweb",
  productionAliases: Object.freeze([
    "fawxzzy.com",
    "www.fawxzzy.com",
    "account.fawxzzy.com",
  ]),
});

const fullCommitPattern = /^[0-9a-f]{40}$/;

export function getCommand(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

export function runGit(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

export function readVercelBinding(repoRoot) {
  const bindingPath = path.join(repoRoot, ".vercel", "project.json");
  let parsed;

  try {
    parsed = JSON.parse(readFileSync(bindingPath, "utf8"));
  } catch (error) {
    const reason = error && typeof error === "object" && "code" in error && error.code === "ENOENT"
      ? "missing"
      : "malformed";
    throw new Error(`Vercel project binding is ${reason}; production release is blocked.`);
  }

  return {
    bindingPath,
    orgId: parsed.orgId,
    projectId: parsed.projectId,
    projectName: parsed.projectName,
  };
}

export function assertVercelBinding(binding) {
  const expected = VERCEL_PRODUCTION_CONTRACT;
  if (binding.orgId !== expected.teamId) {
    throw new Error("Vercel team binding does not match the FawxzzyWeb production contract.");
  }
  if (binding.projectId !== expected.projectId) {
    throw new Error("Vercel project binding does not match the FawxzzyWeb production contract.");
  }
  if (binding.projectName !== expected.projectName) {
    throw new Error("Vercel project name does not match the FawxzzyWeb production contract.");
  }
  return binding;
}

export function assertReleaseSource({ repoRoot, expectedCommit, mainRef = VERCEL_PRODUCTION_CONTRACT.mainRef, git = runGit }) {
  if (!fullCommitPattern.test(expectedCommit ?? "")) {
    throw new Error("--expected-commit must be an exact 40-character lowercase Git commit.");
  }

  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  if (head !== expectedCommit) {
    throw new Error("The checked-out commit does not match --expected-commit.");
  }

  const status = git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) {
    throw new Error("The release checkout is dirty; production release is blocked.");
  }

  try {
    git(repoRoot, ["merge-base", "--is-ancestor", expectedCommit, mainRef]);
  } catch {
    throw new Error(`The release commit is not reachable from ${mainRef}.`);
  }

  return {
    commit: head,
    tree: git(repoRoot, ["rev-parse", "HEAD^{tree}"]),
    mainRef,
  };
}

export function assertCiRun(ciRun, expectedCommit) {
  if (!ciRun || ciRun.headSha !== expectedCommit) {
    throw new Error("The supplied GitHub Actions run does not cover the release commit.");
  }
  if (ciRun.status !== "completed" || ciRun.conclusion !== "success") {
    throw new Error("The supplied exact-main GitHub Actions run is not successful.");
  }
  return ciRun;
}

export function assertRemoteProject(project) {
  const expected = VERCEL_PRODUCTION_CONTRACT;
  if (project?.id !== expected.projectId || project?.name !== expected.projectName || project?.accountId !== expected.teamId) {
    throw new Error("Vercel provider readback does not match the committed production identity.");
  }
  return project;
}

export function createDeploymentInvocation(expectedCommit) {
  return {
    command: getCommand("vercel"),
    args: [
      "deploy",
      "--prod",
      "--yes",
      "--scope",
      VERCEL_PRODUCTION_CONTRACT.teamSlug,
      "--meta",
      `githubCommitSha=${expectedCommit}`,
      "--meta",
      "githubCommitRef=main",
      "--meta",
      "githubRepo=FawxzzyWeb",
      "--meta",
      "githubOrg=fawxzzy",
    ],
    env: {
      VERCEL_ORG_ID: VERCEL_PRODUCTION_CONTRACT.teamId,
      VERCEL_PROJECT_ID: VERCEL_PRODUCTION_CONTRACT.projectId,
      CI: "1",
    },
  };
}

export function runJsonCommand(command, args, { cwd, env = {} } = {}) {
  const output = execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  return JSON.parse(output);
}

export function parseNamedArguments(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected positional argument: ${token}`);
    if (token === "--dry-run") {
      flags.add(token);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}.`);
    values.set(token, value);
    index += 1;
  }
  return { values, flags };
}
