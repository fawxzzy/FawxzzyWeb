import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { boardView, validateFourBoardSnapshot } from "../src/data/project-board-adapter.mjs";
import { buildOwnerBoardState } from "../src/data/project-board-owner-state.mjs";
import { OUTPUT_PATH, buildOwnerSnapshot, renderSnapshot, runBuild } from "../scripts/build-project-board-owner-snapshot.mjs";
import { parseOwnerBoardModule } from "../src/server/projects/owner-board-file.mjs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const snapshotText = fs.readFileSync(OUTPUT_PATH, "utf8");
const snapshot = parseOwnerBoardModule(snapshotText);
const preview = read("src/data/project-board-preview.generated.json");
const manifest = read("planning/project-board-sources.v1.json");
const sourceCards = manifest.sources.flatMap((source) => read(source.path).cards
  .map((card) => ({ board: source.board, project: source.sourceProjectId, id: card.record.card_id })));

test("the owner snapshot is committed, current, valid and accepted as healthy by the adapter", () => {
  assert.equal(snapshot.schema, "fawxzzy.project-board.public-preview.v1");
  assert.equal(snapshot.publicationReady, true);
  assert.deepEqual(Object.keys(snapshot).sort(), ["boards", "preparedAt", "publicationReady", "schema", "sourceKind"]);
  assert.deepEqual(snapshot.boards.map((board) => board.id), ["fitness", "mazer", "trove", "atlas-stack"]);
  validateFourBoardSnapshot(snapshot);
  const view = boardView(buildOwnerBoardState(preview, snapshot));
  assert.equal(view.authoritative, true);
  assert.equal(view.reason, null);
  assert.equal(renderSnapshot(buildOwnerSnapshot().snapshot), snapshotText, "run npm run data:project-board-owner-snapshot");
  assert.doesNotThrow(() => runBuild(["--check"]));
});

test("there is no per-card approval: every card in every listed source is on its board, none dropped or invented", () => {
  const shown = snapshot.boards.flatMap((board) => board.cards.map((card) => ({ board: board.id, project: card.sourceProjectId, id: card.id })));
  const key = (card) => `${card.board}|${card.project}|${card.id}`;
  assert.deepEqual(shown.map(key).sort(), sourceCards.map(key).sort());
  assert.ok(shown.length > 300, "the owner sees the full board, not an approved subset");
  for (const hidden of ["FW-CAPTCHA-001", "lane-security-containment", "FF-MKT-001"]) {
    assert.ok(shown.some((card) => card.id === hidden), `${hidden} is visible to the owner`);
  }
});

test("the old allowlist, approval ledger and text screens are gone", () => {
  assert.deepEqual(Object.keys(manifest).sort(), ["note", "schema", "sources"]);
  for (const source of manifest.sources) assert.deepEqual(Object.keys(source).sort(), ["board", "path", "sourceProjectId"]);
  const builder = fs.readFileSync("scripts/build-project-board-owner-snapshot.mjs", "utf8");
  assert.doesNotMatch(builder, /SENSITIVE_PATTERNS|allowlist|screenText|public_safe/u);
  assert.ok(!fs.existsSync("planning/project-board-public-allowlist.v1.json"));
});

test("dependencies are kept when their card exists and dropped when no source has it", () => {
  const ids = new Set(snapshot.boards.flatMap((board) => board.cards.map((card) => card.id)));
  const cards = snapshot.boards.flatMap((board) => board.cards);
  assert.ok(cards.every((card) => card.dependencies.every((id) => ids.has(id))));
  assert.ok(cards.some((card) => card.dependencies.length > 0), "links between cards survive");
});

test("the snapshot is deterministic and the builder rejects an unknown source layout", () => {
  assert.equal(renderSnapshot(buildOwnerSnapshot().snapshot), renderSnapshot(buildOwnerSnapshot().snapshot));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-snapshot-"));
  try {
    for (const file of ["src/data/project-board-preview.generated.json", "planning/project-board-sources.v1.json"]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(file, path.join(root, file));
    }
    assert.throws(() => buildOwnerSnapshot(root), /ENOENT/u, "a listed source that is missing fails the build");
    const broken = { ...manifest, schema: "other" };
    fs.writeFileSync(path.join(root, "planning/project-board-sources.v1.json"), JSON.stringify(broken));
    assert.throws(() => buildOwnerSnapshot(root), /schema mismatch/u);
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
});

test("owner board data is reachable only from the API function, never from the static site", () => {
  const roots = ["src/app", "src/components", "src/config", "src/data", "src/lib", "src/styles", "public"];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else files.push(full);
    }
  };
  for (const root of roots) walk(root);
  for (const file of files) {
    if (!/\.(?:tsx?|mjs|json|css|html|txt|svg)$/u.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /owner-board(?:-file|\.generated)?(?:\.json|\.mjs)?['"]/u, `${file} must not import the owner board`);
    assert.doesNotMatch(text, /src\/server\/projects/u, `${file} must not reach into the server board`);
  }
  const apis = fs.readdirSync("api/projects").sort();
  assert.deepEqual(apis, ["access.ts", "board.ts"]);
  assert.match(fs.readFileSync("api/projects/board.ts", "utf8"), /owner-board\.generated\.mjs/u);
  assert.doesNotMatch(fs.readFileSync("api/projects/access.ts", "utf8"), /owner-board/u, "the access endpoint never loads the board");
});
