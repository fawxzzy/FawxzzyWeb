#!/usr/bin/env node
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_REQUIRED_MARKERS = [
  "node_modules/next/package.json",
  "node_modules/eslint/package.json",
  "node_modules/serve-handler/package.json",
];
const LOCK_DIR_NAME = ".dependency-bootstrap.lock";
const POLL_INTERVAL_MS = 1000;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function shouldUseShellForExecutable(executablePath) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(executablePath);
}

function markerExists(repoRoot, marker) {
  return fs.existsSync(path.join(repoRoot, marker));
}

function repoDepsReady(repoRoot, requiredMarkers) {
  return requiredMarkers.every((marker) => markerExists(repoRoot, marker));
}

function listMissingMarkers(repoRoot, requiredMarkers) {
  return requiredMarkers.filter((marker) => !markerExists(repoRoot, marker));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function acquireLock(lockDir) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < LOCK_TIMEOUT_MS) {
    try {
      await fsp.mkdir(lockDir, { recursive: false });
      return async () => {
        await fsp.rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code !== "EEXIST") {
        throw error;
      }

      await delay(POLL_INTERVAL_MS);
    }
  }

  throw new Error(`Timed out waiting for dependency bootstrap lock: ${lockDir}`);
}

async function runNpmCi(repoRoot) {
  await new Promise((resolve, reject) => {
    const executable = getNpmCommand();
    const child = spawn(executable, ["ci"], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
      shell: shouldUseShellForExecutable(executable),
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`npm ci exited via signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`npm ci exited with code ${code ?? "unknown"}`));
        return;
      }

      resolve();
    });
  });
}

export async function ensureRepoDependencies({
  repoRoot,
  reason = "repo script",
  requiredMarkers = DEFAULT_REQUIRED_MARKERS,
} = {}) {
  if (!repoRoot) {
    throw new Error("ensureRepoDependencies requires repoRoot.");
  }

  if (repoDepsReady(repoRoot, requiredMarkers)) {
    return { installed: false, reason };
  }

  const runtimeDir = path.join(repoRoot, "runtime");
  const lockDir = path.join(runtimeDir, LOCK_DIR_NAME);
  await fsp.mkdir(runtimeDir, { recursive: true });
  const releaseLock = await acquireLock(lockDir);

  try {
    if (repoDepsReady(repoRoot, requiredMarkers)) {
      return { installed: false, reason };
    }

    const missingMarkers = listMissingMarkers(repoRoot, requiredMarkers);
    process.stderr.write(
      `[deps] Missing repo dependencies for ${reason}. Running npm ci in ${repoRoot}.\n` +
      `[deps] Missing markers: ${missingMarkers.join(", ")}\n`,
    );
    await runNpmCi(repoRoot);

    if (!repoDepsReady(repoRoot, requiredMarkers)) {
      throw new Error(`Dependency bootstrap for ${reason} completed, but required modules are still missing.`);
    }

    return { installed: true, reason };
  } finally {
    await releaseLock();
  }
}
