#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { productIdentity } from "../src/config/product.ts";

const SOURCE_PATH = "planning/project-board-owner-source.v1.json";
const ADAPTER_PATH = "scripts/export-project-board-owner.mjs";
const IDENTITY_PATH = "src/config/product.ts";
const OUTPUT_PATH = "exports/trove.project-board.owner-export.v1.json";
const PROJECT_ID = "trove";
const BOARD_ID = "discordos:project-feedback:trove";
const OWNER = "trove";
const INCLUDED_LIFECYCLES = Object.freeze(["in-progress", "planning", "blocked"]);
const STATIC_REQUIRED_EXCLUSIONS = Object.freeze([
  "SOC-024",
  "ui-standards-adoption-trove",
]);

const normalize = (value) => String(value).replace(/\r\n?/g, "\n");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const portablePath = (value) => typeof value === "string"
  && value.length > 0
  && !path.win32.isAbsolute(value)
  && !path.posix.isAbsolute(value.replaceAll("\\", "/"))
  && !value.replaceAll("\\", "/").split("/").some((part) => part === "." || part === "..");

function requireExact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must equal ${JSON.stringify(expected)}`);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function resolveRepositoryIdentity(identity) {
  const owner = requireString(identity?.repositoryOwner, "productIdentity.repositoryOwner");
  const name = requireString(identity?.repositoryName, "productIdentity.repositoryName");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error("product repository identity contains unsupported characters");
  }
  return {
    name,
    root: `repos/${name}`,
    slug: `${owner}/${name}`,
    staleIssueIdentity: `github:${owner}/${name}#1`,
  };
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error(`${label} must be a timezone-aware ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function assertSource(source, repository) {
  requireExact(source.schema_version, "fawxzzyweb.project-board-owner-source.v1", "schema_version");
  requireExact(source.project_id, PROJECT_ID, "project_id");
  requireExact(source.display_name, repository.name, "display_name");
  requireExact(source.board_id, BOARD_ID, "board_id");
  requireExact(source.owner, OWNER, "owner");
  requireExact(source.state, "active", "state");
  requireExact(source.source_baseline?.repository, repository.slug, "source_baseline.repository");
  requireExact(source.source_baseline?.commit, "af6a2076712ce7517b1e021bf4841048f6f97085", "source_baseline.commit");
  requireExact(source.source_baseline?.tree, "2de97f0d59860ec6f7f0dd0832dfa0aa88fb238c", "source_baseline.tree");
  if (!Array.isArray(source.work_items) || source.work_items.length !== 1) throw new Error("owner source must contain the one exact current FawxzzyWeb work item");
  if (source.work_items[0]?.id !== "FW-PROJECTS-001") throw new Error("unexpected FawxzzyWeb work identity");
  const identities = (source.excluded_records ?? []).map((record) => record.identity).sort();
  const requiredExclusions = [...STATIC_REQUIRED_EXCLUSIONS, repository.staleIssueIdentity].sort();
  if (JSON.stringify(identities) !== JSON.stringify(requiredExclusions)) throw new Error("excluded-record reconciliation changed");
  if (source.scope?.discord_mutation_authorized !== false || source.scope?.private_records_included !== false) throw new Error("public owner-export boundary changed");
  if (JSON.stringify(source.scope?.included_project_ids) !== JSON.stringify([PROJECT_ID])) throw new Error("only the active FawxzzyWeb project may be exported");
  if (JSON.stringify(source.scope?.included_lifecycles) !== JSON.stringify(INCLUDED_LIFECYCLES)) throw new Error("owner lifecycle allowlist changed");
  for (const excluded of ["discordos", "fitness", "mazer", "music-sesh"]) {
    if (!source.scope?.excluded_project_ids?.includes(excluded)) throw new Error(`missing excluded project boundary: ${excluded}`);
  }
  requireIsoTimestamp(source.updated_at, "updated_at");
}

function mapCard(item, repository) {
  if (!INCLUDED_LIFECYCLES.includes(item.lifecycle)) throw new Error(`unsupported current lifecycle for ${item.id}`);
  if (item.lifecycle === "blocked" && (!Array.isArray(item.blockers) || item.blockers.length === 0)) throw new Error(`${item.id} must retain its exact blocker`);
  const arrays = ["acceptance_criteria", "discoveries", "next_actions", "blockers", "dependencies", "evidence"];
  for (const field of arrays) if (!Array.isArray(item[field])) throw new Error(`${item.id}.${field} must be an array`);
  if (new Set(item.dependencies).size !== item.dependencies.length || item.dependencies.includes(item.id)) throw new Error(`${item.id} has invalid dependencies`);
  if (item.acceptance_criteria.length === 0 || item.next_actions.length === 0) throw new Error(`${item.id} requires acceptance and next-action truth`);
  for (const evidence of item.evidence) if (!portablePath(evidence)) throw new Error(`${item.id} has a non-portable evidence path`);
  const sourceRef = `${repository.root}/${SOURCE_PATH}#${item.id}`;
  const recordStatus = item.lifecycle === "planning" ? "candidate" : "active";
  return {
    idempotency_key: `pbk_trove_${item.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_v1`,
    record_kind: item.record_kind,
    record_status: recordStatus,
    record: {
      contract_version: "atlas.card-record.v2",
      card_id: item.id,
      project_id: PROJECT_ID,
      board_id: BOARD_ID,
      title: requireString(item.title, `${item.id}.title`),
      description: requireString(item.summary, `${item.id}.summary`),
      card_type: item.card_type,
      lifecycle: item.lifecycle,
      priority: item.priority,
      owner: OWNER,
      dependencies: [...item.dependencies],
      board_version: 1,
      updated_at: requireIsoTimestamp(item.updated_at, `${item.id}.updated_at`),
      source_ref: sourceRef,
      extensions: {
        public_safe: true,
        source_baseline_commit: "af6a2076712ce7517b1e021bf4841048f6f97085",
      },
    },
    source: {
      source_id: "fawxzzyweb-owner-work",
      source_ref: sourceRef,
      source_status: "current",
      source_updated_at: requireIsoTimestamp(item.updated_at, `${item.id}.updated_at`),
    },
    content: {
      summary: requireString(item.summary, `${item.id}.summary`),
      objective: requireString(item.objective, `${item.id}.objective`),
      acceptance_criteria: [...item.acceptance_criteria],
      discoveries: [...item.discoveries],
      next_actions: [...item.next_actions],
      blockers: [...item.blockers],
      evidence: [...item.evidence],
    },
    relationships: { parent_card_id: null, duplicate_of: null, superseded_by: null },
  };
}

export function buildProjectBoardOwnerExport(source, bytes, identity = productIdentity) {
  const repository = resolveRepositoryIdentity(identity);
  assertSource(source, repository);
  const sourceBytes = normalize(bytes.source);
  const adapterBytes = normalize(bytes.adapter);
  const identityBytes = normalize(bytes.identity);
  const sourceRevision = `sha256:${sha256(`${sourceBytes}\n--FAWXZZYWEB-OWNER-ADAPTER--\n${adapterBytes}\n--FAWXZZYWEB-PRODUCT-IDENTITY--\n${identityBytes}`)}`;
  const cards = source.work_items.map((item) => mapCard(item, repository)).sort((left, right) => left.record.card_id.localeCompare(right.record.card_id));
  if (cards.some((card) => /^(?:FF-|MZ-|DOS-|MUSIC-)/.test(card.record.card_id))) throw new Error("cross-owner card identity entered the FawxzzyWeb export");
  return {
    contract_version: "atlas.project-board.owner-export.v1",
    export_id: `pbe_trove_owner_${sourceRevision.slice(7, 19)}`,
    project_id: PROJECT_ID,
    board_id: BOARD_ID,
    owner: OWNER,
    adapter_id: "fawxzzyweb-owner-source-v1",
    source_revision: sourceRevision,
    generated_at: requireIsoTimestamp(source.updated_at, "updated_at"),
    sources: [
      {
        source_id: "fawxzzyweb-owner-work",
        kind: "json",
        repository: repository.name,
        path: `${repository.root}/${SOURCE_PATH}`,
        revision: `sha256:${sha256(sourceBytes)}`,
        observed_at: requireIsoTimestamp(source.updated_at, "updated_at"),
      },
      {
        source_id: "fawxzzyweb-owner-export-adapter",
        kind: "generated",
        repository: repository.name,
        path: `${repository.root}/${ADAPTER_PATH}`,
        revision: `sha256:${sha256(adapterBytes)}`,
        observed_at: requireIsoTimestamp(source.updated_at, "updated_at"),
      },
      {
        source_id: "fawxzzyweb-product-identity",
        kind: "manual-registry",
        repository: repository.name,
        path: `${repository.root}/${IDENTITY_PATH}`,
        revision: `sha256:${sha256(identityBytes)}`,
        observed_at: requireIsoTimestamp(source.updated_at, "updated_at"),
      },
    ],
    cards,
    extensions: {
      source_work_item_count: source.work_items.length,
      exported_card_count: cards.length,
      excluded_record_count: source.excluded_records.length,
      excluded_record_identities: source.excluded_records.map((record) => record.identity).sort(),
      active_project_ids: [PROJECT_ID],
      excluded_project_ids: [...source.scope.excluded_project_ids].sort(),
      socials_program_identity: "SOC-024",
      socials_program_disposition: "cross-owner-current-not-duplicated",
      stale_open_issue_identity: repository.staleIssueIdentity,
      stale_open_issue_disposition: "superseded-history",
      private_records_included: false,
      external_provider_identifiers_included: false,
      discord_mutation_authorized: false,
    },
  };
}

export function renderProjectBoardOwnerExport(repoRoot) {
  const source = fs.readFileSync(path.join(repoRoot, SOURCE_PATH), "utf8");
  const adapter = fs.readFileSync(path.join(repoRoot, ADAPTER_PATH), "utf8");
  const identity = fs.readFileSync(path.join(repoRoot, IDENTITY_PATH), "utf8");
  return `${JSON.stringify(buildProjectBoardOwnerExport(JSON.parse(source), { source, adapter, identity }), null, 2)}\n`;
}

export function runProjectBoardOwnerExport(argv, repoRoot = process.cwd()) {
  const check = argv.includes("--check");
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length) throw new Error(`unknown argument: ${unknown[0]}`);
  const rendered = renderProjectBoardOwnerExport(repoRoot);
  const output = path.join(repoRoot, OUTPUT_PATH);
  if (check) {
    if (!fs.existsSync(output) || normalize(fs.readFileSync(output, "utf8")) !== normalize(rendered)) throw new Error(`${OUTPUT_PATH} is stale`);
    process.stdout.write(`fawxzzyweb-project-board-owner-export: ok (${JSON.parse(rendered).cards.length} cards)\n`);
    return;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, rendered, "utf8");
  process.stdout.write(`fawxzzyweb-project-board-owner-export: wrote ${OUTPUT_PATH}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runProjectBoardOwnerExport(process.argv.slice(2)); }
  catch (error) { console.error(`fawxzzyweb-project-board-owner-export: ${error.message}`); process.exitCode = 1; }
}
