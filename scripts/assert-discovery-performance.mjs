import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const baseline = JSON.parse(await readFile("docs/performance-baseline.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const trailerPlayer = await readFile("src/components/catalog/trailer-player.tsx", "utf8");
const captureScript = await readFile("scripts/capture-visual-evidence.mjs", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function routeJavascriptBytes(htmlFile) {
  const html = await readFile(htmlFile, "utf8");
  const sources = [
    ...new Set(
      [...html.matchAll(/<script[^>]+src="([^"?]+\.js)[^"]*"/g)].map(
        (match) => match[1],
      ),
    ),
  ];

  assert(sources.length > 0, `${htmlFile} did not reference route JavaScript.`);

  const sizes = await Promise.all(
    sources.map(async (source) => {
      const asset = path.join("out", source.replace(/^\//, ""));
      return (await stat(asset)).size;
    }),
  );

  return sizes.reduce((total, bytes) => total + bytes, 0);
}

assert(baseline.schemaVersion === 1, "Performance baseline schema is unsupported.");
assert(
  /^[a-f0-9]{40}$/.test(baseline.sourceBase.commit),
  "Performance baseline requires an exact source commit.",
);
assert(
  baseline.budgets.routeJavascriptGrowthRatio === 1.1,
  "Route JavaScript budget must remain tied to the measured ten-percent growth policy.",
);
assert(
  packageJson.scripts?.["test:discovery-performance"] ===
    "node scripts/assert-discovery-performance.mjs",
  "The discovery/performance contract command must remain stable.",
);
assert(
  packageJson.scripts?.verify?.includes(
    "npm run build && npm run test:discovery-performance",
  ),
  "The performance budget must run against the optimized static export.",
);
assert(trailerPlayer.includes('preload="none"'), "Catalog trailers must retain preload=none.");
assert(
  trailerPlayer.includes('<source ref={sourceRef} type="video/mp4" />') &&
    !trailerPlayer.includes('<source src={trailer.video.src}'),
  "Catalog trailer sources must bind only after an explicit play action.",
);
assert(
  captureScript.includes("mp4RequestsBeforeInteraction"),
  "Portable evidence must track pre-interaction MP4 requests.",
);

const routeFiles = {
  "/": "out/index.html",
  "/apps": "out/apps.html",
};

for (const [route, htmlFile] of Object.entries(routeFiles)) {
  const measured = await routeJavascriptBytes(htmlFile);
  const routeBaseline = baseline.sourceStaticExport.routes[route].routeJavascriptBytes;
  const maximum = Math.ceil(
    routeBaseline * baseline.budgets.routeJavascriptGrowthRatio,
  );

  assert(
    measured <= maximum,
    `${route} route JavaScript grew to ${measured} bytes; measured budget is ${maximum}.`,
  );
  console.log(`${route}: ${measured}/${maximum} route JavaScript bytes.`);
}

console.log("Discovery metadata, deferred media, and measured performance budgets are aligned.");
