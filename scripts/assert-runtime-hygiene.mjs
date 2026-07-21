import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8"));
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const dockerfile = await readFile("Dockerfile", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  packageJson.engines?.node === "24.x",
  "package.json must pin the supported Node.js major to 24.x.",
);
assert(
  packageJson.dependencies?.next === "16.2.11",
  "Next.js must remain on the audited 16.2.11 patch.",
);
assert(
  packageJson.devDependencies?.["eslint-config-next"] === "16.2.11",
  "eslint-config-next must match the audited Next.js patch.",
);

for (const contract of [
  ["actions/checkout@v7", "CI must use actions/checkout v7."],
  ["actions/setup-node@v7", "CI must use actions/setup-node v7."],
  ['node-version: "24.x"', "CI must verify with Node.js 24.x."],
  ["docker build --tag fawxzzyweb-ci:${{ github.sha }} .", "CI must build the Lifeline container without publishing it."],
]) {
  assert(workflow.includes(contract[0]), contract[1]);
}

const dockerNodeImages = dockerfile.match(/^FROM\s+node:([^\s]+).*$/gm) ?? [];
assert(
  dockerNodeImages.length === 2 &&
    dockerNodeImages.every((image) => image.startsWith("FROM node:24-alpine")),
  "Every Docker build and runtime stage must use Node.js 24 Alpine.",
);

const expectedHeaders = new Map([
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-frame-options", "DENY"],
  ["permissions-policy", "camera=(), geolocation=(), microphone=()"],
]);
const headerRules = vercelConfig.headers ?? [];
assert(headerRules.length === 1, "Vercel must define exactly one global security-header rule.");
assert(headerRules[0]?.source === "/(.*)", "The security-header rule must cover every route.");

const actualHeaders = new Map(
  (headerRules[0]?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]),
);
assert(
  actualHeaders.size === expectedHeaders.size,
  "The global security-header rule must contain only the approved baseline headers.",
);
for (const [key, value] of expectedHeaders) {
  assert(actualHeaders.get(key) === value, `Missing or changed security-header contract: ${key}.`);
}

console.log("Runtime, CI, and security-header contracts are aligned.");
