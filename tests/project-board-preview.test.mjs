import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectBoardLabel } from "../src/data/project-board-label.mjs";

const preview = JSON.parse(await readFile("src/data/project-board-preview.generated.json", "utf8"));

test("four-board public placeholder has no actual card or status records", () => {
  assert.equal(preview.schema, "fawxzzy.project-board.public-preview.v1");
  assert.equal(preview.publicationReady, false);
  assert.match(preview.sourceKind, /empty public placeholder/);
  assert.deepEqual(preview.boards.map((board) => board.id), ["fitness", "mazer", "trove", "atlas-stack"]);
  assert(preview.boards.every((board) => Array.isArray(board.cards) && board.cards.length === 0));
  assert.deepEqual(Object.keys(preview).sort(), ["boards", "preparedAt", "publicationReady", "schema", "sourceKind"]);
  for (const board of preview.boards) {
    assert.deepEqual(Object.keys(board).sort(), ["cards", "id", "name"]);
  }
});

test("public placeholder contains no owner, provider, or private payload fields", () => {
  const text = JSON.stringify(preview);
  for (const field of ["card_id", "board_id", "idempotency_key", "acceptance_criteria", "evidence", "source_ref", "discord_thread", "provider_id", "credential", "transcript", "lifecycle", "priority", "dependencies"]) {
    assert(!text.includes(`"${field}"`), `unapproved field found: ${field}`);
  }
  assert(!/discord\.com\/channels\//i.test(text), "provider URL found");
});

test("Web board display label follows product identity instead of source name", () => {
  const web = preview.boards.find((board) => board.id === "trove");
  assert.equal(projectBoardLabel({ ...web, name: "outdated source name" }, "Future Name"), "Future Name Web");
  assert.equal(projectBoardLabel(preview.boards[1], "Future Name"), "Mazer");
});
