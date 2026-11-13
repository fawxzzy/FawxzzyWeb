import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanForOwnerBoard } from '../scripts/assert-owner-board-not-static.mjs';
import { loadCandidateProjectSnapshot, projectSnapshotDigest, verifyProjectsPublicHtml } from '../scripts/verify-production-release.mjs';

const snapshot = loadCandidateProjectSnapshot();
const digest = projectSnapshotDigest(snapshot);
const [card] = snapshot.boards[1].cards;
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const page = (body = '<p>Projects is private.</p>') => `<html><head><meta name="robots" content="noindex, nofollow"></head><body>${body}</body></html>`;

test('the release identity binds the owner snapshot the function serves', () => {
  assert.match(digest, /^[0-9a-f]{64}$/u);
  assert.ok(snapshot.boards.flatMap((board) => board.cards).length > 300);
  const reordered = { boards: snapshot.boards, sourceKind: snapshot.sourceKind, publicationReady: snapshot.publicationReady,
    preparedAt: snapshot.preparedAt, schema: snapshot.schema };
  assert.equal(projectSnapshotDigest(reordered), digest, 'stable under key order');
  assert.notEqual(projectSnapshotDigest({ ...snapshot, preparedAt: 'x' }), digest, 'sensitive to content');
});

test('release Projects assertion accepts only a noindex shell with no board data', () => {
  assert.deepEqual(verifyProjectsPublicHtml(page(), digest, snapshot), { noindex: true, boardCount: 0, publicCardCount: 0 });
  for (const html of [
    page().replace('noindex', 'index'),
    page(`<button class="project-card" type="button"><h3>x</h3></button>`),
    page(`<button class="project-tab"><span>Mazer</span><strong>219</strong></button>`),
    page(`<h3>${escape(card.title)}</h3>`),
    page(`<span>${card.id}</span>`),
  ]) assert.throws(() => verifyProjectsPublicHtml(html, digest, snapshot), /no board data/u);
});

test('an injected snapshot is accepted only when it hashes to the identity digest', () => {
  const smaller = { ...snapshot, boards: snapshot.boards.map((board, index) => index === 0 ? { ...board, cards: board.cards.slice(0, 2) } : board) };
  assert.doesNotThrow(() => verifyProjectsPublicHtml(page(), projectSnapshotDigest(smaller), smaller));
  assert.throws(() => verifyProjectsPublicHtml(page(), digest, smaller), /identity digest/u);
  assert.throws(() => verifyProjectsPublicHtml(page(), 'not-a-digest', snapshot), /identity digest/u);
});

// Skipped when no static build exists (a clean checkout runs this suite before the build). The verify
// chain runs `npm run test:owner-board-static` right after the build, which scans all of out/ and fails.
test('the built static Projects page contains no board data', { skip: !existsSync('out/projects.html') }, () => {
  const html = readFileSync('out/projects.html', 'utf8');
  assert.deepEqual(verifyProjectsPublicHtml(html, digest), { noindex: true, boardCount: 0, publicCardCount: 0 });
});

test('the static-export scan finds owner board text in any file type and passes a clean export', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'owner-static-'));
  try {
    mkdirSync(path.join(root, '_next'), { recursive: true });
    writeFileSync(path.join(root, 'index.html'), '<p>nothing here</p>');
    assert.deepEqual(scanForOwnerBoard(root, snapshot), { hits: [], scanned: 1 });
    for (const [name, body] of [['_next/chunk.js', `var a="${card.title}"`], ['page.txt', card.id],
      ['payload.json', JSON.stringify({ t: card.title.replaceAll('&', '&amp;') })]]) {
      writeFileSync(path.join(root, name), body);
      assert.ok(scanForOwnerBoard(root, snapshot).hits.some((hit) => hit.file === path.normalize(name)), name);
      rmSync(path.join(root, name));
    }
  } finally { rmSync(root, { force: true, recursive: true }); }
});
