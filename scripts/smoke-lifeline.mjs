import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSiteSmoke } from "./assert-site-smoke.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const startEntrypoint = path.join(repoRoot, "scripts", "start-static.mjs");
const port = process.env.FAWXZZYWEB_TEST_PORT ?? "3210";
if (!["3210", "4312"].includes(port)) {
  throw new Error("FAWXZZYWEB_TEST_PORT must be 3210 or 4312");
}
const baseUrl = `http://127.0.0.1:${port}`;

function startServer() {
  return spawn(process.execPath, [startEntrypoint, "--host", "127.0.0.1", "--port", `${port}`], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch {
      await delay(250);
      continue;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

// A child killed by a signal has `exitCode === null` and a `signalCode` instead. On Windows every
// kill ends the process at once that way, so testing `exitCode` alone left this script waiting for a
// second "exit" event that never fired; the event loop drained and Node exited 0, hiding failures.
function hasExited(server) {
  return server.exitCode !== null || server.signalCode !== null;
}

function waitForExit(server, ms) {
  if (hasExited(server)) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => {
      server.once("exit", resolve);
    }),
    delay(ms),
  ]);
}

async function stopServer(server) {
  if (hasExited(server)) {
    return;
  }

  server.kill("SIGINT");
  await waitForExit(server, 5_000);

  if (!hasExited(server)) {
    server.kill("SIGKILL");
    await waitForExit(server, 5_000);
  }
}

async function main() {
  const server = startServer();
  let stderr = "";
  let stdout = "";

  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  server.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  try {
    await waitFor(`${baseUrl}/`);
    await assertSiteSmoke(baseUrl);
  } finally {
    await stopServer(server);
  }

  if (
    server.exitCode !== null &&
    server.exitCode !== 0 &&
    server.exitCode !== 130
  ) {
    throw new Error(stderr || stdout || `server exited with code ${server.exitCode}`);
  }
}

// Settle the exit code explicitly: a promise left pending with nothing else alive must never read
// as a pass.
main().then(
  () => {
    process.exit(process.exitCode ?? 0);
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
process.on("beforeExit", () => {
  if (process.exitCode === undefined) {
    console.error("smoke-lifeline: event loop drained before the smoke settled.");
    process.exitCode = 1;
  }
});
