import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium, webkit, devices } from "@playwright/test";
import { writeSourceReleaseReceipt } from "./generate-release-receipt.mjs";
import { visualEvidenceBrowsers, visualEvidenceRoutes } from "./visual-evidence-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commitSha = process.env.EVIDENCE_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
if (!/^[a-f0-9]{40}$/.test(commitSha)) {
  throw new Error("Visual evidence requires an exact 40-character source commit.");
}

const outputRoot = path.resolve(repoRoot, process.env.VISUAL_EVIDENCE_DIR ?? "visual-evidence");
const outputDirectory = path.join(outputRoot, commitSha);
const screenshotsDirectory = path.join(outputDirectory, "screenshots");
const port = Number.parseInt(process.env.VISUAL_EVIDENCE_PORT ?? "4312", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const launchers = { chromium, webkit };
const knownWebKitMediaControlsError = "Temporal.Duration properties must be finite and of consistent sign";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function pngDimensions(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Expected PNG evidence output.");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Evidence server exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz.json`);
      if (response.ok) return;
    } catch {
      // The static server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Evidence server did not become ready within 30 seconds.");
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(screenshotsDirectory, { recursive: true });

const server = spawn(process.execPath, ["scripts/start-static.mjs", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: repoRoot,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

const captures = [];
try {
  await waitForServer(server);
  for (const browserContract of visualEvidenceBrowsers) {
    console.log(`[visual-evidence] starting ${browserContract.label}`);
    const launcher = launchers[browserContract.engine];
    const browser = await launcher.launch();
    const iphone = devices["iPhone 14"];
    const context = await browser.newContext({
      viewport: browserContract.viewport,
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
      isMobile: browserContract.isMobile,
      hasTouch: browserContract.hasTouch,
      userAgent: browserContract.isMobile ? iphone.userAgent : undefined,
    });

    for (const route of visualEvidenceRoutes) {
      console.log(`[visual-evidence] ${browserContract.id} ${route.path}`);
      const page = await context.newPage();
      const browserErrors = [];
      const knownRunnerExceptions = [];
      page.on("pageerror", (error) => {
        if (browserContract.engine === "webkit" && error.message === knownWebKitMediaControlsError) {
          knownRunnerExceptions.push(`pageerror: ${error.message}`);
          return;
        }
        browserErrors.push(`pageerror: ${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
      });
      const response = await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle" });
      if (!response?.ok()) {
        throw new Error(`${route.path} returned ${response?.status() ?? "no response"}.`);
      }
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      if (geometry.scrollWidth > geometry.clientWidth) {
        throw new Error(`${browserContract.label} ${route.path} has horizontal overflow.`);
      }
      if (browserErrors.length > 0) {
        throw new Error(`${browserContract.label} ${route.path} emitted errors: ${browserErrors.join(" | ")}`);
      }

      const fileName = `${browserContract.id}-${route.id}.png`;
      const filePath = path.join(screenshotsDirectory, fileName);
      await page.screenshot({ path: filePath, fullPage: true, animations: "disabled" });
      const bytes = await readFile(filePath);
      if (browserErrors.length > 0) {
        throw new Error(`${browserContract.label} ${route.path} emitted errors during capture: ${browserErrors.join(" | ")}`);
      }
      captures.push({
        browser: browserContract.label,
        engine: browserContract.engine,
        viewport: browserContract.viewport,
        route: route.path,
        routeId: route.id,
        family: route.family,
        file: `screenshots/${fileName}`,
        bytes: bytes.length,
        image: pngDimensions(bytes),
        sha256: sha256(bytes),
        knownRunnerExceptions,
      });
      await page.close();
    }
    await context.close();
    await browser.close();
  }

  const cards = captures.map((capture) => `
    <article>
      <header><strong>${escapeHtml(capture.browser)}</strong><span>${escapeHtml(capture.route)}</span><small>${capture.viewport.width}×${capture.viewport.height} · ${escapeHtml(capture.family)}</small></header>
      <img src="${escapeHtml(capture.file)}" alt="${escapeHtml(`${capture.browser} capture of ${capture.route}`)}">
    </article>`).join("");
  const contactSheetHtml = `<!doctype html><html><head><meta charset="utf-8"><title>FawxzzyWeb ${commitSha} visual evidence</title><style>
    :root{color-scheme:dark;font-family:system-ui,sans-serif;background:#070c0a;color:#d6dfd6}body{margin:0;padding:32px}h1{font-size:28px;margin:0 0 8px}p{color:#adbcaf;margin:0 0 28px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;align-items:start}article{background:#0b110e;border:1px solid #304036;border-radius:16px;overflow:hidden}header{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:12px 14px}header small{grid-column:1/-1;color:#7f9782}img{display:block;width:100%;height:520px;object-fit:cover;object-position:top;background:#050806}@media(max-width:1200px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:800px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}</style></head><body><h1>FawxzzyWeb exact-head visual evidence</h1><p>Commit ${commitSha} · ${captures.length} route/browser captures · reduced motion</p><main class="grid">${cards}</main></body></html>`;
  const contactSheetHtmlPath = path.join(outputDirectory, "contact-sheet.html");
  await writeFile(contactSheetHtmlPath, contactSheetHtml, "utf8");
  const contactBrowser = await chromium.launch();
  const contactPage = await contactBrowser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 1 });
  await contactPage.goto(pathToFileURL(contactSheetHtmlPath).href, { waitUntil: "networkidle" });
  const contactSheetPath = path.join(outputDirectory, "contact-sheet.png");
  await contactPage.screenshot({ path: contactSheetPath, fullPage: true, animations: "disabled" });
  await contactBrowser.close();
  const contactSheetBytes = await readFile(contactSheetPath);

  const manifest = {
    schemaVersion: 1,
    commit: commitSha,
    generatedAt: new Date().toISOString(),
    reducedMotion: true,
    captureCount: captures.length,
    captures,
    contactSheet: {
      file: "contact-sheet.png",
      bytes: contactSheetBytes.length,
      image: pngDimensions(contactSheetBytes),
      sha256: sha256(contactSheetBytes),
    },
  };
  await writeFile(path.join(outputDirectory, "visual-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeSourceReleaseReceipt({ outputDirectory, commitSha });
  console.log(JSON.stringify({ commit: commitSha, outputDirectory, captureCount: captures.length, contactSheet: manifest.contactSheet }));
} catch (error) {
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
  }
}
