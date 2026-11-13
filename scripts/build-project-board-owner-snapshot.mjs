#!/usr/bin/env node
// Builds src/server/projects/owner-board.generated.mjs from the committed owner-export
// copies listed in planning/project-board-sources.v1.json. Offline and deterministic:
// no network, no environment, no provider.
//
// Projects is owner-only. The generated file lives under src/server/ and is served only by
// /api/projects/board after the server verifies the owner, so it is never part of the static
// site. There is no per-card approval, exclusion list or text screen: every card in every
// listed source is shown to the owner. The only drops are dependency references that point at
// a card missing from every source (the board adapter requires every link to resolve).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateFourBoardSnapshot } from "../src/data/project-board-adapter.mjs";
import { parseOwnerBoardModule, renderOwnerBoardModule } from "../src/server/projects/owner-board-file.mjs";

export const SOURCES_PATH = "planning/project-board-sources.v1.json";
export const PREVIEW_PATH = "src/data/project-board-preview.generated.json";
export const OUTPUT_PATH = "src/server/projects/owner-board.generated.mjs";
const SOURCES_SCHEMA = "fawxzzyweb.project-board.sources.v1";
const EXPORT_CONTRACT = "atlas.project-board.owner-export.v1";

const normalize = (value) => String(value).replace(/\r\n?/g, "\n");
const readJson = (root, relative) => JSON.parse(normalize(fs.readFileSync(path.join(root, relative), "utf8")));

export function buildOwnerSnapshot(root = process.cwd()) {
  const manifest = readJson(root, SOURCES_PATH);
  if (manifest.schema !== SOURCES_SCHEMA || !Array.isArray(manifest.sources)) throw new Error("sources manifest schema mismatch");
  const preview = readJson(root, PREVIEW_PATH);
  const boards = preview.boards.map((board) => ({ id: board.id, name: board.name, cards: [] }));
  const sourceDates = [];
  const seenSources = new Set();
  const seen = new Set();

  const projected = [];
  for (const source of manifest.sources) {
    if (seenSources.has(source.sourceProjectId)) throw new Error(`duplicate source ${source.sourceProjectId}`);
    seenSources.add(source.sourceProjectId);
    const owner = readJson(root, source.path);
    if (owner.contract_version !== EXPORT_CONTRACT) throw new Error(`${source.path} is not an ${EXPORT_CONTRACT} export`);
    if (!/^sha256:[a-f0-9]{64}$/.test(owner.source_revision)) throw new Error(`${source.path} has no sha256 source_revision`);
    if (owner.project_id !== source.sourceProjectId) throw new Error(`${source.path} project_id mismatch`);
    const board = boards.find((item) => item.id === source.board);
    if (!board) throw new Error(`unknown board ${source.board}`);
    sourceDates.push(owner.generated_at.slice(0, 10));
    for (const card of owner.cards) {
      const record = card.record;
      if (record.project_id !== source.sourceProjectId) throw new Error(`${record.card_id} project_id mismatch`);
      const key = `${source.sourceProjectId}:${record.card_id}`;
      if (seen.has(key)) throw new Error(`duplicate card ${key}`);
      seen.add(key);
      projected.push({
        board,
        card: {
          id: record.card_id,
          sourceProjectId: source.sourceProjectId,
          component: null,
          sourceRevision: owner.source_revision,
          owner: source.sourceProjectId,
          title: String(record.title).trim(),
          summary: String(card.content.summary).trim(),
          lifecycle: String(record.lifecycle).replaceAll("-", "_"),
          workType: String(record.card_type),
          priority: null,
          dependencies: record.dependencies ?? [],
          parentId: null,
          duplicateOf: null,
          supersededBy: null,
          updatedAt: record.updated_at,
        },
      });
    }
  }

  // Keep a dependency only when its target is a card in this snapshot.
  const ids = new Set(projected.map(({ card }) => card.id));
  const dropped = [];
  for (const { board, card } of projected) {
    card.dependencies = card.dependencies.filter((id) => {
      if (ids.has(id)) return true;
      dropped.push(`${card.id}->${id}`);
      return false;
    });
    board.cards.push(card);
  }

  const atlas = boards.find((board) => board.id === "atlas-stack");
  const components = { _stack: "Stack", atlas: "Atlas", cortex: "Cortex", foundation: "Foundation", lifeline: "Lifeline", playbook: "Playbook" };
  for (const card of atlas.cards) card.component = components[card.sourceProjectId];
  const order = ["atlas", "playbook", "cortex", "foundation", "lifeline", "_stack"];
  atlas.cards.sort((a, b) => order.indexOf(a.sourceProjectId) - order.indexOf(b.sourceProjectId));

  sourceDates.sort();
  const snapshot = {
    schema: "fawxzzy.project-board.public-preview.v1",
    preparedAt: sourceDates.at(-1),
    publicationReady: true,
    sourceKind: `owner-export snapshot of every card in the listed project boards, owner-only view; source exports generated ${sourceDates[0]} to ${sourceDates.at(-1)}; not live`,
    boards,
  };
  validateFourBoardSnapshot(snapshot);
  return { snapshot, dropped };
}

export const renderSnapshot = renderOwnerBoardModule;
export const readSnapshot = (root) => parseOwnerBoardModule(fs.readFileSync(path.join(root, OUTPUT_PATH), "utf8"));

export function runBuild(argv, root = process.cwd()) {
  const check = argv.includes("--check");
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length) throw new Error(`unknown argument ${unknown[0]}`);
  const { snapshot, dropped } = buildOwnerSnapshot(root);
  const rendered = renderSnapshot(snapshot);
  const target = path.join(root, OUTPUT_PATH);
  if (check) {
    if (!fs.existsSync(target) || normalize(fs.readFileSync(target, "utf8")) !== rendered) throw new Error(`${OUTPUT_PATH} is stale; run npm run data:project-board-owner-snapshot`);
    process.stdout.write(`project-board-owner-snapshot: ${OUTPUT_PATH} is current\n`);
    return;
  }
  fs.writeFileSync(target, rendered, "utf8");
  const counts = snapshot.boards.map((board) => `${board.id}=${board.cards.length}`).join(" ");
  process.stdout.write(`project-board-owner-snapshot: wrote ${OUTPUT_PATH} (${counts}); dropped ${dropped.length} dependency refs with no card in any source\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runBuild(process.argv.slice(2), path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  } catch (error) {
    process.stderr.write(`project-board-owner-snapshot: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
