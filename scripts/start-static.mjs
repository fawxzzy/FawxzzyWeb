import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRepoDependencies } from "./ensure-repo-deps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const publicDir = path.join(repoRoot, "out");

await ensureRepoDependencies({
  repoRoot,
  reason: "static server",
});

const { default: handler } = await import("serve-handler");

function readFlag(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

const host = readFlag("--host") ?? process.env.HOST ?? "0.0.0.0";
const portValue = readFlag("--port") ?? process.env.PORT ?? "3000";
const port = Number.parseInt(portValue, 10);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid port: ${portValue}`);
  process.exit(1);
}

const server = http.createServer((request, response) => {
  return handler(request, response, {
    public: publicDir,
    cleanUrls: true,
  });
});

server.on("error", (error) => {
  if ("code" in error && error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Serving FawxzzyWeb static export at http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
