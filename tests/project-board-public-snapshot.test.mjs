import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { boardView, validateFourBoardSnapshot } from "../src/data/project-board-adapter.mjs";
import { buildPublicBoardState } from "../src/data/project-board-public-state.mjs";
import { buildPublicSnapshot, renderSnapshot, screenText } from "../scripts/build-project-board-public-snapshot.mjs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const snapshotText = fs.readFileSync("src/data/project-board-public.generated.json", "utf8");
const snapshot = JSON.parse(snapshotText);
const preview = read("src/data/project-board-preview.generated.json");
const allowlist = read("planning/project-board-public-allowlist.v1.json");
const cards = snapshot.boards.flatMap((board) => board.cards);
const included = Object.values(allowlist.include).flat();
const excludedIds = allowlist.exclude.map((entry) => entry.id);

// Ids Zac has said are never public, restated here so removing one from the
// allowlist's exclude list cannot silently re-enable it.
const NEVER_PUBLIC = [
  "FW-ANALYTICS-001", "FF-MKT-001", "FF-BETA-001", "FF-ANALYTICS-002",
  "lane-fitness-critical-secret-containment", "lane-security-containment",
  "lane-sensitive-runtime-residue-containment", "lane-supabase-security-advisor-remediation",
  "lane-vercel-supabase-monitoring-correlation", "lane-dependabot-visibility",
  "lane-creation-os-product-definition-first-wedge", "lane-stream-remote-decision",
  "lane-codex-execution-contracts", "lane-discordos-single-writer", "lane-discordos-cross-project-board-integrity",
];
const BOARD_COUNTS = { fitness: 27, mazer: 134, trove: 1, "atlas-stack": 21 };

test("generated snapshot is publication-ready, valid, and accepted as healthy by the adapter", () => {
  assert.equal(snapshot.schema, "fawxzzy.project-board.public-preview.v1");
  assert.equal(snapshot.publicationReady, true);
  assert.match(snapshot.sourceKind, /owner-export snapshot/);
  assert.deepEqual(Object.keys(snapshot).sort(), ["boards", "preparedAt", "publicationReady", "schema", "sourceKind"]);
  assert.deepEqual(snapshot.boards.map((board) => board.id), ["fitness", "mazer", "trove", "atlas-stack"]);
  validateFourBoardSnapshot(snapshot);
  const state = buildPublicBoardState(preview, snapshot);
  const view = boardView(state);
  assert.equal(view.authoritative, true);
  assert.equal(view.reason, null);
  assert.deepEqual(Object.fromEntries(view.boards.map((board) => [board.id, board.cards.length])), BOARD_COUNTS);
});

test("empty placeholder is unchanged and remains the cold-start fallback", () => {
  assert.equal(preview.publicationReady, false);
  assert(preview.boards.every((board) => board.cards.length === 0));
});

test("every published card is allowlisted for its own source project and board", () => {
  const sources = new Map(allowlist.sources.map((source) => [source.sourceProjectId, source.board]));
  for (const board of snapshot.boards) {
    for (const card of board.cards) {
      assert(allowlist.include[card.sourceProjectId]?.includes(card.id), `${card.id} is not allowlisted`);
      assert.equal(sources.get(card.sourceProjectId), board.id, `${card.id} is on the wrong board`);
    }
  }
  assert.deepEqual(cards.map((card) => card.id).sort(), [...included].sort());
  assert.equal(new Set(included).size, included.length);
});

test("no excluded or never-public id appears anywhere in the generated JSON", () => {
  for (const id of new Set([...excludedIds, ...NEVER_PUBLIC])) {
    assert(!snapshotText.includes(id), `excluded id leaked: ${id}`);
    assert(!included.includes(id), `excluded id is allowlisted: ${id}`);
  }
  for (const id of NEVER_PUBLIC) assert(excludedIds.includes(id), `${id} must stay in the explicit exclude list`);
});

test("every card in every pinned source is either approved or explicitly excluded (no silent additions)", () => {
  for (const source of allowlist.sources) {
    const owner = read(source.path);
    for (const card of owner.cards) {
      const id = card.record.card_id;
      const approved = allowlist.include[source.sourceProjectId]?.includes(id) ?? false;
      assert(approved || excludedIds.includes(id), `${id} (${source.sourceProjectId}) is neither approved nor excluded; review it`);
      if (card.record.extensions?.public_safe === false) assert(!approved, `${id} is public_safe:false`);
    }
  }
});

test("only the adapter's card fields are published and detail fields are fixed or null", () => {
  const fields = ["component", "dependencies", "duplicateOf", "id", "lifecycle", "owner", "parentId", "priority", "sourceProjectId", "sourceRevision", "summary", "supersededBy", "title", "updatedAt", "workType"];
  for (const card of cards) {
    assert.deepEqual(Object.keys(card).sort(), fields);
    assert.equal(card.priority, null);
    assert.equal(card.parentId, null);
    assert.equal(card.duplicateOf, null);
    assert.equal(card.supersededBy, null);
    assert.equal(card.owner, card.sourceProjectId);
  }
  for (const key of ["evidence", "acceptance_criteria", "blockers", "next_actions", "discoveries", "source_ref", "idempotency_key", "extensions", "objective", "description", "board_id", "card_id"]) {
    assert(!snapshotText.includes(`"${key}"`), `owner-export field leaked: ${key}`);
  }
});

test("dependencies reference only published cards and never excluded ones", () => {
  const ids = new Set(cards.map((card) => card.id));
  for (const card of cards) {
    for (const dependency of card.dependencies) {
      assert(ids.has(dependency), `${card.id} depends on unpublished ${dependency}`);
      assert(!excludedIds.includes(dependency));
    }
  }
});

test("generated JSON contains no secret-like, path-like, contact, or monetization strings", () => {
  // Independent of the generator's own screens. Hashes and instants are removed first.
  const text = snapshotText.replace(/sha256:[a-f0-9]{64}/g, "sha256:H").replace(/"updatedAt": "[^"]+"/g, '"updatedAt": "T"');
  const forbidden = [
    /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /https?:\/\//i, /[A-Za-z]:\\/, /\\\\/,
    /\b(?:repos|runtime|handoff|secrets|docs|packages|scripts|config|exports)\//i,
    /\.(?:env|dpapi|pem|key|zip|docx|ps1|log|sql)\b/i,
    /\b(?:password|secret|credential|api[ -]?key|private key|access key|token|cookie|bearer|jwt)\b/i,
    /\b(?:sk|pk|ghp|gho|github_pat|xox[abp]|AKIA)[-_][A-Za-z0-9_-]{8,}/, /eyJ[A-Za-z0-9_-]{10,}/, /[A-Za-z0-9+/]{40,}/,
    /\b(?:monetiz|premium|paid|payment|billing|stripe|subscription|pricing|revenue)/i,
    /\b(?:security|advisor|dependabot|vulnerab|leak)/i,
    /discord ?os|creation ?os|socials? ?os|nat1|hard pill|realm blade|career/i,
  ];
  for (const pattern of forbidden) assert(!pattern.test(text), `forbidden pattern ${pattern} found in generated JSON`);
});

test("generator output equals the committed file (stale snapshots fail)", () => {
  const { snapshot: rebuilt } = buildPublicSnapshot(process.cwd());
  assert.equal(renderSnapshot(rebuilt).replace(/\r\n/g, "\n"), snapshotText.replace(/\r\n/g, "\n"));
});

test("the screens fail closed on unsafe card text", () => {
  for (const bad of ["see repos/fawxzzy-fitness/config", "mail zac@example.com", "uses a secret", "C:\\ATLAS\\x", "launch the paid tier", "security finding #4", "eyJhbGciOiJIUzI1NiJ9abc", "notes.docx"]) {
    assert.throws(() => screenText("t", bad), /screen/, bad);
  }
  assert.doesNotThrow(() => screenText("t", "Add Calendar View"));
});

function sandbox(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "board-public-"));
  for (const dir of ["planning", "exports", "src/data"]) fs.cpSync(dir, path.join(root, dir), { recursive: true });
  mutate(root);
  return root;
}

function editAllowlist(root, change) {
  const file = path.join(root, "planning/project-board-public-allowlist.v1.json");
  const value = read(file);
  change(value);
  fs.writeFileSync(file, JSON.stringify(value));
}

test("tampered allowlist or sources stop the build", () => {
  const roots = [];
  const attempt = (mutate, pattern) => {
    const root = sandbox(mutate);
    roots.push(root);
    assert.throws(() => buildPublicSnapshot(root), pattern);
  };
  try {
    attempt((root) => editAllowlist(root, (value) => value.include.fitness.push("FF-MKT-001")), /both included and excluded/);
    attempt((root) => editAllowlist(root, (value) => {
      value.exclude = value.exclude.filter((entry) => entry.id !== "FW-ANALYTICS-001");
      value.include.trove.push("FW-ANALYTICS-001");
    }), /public_safe:false/);
    attempt((root) => editAllowlist(root, (value) => value.include.fitness.push("FF-DOES-NOT-EXIST")), /was not found/);
    attempt((root) => fs.appendFileSync(path.join(root, "planning/board-sources/mazer.project-board.owner-export.v1.json"), " "), /pinned sha256/);
    attempt((root) => editAllowlist(root, (value) => {
      value.exclude = value.exclude.filter((entry) => entry.id !== "FF-SOC-001");
      value.include.fitness.push("FF-SOC-001");
    }), /screen/);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
});

test("projects page applies the approved snapshot through the adapter envelope", () => {
  const page = fs.readFileSync("src/app/projects/page.tsx", "utf8");
  const board = fs.readFileSync("src/components/projects/public-project-board.tsx", "utf8");
  assert.match(page, /<PublicProjectBoard privateBoardSlot=/);
  assert.match(board, /buildPublicBoardState\(emptyPreview, publicSnapshot\)/);
  assert.match(board, /<ProjectBoard publicBoardState=\{publicBoardState\} privateBoardSlot=/);
  assert(!/fetch\(|process\.env/.test(page + board));
});

test("Projects navigation is origin-relative on the storefront and points to the main site from the account shell", () => {
  const nav = fs.readFileSync("src/components/site/site-nav.tsx", "utf8");
  const shell = fs.readFileSync("src/components/account/account-page-shell.tsx", "utf8");
  const config = fs.readFileSync("src/config/account.ts", "utf8");
  assert.match(nav, /projectsHref = "\/projects"/);
  assert(!nav.includes("canonicalOrigin"));
  assert.match(shell, /<SiteNav current="account" projectsHref=\{publicProjectsUrl\} \/>/);
  assert.match(config, /publicProjectsUrl = `\$\{accountContract\.publicHubOrigin\}\$\{projectsPaths\.public\}`/);
});
