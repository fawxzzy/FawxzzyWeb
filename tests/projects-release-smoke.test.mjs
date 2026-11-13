import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

// Skipped only when no static build exists; `npm run build` precedes this suite in a full verify run.
test('the built static Projects page contains no board data', { skip: !existsSync('out/projects.html') }, () => {
  const html = readFileSync('out/projects.html', 'utf8');
  assert.deepEqual(verifyProjectsPublicHtml(html, digest), { noindex: true, boardCount: 0, publicCardCount: 0 });
});
