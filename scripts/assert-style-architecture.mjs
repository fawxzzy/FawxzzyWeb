import { readFile } from "node:fs/promises";

const ownership = [
  ["../styles/foundations/tokens-and-reset.css", ":root"],
  ["../styles/components/site-shell.css", ".site-nav"],
  ["../styles/page-families/legacy-public.css", ".compatibility-note"],
  ["../styles/page-families/utility.css", ".account-page"],
  ["../styles/components/catalog-foundations.css", ".app-theme-sage"],
  ["../styles/page-families/product-detail.css", "Wave 2A"],
  ["../styles/page-families/studio-public.css", "Wave 1"],
  ["../styles/page-families/editorial.css", "Wave 2B"],
];
const expectedManifest = [
  '@import "tailwindcss";',
  ...ownership.map(([path]) => `@import "${path}";`),
].join("\n");

const manifest = (await readFile("src/app/globals.css", "utf8")).trim();
if (manifest !== expectedManifest) {
  throw new Error("globals.css must remain the exact ordered style-ownership manifest.");
}

for (const [relativePath, anchor] of ownership) {
  const sourcePath = `src/app/${relativePath}`;
  const source = await readFile(sourcePath, "utf8");
  const lineCount = source.split(/\r?\n/).length - 1;
  if (!source.includes(anchor)) {
    throw new Error(`${sourcePath} is missing its ownership anchor ${anchor}.`);
  }
  if (source.includes("@import")) {
    throw new Error(`${sourcePath} must not introduce a second import graph.`);
  }
  if (lineCount > 1400) {
    throw new Error(`${sourcePath} has regressed into a monolithic stylesheet (${lineCount} lines).`);
  }
}

console.log("Style ownership and cascade-order contracts are aligned.");
