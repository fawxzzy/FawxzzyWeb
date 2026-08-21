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

assert(visualEvidenceRoutes.length === 10, "Visual evidence must cover the 10 governed page routes, including the 404 surface.");
assert(new Set(visualEvidenceRoutes.map(({ path }) => path)).size === visualEvidenceRoutes.length, "Visual evidence routes must be unique.");
assert(visualEvidenceBrowsers.length === 4, "Visual evidence must cover four declared UI target classes.");
assert(visualEvidenceRoutes.length * visualEvidenceBrowsers.length === 40, "Visual evidence must produce exactly 40 page-target captures.");
const evidenceTargets = new Map(visualEvidenceBrowsers.map((target) => [target.id, target]));
assert(evidenceTargets.get("windows-chromium")?.deviceName === "Desktop Chrome", "Windows evidence must use Desktop Chrome.");
assert(evidenceTargets.get("macos-webkit")?.deviceName === "Desktop Safari", "macOS evidence must use Desktop Safari.");
assert(evidenceTargets.get("iphone-webkit")?.deviceName === "iPhone 14", "iPhone evidence must use the iPhone 14 descriptor.");
assert(evidenceTargets.get("android-chromium")?.deviceName === "Pixel 7", "Android evidence must use the Pixel 7 descriptor.");
for (const target of visualEvidenceBrowsers) {
  assert(target.evidenceMode === "playwright-device-emulation", `${target.id} must declare Playwright device emulation.`);
  assert(target.label.includes("emulation"), `${target.id} must not present emulated evidence as native platform coverage.`);
  assert(target.targetClass?.includes("class"), `${target.id} must describe a target class, not a native platform.`);
}
for (const id of ["windows-chromium", "macos-webkit"]) {
  const target = evidenceTargets.get(id);
  assert(target?.viewport.width === 1440 && target?.viewport.height === 900, `${id} evidence must use 1440×900.`);
}
assert(evidenceTargets.get("iphone-webkit")?.viewport.width === 390 && evidenceTargets.get("iphone-webkit")?.viewport.height === 844, "iPhone evidence must use 390×844.");
assert(evidenceTargets.get("android-chromium")?.viewport.width === 412 && evidenceTargets.get("android-chromium")?.viewport.height === 839, "Android evidence must use 412×839.");
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
assert(captureScript.includes('const knownNavigation404ConsoleError = "Failed to load resource: the server responded with a status of 404 (Not Found)";'), "The evidence runner must identify only the exact expected 404 navigation console message.");
assert(captureScript.includes("knownRunnerExceptions"), "Known runner-only exceptions must remain visible in evidence metadata.");
assert(captureScript.includes("target: browserContract.id"), "Visual evidence must name the durable platform target in every capture.");
assert(captureScript.includes("device: browserContract.deviceName"), "Visual evidence must name the emulated device descriptor in every capture.");
assert(captureScript.includes("targetClass: browserContract.targetClass"), "Visual evidence must name the emulated target class in every capture.");
assert(captureScript.includes("evidenceMode: browserContract.evidenceMode"), "Visual evidence must declare emulation mode in every capture.");
assert(captureScript.includes("captureHost"), "Visual evidence must record the real Playwright host platform and architecture.");
assert(captureScript.includes("Playwright device-profile emulation on"), "The contact sheet must disclose its emulated-browser host boundary.");
assert(captureScript.includes("initialTransferBytes"), "Visual evidence must track initial transferred bytes.");
assert(captureScript.includes("routeJavascriptBytes"), "Visual evidence must track route JavaScript bytes.");
assert(captureScript.includes("mp4RequestsBeforeInteraction"), "Visual evidence must record the pre-interaction media contract.");
assert(captureScript.includes("requested MP4 media before interaction"), "Visual evidence must fail when a trailer loads before interaction.");

console.log("Portable visual and release-evidence contracts are aligned.");
