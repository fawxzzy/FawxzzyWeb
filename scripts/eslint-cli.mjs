import process from "node:process";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRepoDependencies } from "./ensure-repo-deps.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");

await ensureRepoDependencies({
  repoRoot,
  reason: "eslint cli wrapper",
});

const executable = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(executable, ["exec", "--", "eslint", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
