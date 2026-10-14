import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { applyBoardEnvelope, boardView, initialBoardState, resolveCardReference, resolveDetailDependency, resolveVisibleSelection, validateFourBoardSnapshot } from "../src/data/project-board-adapter.mjs";

const require = createRequire(import.meta.url);

const copy = (value) => structuredClone(value);
const preview = JSON.parse(await readFile("src/data/project-board-preview.generated.json", "utf8"));
const fixture = copy(preview);
fixture.sourceKind = "synthetic test fixture; no real card records";
const syntheticCard = (id, sourceProjectId, component = null) => ({
  id,
  sourceProjectId,
  component,
  sourceRevision: `sha256:${"a".repeat(64)}`,
  owner: "synthetic-test-owner",
  title: `Synthetic fixture ${id}`,
  summary: "Test-only card with no real project status.",
  lifecycle: "planning",
  workType: "test",
  priority: null,
  dependencies: [],
  parentId: null,
  duplicateOf: null,
  supersededBy: null,
  updatedAt: "2026-10-14T00:00:00.000Z",
});
fixture.boards[0].cards = [syntheticCard("SYNTHETIC-FIT-001", "fitness"), syntheticCard("SYNTHETIC-FIT-002", "fitness")];
fixture.boards[0].cards[0].dependencies = ["SYNTHETIC-FIT-002"];
fixture.boards[1].cards = [syntheticCard("SYNTHETIC-MAZER-001", "mazer")];
fixture.boards[2].cards = [syntheticCard("SYNTHETIC-WEB-001", "trove")];
fixture.boards[3].cards = [syntheticCard("SYNTHETIC-ATLAS-001", "atlas", "Atlas")];
const approved = copy(fixture);
approved.publicationReady = true;
const envelope = (snapshot, revision = "rev-1", previousRevision = null) => ({
  schema: "fawxzzyweb.project-board.adapter-envelope.v1",
  health: "healthy",
  projectionRevision: revision,
  previousRevision,
  sourceWatermark: `watermark-${revision}`,
  generatedAt: "2026-10-13T19:00:00.000Z",
  snapshot,
});

test("empty public placeholder is visible but never authoritative", () => {
  const view = boardView(initialBoardState(preview));
  assert.equal(view.health, "stale");
  assert.equal(view.authoritative, false);
  assert.equal(view.lastSuccessfulAt, null);
  assert.equal(view.boards.length, 4);
  assert(view.boards.every((board) => board.cards.length === 0));
  const invalidApproval = copy(preview);
  invalidApproval.publicationReady = true;
  assert.throws(() => initialBoardState(invalidApproval), /Empty public projection/);
});

test("accepted revision is idempotent and preserves successful freshness on repeat", () => {
  const initial = initialBoardState(fixture);
  const accepted = applyBoardEnvelope(initial, envelope(approved));
  assert.equal(boardView(accepted).authoritative, true);
  assert.equal(accepted.projectionRevision, "rev-1");
  const repeated = applyBoardEnvelope(accepted, { ...envelope(approved), generatedAt: "2026-10-14T19:00:00.000Z" });
  assert.strictEqual(repeated, accepted);
  assert.equal(repeated.lastSuccessfulAt, "2026-10-13T19:00:00.000Z");
});

test("same revision and watermark accept reordered object keys as identical content", () => {
  const accepted = applyBoardEnvelope(initialBoardState(fixture), envelope(approved));
  const reordered = JSON.parse(JSON.stringify(approved, (_key, value) => value && !Array.isArray(value)
    && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse()) : value));
  const repeated = applyBoardEnvelope(accepted, envelope(reordered));
  assert.strictEqual(repeated, accepted);
});

test("card links use composite identity and never guess across colliding projects", () => {
  const cards = [
    { sourceProjectId: "atlas", id: "SHARED" },
    { sourceProjectId: "playbook", id: "SHARED" },
    { sourceProjectId: "cortex", id: "UNIQUE" },
  ];
  assert.strictEqual(resolveCardReference(cards, "atlas", "SHARED"), cards[0]);
  assert.strictEqual(resolveCardReference(cards, "playbook", "SHARED"), cards[1]);
  assert.strictEqual(resolveCardReference(cards, "cortex", "SHARED"), null);
  assert.strictEqual(resolveCardReference(cards, "cortex", "playbook:SHARED"), cards[1]);
  assert.strictEqual(resolveCardReference(cards, "atlas", "UNIQUE"), cards[2]);
});

test("card detail retains unresolved and ambiguous prerequisites without reading a missing card", () => {
  const snapshot = copy(fixture);
  const source = snapshot.boards[0].cards[0];
  source.dependencies = ["MISSING-001", "MISSING-001"];
  assert.doesNotThrow(() => validateFourBoardSnapshot(snapshot));
  const cards = snapshot.boards.flatMap((board) => board.cards);
  const first = resolveDetailDependency(cards, source.sourceProjectId, source.dependencies[0], 0);
  const second = resolveDetailDependency(cards, source.sourceProjectId, source.dependencies[1], 1);
  assert.deepEqual(first, { key: "0:MISSING-001", target: null });
  assert.deepEqual(second, { key: "1:MISSING-001", target: null });

  const collisions = [
    { sourceProjectId: "atlas", id: "SHARED" },
    { sourceProjectId: "playbook", id: "SHARED" },
  ];
  assert.deepEqual(resolveDetailDependency(collisions, "cortex", "SHARED", 0), {
    key: "0:SHARED", target: null,
  });
  assert.strictEqual(resolveDetailDependency(collisions, "atlas", "SHARED", 0).target, collisions[0]);
});

test("stale or forked revision retains data but removes current-truth authority", () => {
  const accepted = applyBoardEnvelope(initialBoardState(fixture), envelope(approved));
  const stale = applyBoardEnvelope(accepted, envelope(approved, "rev-2", "rev-0"));
  assert.equal(stale.projectionRevision, "rev-1");
  assert.equal(stale.lastSuccessfulAt, accepted.lastSuccessfulAt);
  assert.equal(boardView(stale).health, "reconciling");
  assert.equal(boardView(stale).authoritative, false);
  assert.equal(boardView(stale).boards.length, 4);
  const recovered = applyBoardEnvelope(stale, envelope(approved));
  assert.equal(recovered.health, "healthy");
  assert.equal(recovered.lastSuccessfulAt, accepted.lastSuccessfulAt);
});

test("same revision with changed content is incompatible and exposes no cards", () => {
  const accepted = applyBoardEnvelope(initialBoardState(fixture), envelope(approved));
  const changed = copy(approved);
  changed.boards[0].cards[0].title += " changed";
  const conflict = applyBoardEnvelope(accepted, envelope(changed));
  assert.equal(conflict.reason, "REVISION_CONTENT_CONFLICT");
  assert.equal(conflict.lastAccepted.boards[0].cards[0].title, fixture.boards[0].cards[0].title);
  assert.deepEqual(boardView(conflict).boards, []);
});

test("empty, malformed, or unavailable refresh preserves last accepted data and freshness privately", () => {
  const accepted = applyBoardEnvelope(initialBoardState(fixture), envelope(approved));
  const empty = copy(approved);
  for (const board of empty.boards) board.cards = [];
  for (const candidate of [envelope(empty, "rev-2", "rev-1"), { ...envelope(approved), schema: "unknown" }]) {
    const next = applyBoardEnvelope(accepted, candidate);
    assert.equal(next.health, "incompatible");
    assert.equal(next.lastAccepted.boards.length, 4);
    assert.equal(next.lastSuccessfulAt, accepted.lastSuccessfulAt);
    assert.deepEqual(boardView(next).boards, []);
  }
  const unavailable = applyBoardEnvelope(accepted, { ...envelope(null, "rev-2", "rev-1"), health: "unavailable" });
  assert.equal(unavailable.health, "unavailable");
  assert.deepEqual(boardView(unavailable).boards, []);
  assert.equal(unavailable.lastSuccessfulAt, accepted.lastSuccessfulAt);
});

test("public snapshot validator rejects private fields and duplicate source identities", () => {
  const privateField = copy(fixture);
  privateField.boards[0].cards[0].evidence = "private";
  assert.throws(() => validateFourBoardSnapshot(privateField));
  const duplicate = copy(fixture);
  duplicate.boards[0].cards.push(copy(duplicate.boards[0].cards[0]));
  assert.throws(() => validateFourBoardSnapshot(duplicate));
  const retired = copy(fixture);
  retired.boards[0].cards[0].sourceProjectId = "discordos";
  assert.throws(() => validateFourBoardSnapshot(retired));
  const mixedRevision = copy(fixture);
  mixedRevision.boards[0].cards[0].sourceRevision = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateFourBoardSnapshot(mixedRevision));
});

test("unapproved preview cannot be promoted to authoritative current state", () => {
  const state = applyBoardEnvelope(initialBoardState(fixture), envelope(fixture));
  assert.equal(state.health, "incompatible");
  assert.equal(state.reason, "PUBLICATION_NOT_APPROVED");
  assert.deepEqual(boardView(state).boards, []);
});

test("renderer follows a supplied validated state and shows honest freshness", async () => {
  const typescript = require("typescript");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const source = await readFile("src/components/projects/project-board.tsx", "utf8");
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
    },
  }).outputText;
  const componentModule = { exports: {} };
  const componentRequire = (specifier) => {
    if (specifier === "react") return React;
    if (specifier === "react/jsx-runtime") return require("react/jsx-runtime");
    if (specifier === "@/data/project-board-adapter.mjs") return {
      boardView, initialBoardState, resolveCardReference, resolveDetailDependency, resolveVisibleSelection,
    };
    if (specifier === "@/data/project-board-preview.generated.json") return fixture;
    throw new Error(`Unexpected renderer import: ${specifier}`);
  };
  new Function("require", "module", "exports", compiled)(componentRequire, componentModule, componentModule.exports);
  const { ProjectBoard } = componentModule.exports;
  const render = (state) => renderToStaticMarkup(React.createElement(ProjectBoard, state ? { publicBoardState: state } : {}));

  const previewMarkup = render();
  assert.match(previewMarkup, /Live master sync is pending/);
  assert.match(previewMarkup, /Fawxzzy Fitness/);

  const changed = copy(approved);
  changed.boards[0].cards[0].title = "Synthetic accepted board revision";
  changed.boards[0].cards[0].lifecycle = "in_progress";
  for (const card of changed.boards[0].cards) card.sourceRevision = `sha256:${"1".repeat(64)}`;
  const accepted = applyBoardEnvelope(initialBoardState(fixture), envelope(changed));
  const acceptedMarkup = render(accepted);
  assert.match(acceptedMarkup, /Synthetic accepted board revision/);
  assert.match(acceptedMarkup, /data-lifecycle="in_progress"/);
  assert.match(acceptedMarkup, /Public board snapshot accepted 2026-10-13T19:00:00.000Z/);
  assert.doesNotMatch(acceptedMarkup, /Live master sync is pending/);

  const repeat = applyBoardEnvelope(accepted, envelope(changed));
  assert.strictEqual(repeat, accepted);
  assert.equal(render(repeat), acceptedMarkup);

  const forked = applyBoardEnvelope(accepted, envelope(changed, "rev-2", "rev-0"));
  const forkedMarkup = render(forked);
  assert.match(forkedMarkup, /Board source is reconciling/);
  assert.match(forkedMarkup, /Synthetic accepted board revision/);
  assert.match(forkedMarkup, /without current-truth authority/);

  const stale = applyBoardEnvelope(accepted, { ...envelope(null, "rev-2", "rev-1"), health: "stale" });
  const staleMarkup = render(stale);
  assert.match(staleMarkup, /Board source is stale/);
  assert.match(staleMarkup, /Synthetic accepted board revision/);

  const withoutCard = copy(changed);
  withoutCard.boards[0].cards.shift();
  const removed = applyBoardEnvelope(accepted, envelope(withoutCard, "rev-2", "rev-1"));
  assert.doesNotMatch(render(removed), /Synthetic accepted board revision/);

  const withPrivateField = copy(changed);
  withPrivateField.boards[0].cards[0].evidence = "private synthetic marker";
  const incompatible = applyBoardEnvelope(accepted, envelope(withPrivateField, "rev-2", "rev-1"));
  const incompatibleMarkup = render(incompatible);
  assert.match(incompatibleMarkup, /Project boards unavailable/);
  assert.match(incompatibleMarkup, /Board source is incompatible; cards are hidden/);
  assert.doesNotMatch(incompatibleMarkup, /Synthetic accepted board revision|private synthetic marker/);

  const unavailable = applyBoardEnvelope(accepted, { ...envelope(null, "rev-2", "rev-1"), health: "unavailable" });
  const unavailableMarkup = render(unavailable);
  assert.match(unavailableMarkup, /Board source is unavailable; cards are hidden/);
  assert.doesNotMatch(unavailableMarkup, /Synthetic accepted board revision/);
});

test("selected detail resolves against current visible cards, including update and removal", () => {
  const current = approved.boards.flatMap((board) => board.cards);
  const identity = `${current[0].sourceProjectId}:${current[0].id}`;
  const updated = copy(current);
  updated[0].title = "Synthetic updated detail";
  assert.equal(resolveVisibleSelection(current, identity).title, current[0].title);
  assert.equal(resolveVisibleSelection(updated, identity).title, "Synthetic updated detail");
  assert.equal(resolveVisibleSelection(updated.slice(1), identity), null);
  assert.equal(resolveVisibleSelection([], identity), null);
  assert.equal(resolveVisibleSelection(updated, null), null);
});
