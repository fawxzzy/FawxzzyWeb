import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProjectBoardOwnerExport,
  renderProjectBoardOwnerExport,
  runProjectBoardOwnerExport,
} from "../scripts/export-project-board-owner.mjs";
import { productIdentity } from "../src/config/product.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceText = fs.readFileSync(path.join(repoRoot, "planning/project-board-owner-source.v1.json"), "utf8");
const adapterText = fs.readFileSync(path.join(repoRoot, "scripts/export-project-board-owner.mjs"), "utf8");
const identityText = fs.readFileSync(path.join(repoRoot, "src/config/product.ts"), "utf8");
const source = JSON.parse(sourceText);
const canonicalSourceKinds = new Set(["json", "yaml", "markdown", "database", "generated", "manual-registry"]);
const build = (value = source, identity = productIdentity) => buildProjectBoardOwnerExport(value, {
  source: JSON.stringify(value, null, 2),
  adapter: adapterText,
  identity: identity === productIdentity ? identityText : JSON.stringify(identity),
}, identity);

test("preserves the exact current FawxzzyWeb owner card", () => {
  const output = build();
  assert.equal(output.contract_version, "atlas.project-board.owner-export.v1");
  assert.equal(output.project_id, "trove");
  assert.equal(output.board_id, "discordos:project-feedback:trove");
  assert.equal(output.owner, "trove");
  assert.deepEqual(output.cards.map((card) => card.record.card_id), ["FW-ANALYTICS-001", "FW-PROJECTS-001"]);
  const original = output.cards.find((card) => card.record.card_id === "FW-PROJECTS-001");
  assert.equal(original.record.lifecycle, "blocked");
  assert.equal(original.record_status, "active");
  assert.equal(original.record.extensions.public_safe, true);
});


test("retains the accepted analytics planning criteria without approving public projection or cross-owner duplication", () => {
  const output = build();
  const analytics = output.cards.find((card) => card.record.card_id === "FW-ANALYTICS-001");
  assert.equal(analytics.record.lifecycle, "planning");
  assert.equal(analytics.record_status, "candidate");
  assert.equal(analytics.record.priority, "low");
  assert.equal(analytics.record.extensions.public_safe, false);
  assert.equal(analytics.idempotency_key, "pbk_trove_fw-analytics-001_v1");
  assert.equal(analytics.content.acceptance_criteria.length, 14);
  // Accepted Web-first brief: preserve every criterion, including its numbering.
  assert.equal(createHash("sha256").update(JSON.stringify(analytics.content.acceptance_criteria)).digest("hex"), "a25d1104b1c54ce2701ece496c63ab307f13aa0cc424c5b0577db5233385fba4");
  assert.deepEqual(analytics.record.dependencies, []);
  assert.deepEqual(analytics.relationships, { parent_card_id: null, duplicate_of: null, superseded_by: null });
  assert.match(analytics.content.discoveries[0], /unadopted owner-source proposal/);
  assert.match(analytics.content.discoveries[0], /canonical equivalence/);
  assert.equal(output.cards.some((card) => ["FF-ANALYTICS-001", "FF-SOC-002"].includes(card.record.card_id)), false);
});

function exampleCard(id, lifecycle, publicSafe) {
  return {
    ...structuredClone(source.work_items[0]),
    id,
    title: `Synthetic ${id}`,
    lifecycle,
    priority: "low",
    public_safe: publicSafe,
    dependencies: ["FW-PROJECTS-001"],
    blockers: lifecycle === "blocked" ? ["Synthetic prerequisite"] : [],
    updated_at: "2026-10-14T00:00:00.000Z",
  };
}

test("exports multiple owner cards with stable identities, priority, lifecycle, and public-safe decisions", () => {
  const expanded = structuredClone(source);
  expanded.work_items.unshift(exampleCard("FW-EXAMPLE-002", "planning", false));
  expanded.work_items.push(exampleCard("FW-EXAMPLE-001", "in-progress", true));
  const output = build(expanded);
  assert.deepEqual(output.cards.map((card) => card.record.card_id), [
    "FW-ANALYTICS-001", "FW-EXAMPLE-001", "FW-EXAMPLE-002", "FW-PROJECTS-001",
  ]);
  assert.equal(output.extensions.source_work_item_count, 4);
  assert.equal(output.extensions.exported_card_count, 4);
  assert.equal(new Set(output.cards.map((card) => card.idempotency_key)).size, 4);
  const planning = output.cards.find((card) => card.record.card_id === "FW-EXAMPLE-002");
  assert.equal(planning.record_status, "candidate");
  assert.equal(planning.record.priority, "low");
  assert.equal(planning.record.extensions.public_safe, false);
  assert.deepEqual(planning.record.dependencies, ["FW-PROJECTS-001"]);
  assert.equal(planning.record.source_ref, "repos/FawxzzyWeb/planning/project-board-owner-source.v1.json#FW-EXAMPLE-002");
  assert.deepEqual(output.cards.find((card) => card.record.card_id === "FW-PROJECTS-001"), build().cards.find((card) => card.record.card_id === "FW-PROJECTS-001"));
});

test("sorts card IDs identically under different default locale collations", () => {
  const expanded = structuredClone(source);
  expanded.work_items.push(exampleCard("FW-CZ", "planning", true));
  expanded.work_items.push(exampleCard("FW-CS", "planning", true));
  const expected = build(expanded);
  assert.deepEqual(expected.cards.map((card) => card.record.card_id), ["FW-ANALYTICS-001", "FW-CS", "FW-CZ", "FW-PROJECTS-001"]);
  const english = new Intl.Collator("en");
  const hungarian = new Intl.Collator("hu");
  assert.equal(Math.sign(english.compare("FW-CS", "FW-CZ")), -1);
  assert.equal(Math.sign(hungarian.compare("FW-CS", "FW-CZ")), 1);
  const originalLocaleCompare = String.prototype.localeCompare;
  let alternate;
  try {
    String.prototype.localeCompare = function (other) {
      return hungarian.compare(String(this), String(other));
    };
    alternate = build(expanded);
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
  assert.equal(alternate.source_revision, expected.source_revision);
  assert.equal(alternate.export_id, expected.export_id);
  assert.deepEqual(alternate, expected);
});

test("accepts ready, review and completed status only when the owner source explicitly includes them", () => {
  const expanded = structuredClone(source);
  expanded.work_items.push(exampleCard("FW-EXAMPLE-001", "review", false));
  assert.throws(() => build(expanded), /unsupported current lifecycle/);
  expanded.scope.included_lifecycles.push("ready", "review", "completed");
  const reviewing = build(expanded);
  assert.equal(reviewing.cards.find((card) => card.record.card_id === "FW-EXAMPLE-001").record.lifecycle, "review");
  assert.equal(reviewing.cards.find((card) => card.record.card_id === "FW-EXAMPLE-001").record_status, "active");
  expanded.work_items.find((item) => item.id === "FW-EXAMPLE-001").lifecycle = "completed";
  expanded.work_items.find((item) => item.id === "FW-EXAMPLE-001").updated_at = "2026-10-14T01:00:00.000Z";
  const completed = build(expanded);
  assert.equal(completed.cards.find((card) => card.record.card_id === "FW-EXAMPLE-001").record.lifecycle, "completed");
  assert.equal(completed.cards.find((card) => card.record.card_id === "FW-EXAMPLE-001").record_status, "active");
  assert.notEqual(completed.source_revision, reviewing.source_revision);
  expanded.work_items.find((item) => item.id === "FW-EXAMPLE-001").lifecycle = "ready";
  const ready = build(expanded);
  assert.equal(ready.cards.find((card) => card.record.card_id === "FW-EXAMPLE-001").record.lifecycle, "ready");
  expanded.work_items.find((item) => item.id === "FW-EXAMPLE-001").blockers.push("Unresolved prerequisite");
  assert.throws(() => build(expanded), /cannot be ready with blockers/);
});

test("rejects duplicate, cross-owner, missing-public-decision, and malformed new work", () => {
  const expanded = structuredClone(source);
  expanded.work_items.push(exampleCard("FW-EXAMPLE-001", "planning", false));
  const duplicate = structuredClone(expanded);
  duplicate.work_items.push(exampleCard("FW-EXAMPLE-001", "blocked", false));
  assert.throws(() => build(duplicate), /duplicate FawxzzyWeb work identity/);
  const crossOwner = structuredClone(expanded);
  crossOwner.work_items.find((item) => item.id === "FW-EXAMPLE-001").id = "FF-ANALYTICS-001";
  assert.throws(() => build(crossOwner), /invalid FawxzzyWeb work identity/);
  const missingDecision = structuredClone(expanded);
  delete missingDecision.work_items.find((item) => item.id === "FW-EXAMPLE-001").public_safe;
  assert.throws(() => build(missingDecision), /requires an explicit public_safe decision/);
  const invalidDecision = structuredClone(expanded);
  invalidDecision.work_items.find((item) => item.id === "FW-EXAMPLE-001").public_safe = "false";
  assert.throws(() => build(invalidDecision), /public_safe must be boolean/);
  const invalidPriority = structuredClone(expanded);
  invalidPriority.work_items.find((item) => item.id === "FW-EXAMPLE-001").priority = "urgent";
  assert.throws(() => build(invalidPriority), /priority is unsupported/);
  const invalidType = structuredClone(expanded);
  invalidType.work_items.find((item) => item.id === "FW-EXAMPLE-001").card_type = "incident";
  assert.throws(() => build(invalidType), /card_type is unsupported/);
  const invalidDependency = structuredClone(expanded);
  invalidDependency.work_items.find((item) => item.id === "FW-EXAMPLE-001").dependencies.push("FW-PROJECTS-001");
  assert.throws(() => build(invalidDependency), /invalid dependencies/);
  const removedOriginal = structuredClone(expanded);
  removedOriginal.work_items = removedOriginal.work_items.slice(1);
  assert.throws(() => build(removedOriginal), /original FawxzzyWeb board work identity is missing/);
});

test("keeps Socials OS, stale incident history, and unplanned standards work out of the board", () => {
  const output = build();
  assert.deepEqual(output.extensions.excluded_record_identities, [
    "SOC-024",
    "github:fawxzzy/FawxzzyWeb#1",
    "ui-standards-adoption-trove",
  ]);
  assert.equal(output.cards.some((card) => card.record.card_id === "SOC-024"), false);
  assert.equal(output.cards.some((card) => card.record.card_id.includes("#1")), false);
});

test("does not import Fitness, Mazer, DiscordOS, or Music Sesh work", () => {
  const output = build();
  assert.deepEqual(output.extensions.active_project_ids, ["trove"]);
  assert.deepEqual(output.extensions.excluded_project_ids, ["discordos", "fitness", "mazer", "music-sesh"]);
  assert.equal(output.cards.some((card) => /^(?:FF-|MZ-|DOS-|MUSIC-)/.test(card.record.card_id)), false);
  assert.equal(output.extensions.private_records_included, false);
  assert.equal(output.extensions.discord_mutation_authorized, false);
});

test("retains portable exact source references and the fixed public-safe contract", () => {
  const output = build();
  for (const entry of output.sources) {
    assert.equal(path.win32.isAbsolute(entry.path), false);
    assert.match(entry.revision, /^sha256:[0-9a-f]{64}$/);
  }
  const card = output.cards.find((entry) => entry.record.card_id === "FW-PROJECTS-001");
  assert.equal(card.record.project_id, output.project_id);
  assert.equal(card.record.board_id, output.board_id);
  assert.equal(card.record.source_ref, card.source.source_ref);
  assert.ok(card.content.acceptance_criteria.length >= 5);
  assert.ok(card.content.blockers.length === 1);
});

test("derives repository metadata and source paths from canonical product identity", () => {
  const output = build();
  const repositorySlug = `${productIdentity.repositoryOwner}/${productIdentity.repositoryName}`;
  assert.equal(source.source_baseline.repository, repositorySlug);
  assert.equal(output.extensions.stale_open_issue_identity, `github:${repositorySlug}#1`);
  for (const entry of output.sources) {
    assert.equal(entry.repository, productIdentity.repositoryName);
    assert.match(entry.path, new RegExp(`^repos/${productIdentity.repositoryName}/`));
    assert.equal(canonicalSourceKinds.has(entry.kind), true, `${entry.source_id} must use a canonical source kind`);
  }
  assert.equal(output.sources.find((entry) => entry.source_id === "fawxzzyweb-product-identity")?.kind, "manual-registry");

  const renamedIdentity = { ...productIdentity, repositoryName: "FawxzzyWebNext" };
  const renamedSource = structuredClone(source);
  renamedSource.display_name = renamedIdentity.repositoryName;
  renamedSource.source_baseline.repository = `${renamedIdentity.repositoryOwner}/${renamedIdentity.repositoryName}`;
  renamedSource.excluded_records = renamedSource.excluded_records.map((record) => record.identity === `github:${repositorySlug}#1`
    ? { ...record, identity: `github:${renamedIdentity.repositoryOwner}/${renamedIdentity.repositoryName}#1` }
    : record);
  const renamedOutput = build(renamedSource, renamedIdentity);
  assert.equal(renamedOutput.sources[0].repository, renamedIdentity.repositoryName);
  assert.equal(renamedOutput.sources[0].path, `repos/${renamedIdentity.repositoryName}/planning/project-board-owner-source.v1.json`);
});

test("fails closed if excluded provenance or project scope drifts", () => {
  const missingSoc = structuredClone(source);
  missingSoc.excluded_records = missingSoc.excluded_records.filter((record) => record.identity !== "SOC-024");
  assert.throws(() => build(missingSoc), /excluded-record reconciliation changed/);
  const widened = structuredClone(source);
  widened.scope.included_project_ids.push("fitness");
  assert.throws(() => build(widened), /only the active FawxzzyWeb project may be exported/);
});

test("is deterministic and the tracked export is current", () => {
  assert.equal(renderProjectBoardOwnerExport(repoRoot), renderProjectBoardOwnerExport(repoRoot));
  assert.doesNotThrow(() => runProjectBoardOwnerExport(["--check"], repoRoot));
});

test("check mode rejects stale output without rewriting it", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fawxzzyweb-owner-export-"));
  try {
    fs.mkdirSync(path.join(temporary, "planning"), { recursive: true });
    fs.mkdirSync(path.join(temporary, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(temporary, "src/config"), { recursive: true });
    fs.mkdirSync(path.join(temporary, "exports"), { recursive: true });
    fs.writeFileSync(path.join(temporary, "planning/project-board-owner-source.v1.json"), sourceText);
    fs.writeFileSync(path.join(temporary, "scripts/export-project-board-owner.mjs"), adapterText);
    fs.writeFileSync(path.join(temporary, "src/config/product.ts"), identityText);
    fs.writeFileSync(path.join(temporary, "exports/trove.project-board.owner-export.v1.json"), "{}\n");
    assert.throws(() => runProjectBoardOwnerExport(["--check"], temporary), /is stale/);
    assert.equal(fs.readFileSync(path.join(temporary, "exports/trove.project-board.owner-export.v1.json"), "utf8"), "{}\n");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
