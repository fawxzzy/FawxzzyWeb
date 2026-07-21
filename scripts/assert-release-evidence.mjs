import { readFile } from "node:fs/promises";
import { visualEvidenceBrowsers, visualEvidenceRoutes } from "./visual-evidence-contract.mjs";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const gitignore = await readFile(".gitignore", "utf8");
const dockerignore = await readFile(".dockerignore", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const captureScript = await readFile("scripts/capture-visual-evidence.mjs", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(visualEvidenceRoutes.length === 12, "Visual evidence must cover the 12 governed page routes.");
assert(new Set(visualEvidenceRoutes.map(({ path }) => path)).size === visualEvidenceRoutes.length, "Visual evidence routes must be unique.");
assert(visualEvidenceBrowsers.length === 2, "Visual evidence must cover desktop Chromium and mobile WebKit.");
assert(visualEvidenceBrowsers[0].viewport.width === 1440 && visualEvidenceBrowsers[0].viewport.height === 900, "Desktop evidence must use 1440×900.");
assert(visualEvidenceBrowsers[1].engine === "webkit" && visualEvidenceBrowsers[1].viewport.width === 390 && visualEvidenceBrowsers[1].viewport.height === 844, "Mobile evidence must use 390×844 WebKit.");
assert(packageJson.scripts?.["evidence:visual"] === "node scripts/capture-visual-evidence.mjs", "The portable visual-evidence command must remain stable.");
for (const expected of [
  "npm run evidence:visual",
  "actions/upload-artifact@v7",
  "EVIDENCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
  "ref: ${{ env.EVIDENCE_SHA }}",
  "fawxzzyweb-visual-${{ env.EVIDENCE_SHA }}",
  "visual-evidence/${{ env.EVIDENCE_SHA }}",
  "if-no-files-found: error",
]) {
  assert(workflow.includes(expected), `CI is missing visual-evidence contract: ${expected}`);
}
assert(gitignore.includes("/visual-evidence/"), "Generated visual evidence must stay out of Git.");
assert(dockerignore.includes("visual-evidence"), "Generated visual evidence must stay out of Docker build context.");
assert(captureScript.includes('const knownWebKitMediaControlsError = "Temporal.Duration properties must be finite and of consistent sign";'), "The evidence runner must identify the exact native WebKit media-controls exception.");
assert(captureScript.includes("knownRunnerExceptions"), "Known runner-only exceptions must remain visible in evidence metadata.");

console.log("Portable visual and release-evidence contracts are aligned.");
