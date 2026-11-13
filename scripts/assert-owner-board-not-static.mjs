#!/usr/bin/env node
// Fails when any card id or title from the owner board appears anywhere in the static
// export (`out/`): HTML, JavaScript chunks, RSC payloads, JSON, source maps. Projects is
// owner-only, so the board must be reachable only through the owner-verified API function.
// Run after `npm run build`; the verify chain does this.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readOwnerBoardSnapshot } from "../src/server/projects/owner-board-file.mjs";

const BINARY = /\.(?:png|jpe?g|webp|gif|ico|mp4|webm|woff2?|ttf|otf|avif|svg)$/iu;
const MIN_TITLE = 12;

export function needlesFor(snapshot) {
  const needles = new Set();
  for (const card of snapshot.boards.flatMap((board) => board.cards)) {
    needles.add(card.id);
    if (card.title.length >= MIN_TITLE) {
      needles.add(card.title);
      needles.add(card.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;"));
    }
  }
  return [...needles];
}

export function scanForOwnerBoard(root, snapshot = readOwnerBoardSnapshot()) {
  const needles = needlesFor(snapshot);
  const hits = [];
  let scanned = 0;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (BINARY.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      scanned += 1;
      const found = needles.find((needle) => text.includes(needle));
      if (found) hits.push({ file: path.relative(root, full), needle: found.slice(0, 60) });
    }
  };
  walk(root);
  return { hits, scanned };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? "out");
  if (!fs.existsSync(root)) {
    process.stderr.write(`owner-board-static: ${root} does not exist; run npm run build first\n`);
    process.exit(1);
  }
  const { hits, scanned } = scanForOwnerBoard(root);
  if (scanned === 0) { process.stderr.write("owner-board-static: scanned no files\n"); process.exit(1); }
  if (hits.length) {
    for (const hit of hits.slice(0, 10)) process.stderr.write(`owner-board-static: ${hit.file} contains owner board text ${JSON.stringify(hit.needle)}\n`);
    process.exit(1);
  }
  process.stdout.write(`owner-board-static: ${scanned} static files contain no owner board card id or title\n`);
}
