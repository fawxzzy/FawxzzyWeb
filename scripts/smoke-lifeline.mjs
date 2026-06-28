import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertHomeSmoke } from "./assert-home-smoke.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const startEntrypoint = path.join(repoRoot, "scripts", "start-static.mjs");
const port = 3210;
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

async function stopServer(server) {
  if (server.exitCode !== null) {
    return;
  }

  server.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => {
      server.once("exit", resolve);
    }),
    delay(5_000),
  ]);

  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await new Promise((resolve) => {
      server.once("exit", resolve);
    });
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
    await assertHomeSmoke(baseUrl);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
