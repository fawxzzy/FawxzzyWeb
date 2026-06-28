import process from "node:process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRepoDependencies } from "./ensure-repo-deps.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");

await ensureRepoDependencies({
  repoRoot,
  reason: "next cli wrapper",
});

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
