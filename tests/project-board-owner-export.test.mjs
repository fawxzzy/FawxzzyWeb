import assert from "node:assert/strict";
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
const build = (value = source, identity = productIdentity) => buildProjectBoardOwnerExport(value, {
  source: JSON.stringify(value, null, 2),
  adapter: adapterText,
  identity: identity === productIdentity ? identityText : JSON.stringify(identity),
}, identity);

test("exports only the exact current FawxzzyWeb owner card", () => {
  const output = build();
  assert.equal(output.contract_version, "atlas.project-board.owner-export.v1");
  assert.equal(output.project_id, "trove");
  assert.equal(output.board_id, "discordos:project-feedback:trove");
  assert.equal(output.owner, "trove");
  assert.deepEqual(output.cards.map((card) => card.record.card_id), ["FW-PROJECTS-001"]);
  assert.equal(output.cards[0].record.lifecycle, "blocked");
  assert.equal(output.cards[0].record_status, "active");
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
  const card = output.cards[0];
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
  }

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
