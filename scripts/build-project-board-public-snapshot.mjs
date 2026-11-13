#!/usr/bin/env node
// Builds src/data/project-board-public.generated.json from committed owner-export
// copies and the reviewed allowlist. Offline and deterministic: no network, no
// environment, no provider. Fails closed on anything it cannot prove public.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateFourBoardSnapshot } from "../src/data/project-board-adapter.mjs";

export const ALLOWLIST_PATH = "planning/project-board-public-allowlist.v1.json";
export const PREVIEW_PATH = "src/data/project-board-preview.generated.json";
export const OUTPUT_PATH = "src/data/project-board-public.generated.json";
const ALLOWLIST_SCHEMA = "fawxzzyweb.project-board.public-allowlist.v1";
const EXPORT_CONTRACT = "atlas.project-board.owner-export.v1";

// Text screens applied to every published string. A hit stops the build; the card
// must then be removed from the allowlist (or its owner text fixed upstream).
export const SENSITIVE_PATTERNS = Object.freeze([
  ["email address", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["url", /\bhttps?:\/\//i],
  ["drive or backslash path", /(?:\b[A-Za-z]:[\\/]|\\)/],
  ["relative or home path", /(?:\b(?:repos|runtime|docs|handoff|secrets|packages|scripts|config|exports|planning|tmp|src|api|supabase)\/[\w.-]+|~\/|\/(?:Users|home|etc|var)\/)/i],
  ["file name", /\b[\w-]+\.(?:env|dpapi|json|mjs|cjs|js|ts|tsx|md|zip|docx?|xlsx?|pem|key|log|sql|ps1|sh|ya?ml|toml|exe)\b/i],
  ["token-like string", /(?:\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abp]|AKIA)[-_][A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}|\bBearer\s+\S+|[A-Za-z0-9+/]{32,}={0,2}|\b[a-f0-9]{32,}\b)/],
  ["secret or credential word", /\b(?:passwords?|passwd|secrets?|credentials?|api[ -]?keys?|private[ -]keys?|access[ -]keys?|tokens?|cookies?|jwt|session id)\b/i],
  ["security finding word", /\b(?:security|vulnerabilit\w*|advisor|dependabot|leak(?:ed|s)?|incident|exploit\w*|cve-\d+)\b/i],
  ["money or monetization word", /\b(?:monetiz\w*|premium|paid|payments?|billing|invoices?|stripe|subscriptions?|pricing|revenue|paywall)\b/i],
  ["personal data word", /\b(?:personal data|e-?mail|ssn|phone number|home address|career)\b/i],
  ["excluded program", /(?:discord ?os|creation ?os|socials? ?os|stream remote|nat1|hard pill|realm blade)/i],
]);

const normalize = (value) => String(value).replace(/\r\n?/g, "\n");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (root, relative) => JSON.parse(normalize(fs.readFileSync(path.join(root, relative), "utf8")));

export function screenText(label, value) {
  for (const [name, pattern] of SENSITIVE_PATTERNS) {
    if (pattern.test(value)) throw new Error(`${label} matches the "${name}" screen: ${JSON.stringify(value.slice(0, 80))}`);
  }
}

export function buildPublicSnapshot(root = process.cwd()) {
  const allowlist = readJson(root, ALLOWLIST_PATH);
  if (allowlist.schema !== ALLOWLIST_SCHEMA) throw new Error("allowlist schema mismatch");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(allowlist.approvedOn)) throw new Error("allowlist approvedOn must be YYYY-MM-DD");
  const preview = readJson(root, PREVIEW_PATH);
  const excluded = new Map(allowlist.exclude.map((entry) => [entry.id, entry.reason]));
  if (excluded.size !== allowlist.exclude.length) throw new Error("duplicate exclude entries");
  const included = Object.values(allowlist.include).flat();
  if (new Set(included).size !== included.length) throw new Error("duplicate include entries");
  for (const id of included) if (excluded.has(id)) throw new Error(`${id} is both included and excluded`);
  const includedIds = new Set(included);

  const boards = preview.boards.map((board) => ({ id: board.id, name: board.name, cards: [] }));
  const sourceDates = [];
  const seen = new Set();
  const dropped = [];
  const notApproved = [];
  for (const source of allowlist.sources) {
    const text = normalize(fs.readFileSync(path.join(root, source.path), "utf8"));
    if (sha256(text) !== source.sha256) throw new Error(`${source.path} no longer matches its pinned sha256; re-review and re-pin`);
    const owner = JSON.parse(text);
    if (owner.contract_version !== EXPORT_CONTRACT) throw new Error(`${source.path} is not an ${EXPORT_CONTRACT} export`);
    if (!/^sha256:[a-f0-9]{64}$/.test(owner.source_revision)) throw new Error(`${source.path} has no sha256 source_revision`);
    if (owner.project_id !== source.sourceProjectId) throw new Error(`${source.path} project_id mismatch`);
    const board = boards.find((item) => item.id === source.board);
    if (!board) throw new Error(`unknown board ${source.board}`);
    sourceDates.push(owner.generated_at.slice(0, 10));
    const want = allowlist.include[source.sourceProjectId] ?? [];
    for (const card of owner.cards) {
      const record = card.record;
      if (!want.includes(record.card_id)) { notApproved.push(record.card_id); continue; }
      if (record.extensions?.public_safe === false) throw new Error(`${record.card_id} is public_safe:false`);
      if (record.project_id !== source.sourceProjectId) throw new Error(`${record.card_id} project_id mismatch`);
      if (seen.has(record.card_id)) throw new Error(`duplicate card ${record.card_id}`);
      seen.add(record.card_id);
      const dependencies = (record.dependencies ?? []).filter((id) => includedIds.has(id));
      for (const id of record.dependencies ?? []) if (!includedIds.has(id)) dropped.push(`${record.card_id}->${id}`);
      const projected = {
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
        dependencies,
        parentId: null,
        duplicateOf: null,
        supersededBy: null,
        updatedAt: record.updated_at,
      };
      screenText(`${record.card_id} title`, projected.title);
      screenText(`${record.card_id} summary`, projected.summary);
      boards.find((item) => item.id === source.board).cards.push(projected);
    }
  }
  for (const id of included) if (!seen.has(id)) throw new Error(`allowlisted card ${id} was not found in any pinned source`);

  const atlas = boards.find((board) => board.id === "atlas-stack");
  const components = { _stack: "Stack", atlas: "Atlas", cortex: "Cortex", foundation: "Foundation", lifeline: "Lifeline", playbook: "Playbook" };
  for (const card of atlas.cards) card.component = components[card.sourceProjectId];
  const order = ["atlas", "playbook", "cortex", "foundation", "lifeline", "_stack"];
  atlas.cards.sort((a, b) => order.indexOf(a.sourceProjectId) - order.indexOf(b.sourceProjectId));

  sourceDates.sort();
  const snapshot = {
    schema: "fawxzzy.project-board.public-preview.v1",
    preparedAt: allowlist.approvedOn,
    publicationReady: true,
    sourceKind: `owner-export snapshot of already-public roadmap and backlog cards, owner-approved allowlist; source exports generated ${sourceDates[0]} to ${sourceDates.at(-1)}; not live`,
    boards,
  };
  validateFourBoardSnapshot(snapshot);
  return { snapshot, dropped, notApproved };
}

export function renderSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function runBuild(argv, root = process.cwd()) {
  const check = argv.includes("--check");
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length) throw new Error(`unknown argument ${unknown[0]}`);
  const { snapshot, dropped, notApproved } = buildPublicSnapshot(root);
  const rendered = renderSnapshot(snapshot);
  const target = path.join(root, OUTPUT_PATH);
  if (check) {
    if (!fs.existsSync(target) || normalize(fs.readFileSync(target, "utf8")) !== rendered) throw new Error(`${OUTPUT_PATH} is stale; run npm run data:project-board-public`);
    process.stdout.write(`project-board-public: ${OUTPUT_PATH} is current\n`);
    return;
  }
  fs.writeFileSync(target, rendered, "utf8");
  const counts = snapshot.boards.map((board) => `${board.id}=${board.cards.length}`).join(" ");
  process.stdout.write(`project-board-public: wrote ${OUTPUT_PATH} (${counts}); dropped ${dropped.length} dependency refs outside the snapshot; ${notApproved.length} source cards not approved\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runBuild(process.argv.slice(2), path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  } catch (error) {
    process.stderr.write(`project-board-public: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
