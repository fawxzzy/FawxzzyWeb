import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, webkit } from "@playwright/test";
import sharp from "sharp";

import { visualEvidenceBrowsers, visualEvidenceRoutes } from "./visual-evidence-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repoRoot, "tests", "visual-baselines", "fawxzzyweb-v1.json");
const updateBaseline = process.env.VISUAL_REGRESSION_UPDATE === "1";
const port = Number.parseInt(process.env.VISUAL_REGRESSION_PORT ?? "4313", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const launchers = { chromium, webkit };
const signatureSize = 32;
const maximumHeightDrift = 0.03;
const maximumMeanChannelDelta = 0.04;
const maximumChangedCellRatio = 0.15;

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Visual-regression server exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz.json`);
      if (response.ok) return;
    } catch {
      // The static server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Visual-regression server did not become ready within 30 seconds.");
}

async function createSignature(screenshot) {
  const image = sharp(screenshot);
  const metadata = await image.metadata();
  const pixels = await image
    .resize(signatureSize, signatureSize, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const quantized = Buffer.from(
    pixels.map((value) => Math.min(255, Math.round(value / 8) * 8)),
  );
  return {
    width: metadata.width,
    height: metadata.height,
    signature: quantized.toString("base64"),
  };
}

function compareSignatures(current, expected, key) {
  if (current.width !== expected.width) {
    throw new Error(`${key} width drifted from ${expected.width} to ${current.width}.`);
  }
  const heightDelta = Math.abs(current.height - expected.height) / expected.height;
  if (heightDelta > maximumHeightDrift) {
    throw new Error(`${key} height drifted by ${(heightDelta * 100).toFixed(2)}%.`);
  }

  const currentBytes = Buffer.from(current.signature, "base64");
  const expectedBytes = Buffer.from(expected.signature, "base64");
  if (currentBytes.length !== expectedBytes.length) {
    throw new Error(`${key} signature shape changed.`);
  }

  let absoluteDelta = 0;
  let changedCells = 0;
  for (let offset = 0; offset < currentBytes.length; offset += 3) {
    const cellDelta = Math.max(
      Math.abs(currentBytes[offset] - expectedBytes[offset]),
      Math.abs(currentBytes[offset + 1] - expectedBytes[offset + 1]),
      Math.abs(currentBytes[offset + 2] - expectedBytes[offset + 2]),
    );
    if (cellDelta > 48) changedCells += 1;
    absoluteDelta +=
      Math.abs(currentBytes[offset] - expectedBytes[offset]) +
      Math.abs(currentBytes[offset + 1] - expectedBytes[offset + 1]) +
      Math.abs(currentBytes[offset + 2] - expectedBytes[offset + 2]);
  }

  const meanChannelDelta = absoluteDelta / currentBytes.length / 255;
  const changedCellRatio = changedCells / (currentBytes.length / 3);
  if (meanChannelDelta > maximumMeanChannelDelta || changedCellRatio > maximumChangedCellRatio) {
    throw new Error(
      `${key} visual drift exceeded the baseline: mean channel delta ${meanChannelDelta.toFixed(4)}, ` +
      `changed-cell ratio ${changedCellRatio.toFixed(4)}.`,
    );
  }
}

const server = spawn(process.execPath, ["scripts/start-static.mjs", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: repoRoot,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

const captures = {};
try {
  await waitForServer(server);
  for (const browserContract of visualEvidenceBrowsers) {
    const launcher = launchers[browserContract.engine];
    const browser = await launcher.launch();
    const device = devices[browserContract.deviceName];
    const context = await browser.newContext({
      ...device,
      viewport: browserContract.viewport,
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
      isMobile: browserContract.isMobile,
      hasTouch: browserContract.hasTouch,
    });

    for (const route of visualEvidenceRoutes) {
      const page = await context.newPage();
      const response = await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle" });
      const expectedStatus = route.expectedStatus ?? 200;
      if (response?.status() !== expectedStatus) {
        throw new Error(`${browserContract.id} ${route.path} returned ${response?.status() ?? "no response"}.`);
      }
      await page.evaluate(() => document.fonts.ready);
      const screenshot = await page.screenshot({ fullPage: true, animations: "disabled" });
      const key = `${browserContract.id}:${route.id}`;
      captures[key] = await createSignature(screenshot);
      await page.close();
    }

    await context.close();
    await browser.close();
  }

  if (updateBaseline) {
    await mkdir(path.dirname(baselinePath), { recursive: true });
    const baseline = {
      schemaVersion: 1,
      baselineId: "fawxzzyweb-v1",
      signature: {
        width: signatureSize,
        height: signatureSize,
        quantizationStep: 8,
        maximumMeanChannelDelta,
        maximumChangedCellRatio,
      },
      captures,
    };
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    console.log(`Updated ${Object.keys(captures).length} visual baselines at ${baselinePath}.`);
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const expectedKeys = Object.keys(baseline.captures).sort();
    const currentKeys = Object.keys(captures).sort();
    if (JSON.stringify(currentKeys) !== JSON.stringify(expectedKeys)) {
      throw new Error("The visual-regression route/target matrix changed; update requires explicit baseline review.");
    }
    for (const key of currentKeys) {
      compareSignatures(captures[key], baseline.captures[key], key);
    }
    console.log(`Visual regression passed for ${currentKeys.length} route/target captures.`);
  }
} catch (error) {
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
}
