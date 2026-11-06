import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { expectedProjectsBoards, loadCandidateProjectSnapshot, projectSnapshotDigest, verifyProjectsPublicHtml } from '../scripts/verify-production-release.mjs';

const snapshot = loadCandidateProjectSnapshot();
const digest = projectSnapshotDigest(snapshot);
const boards = expectedProjectsBoards(snapshot);
const done = new Set(['completed', 'complete', 'closed', 'archived', 'retired']);
const open = snapshot.boards[0].cards.filter((card) => !done.has(card.lifecycle));
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const tabs = (list = boards) => list.map(({ name, count }) => `<button class="project-tab"><span>${name}</span><strong>${count}</strong></button>`).join('');
const cardsHtml = (list = open) => list.map((card) => `<button class="project-card" type="button"><h3>${escape(card.title)}</h3></button>`).join('');
const page = (body = cardsHtml(), list = boards) => `<html><head><meta name="robots" content="noindex, nofollow"></head><body>${tabs(list)}${body}</body></html>`;

test('expected boards come from the committed public snapshot', () => {
  assert.equal(boards.length, 4);
  assert.ok(boards.every(({ name, count }) => name && /^[1-9]\d*$/u.test(count)));
  assert.ok(open.length >= 1 && open.length < snapshot.boards[0].cards.length, 'default board has open and completed cards');
});

test('release Projects assertion requires the exact open cards of the snapshot default board', () => {
  assert.deepEqual(verifyProjectsPublicHtml(page(), digest, snapshot), { noindex: true, boardCount: 4, publicCardCount: open.length });
  const wrongCount = boards.map((board, index) => index === 0 ? { ...board, count: '0' } : board);
  for (const html of [page().replace('noindex', 'index'), page(''), page(cardsHtml(open.slice(1))),
    page(cardsHtml(open) + cardsHtml(open.slice(0, 1))), page(cardsHtml([{ title: 'Invented card' }, ...open.slice(1)])),
    page(`${cardsHtml()}FF-WEB-ANALYTICS-001`), page(`${cardsHtml()}FW-ANALYTICS-001`),
    page().replace(boards[3].name, 'Unreviewed board'), page(cardsHtml(), wrongCount), page(cardsHtml(), boards.slice(0, 3))]) {
    assert.throws(() => verifyProjectsPublicHtml(html, digest, snapshot));
  }
});

test('an injected snapshot is accepted only when it hashes to the identity digest', () => {
  const smaller = { ...snapshot, boards: snapshot.boards.map((board, index) => index === 0 ? { ...board, cards: board.cards.slice(0, 2) } : board) };
  const smallOpen = smaller.boards[0].cards.filter((card) => !done.has(card.lifecycle));
  const html = page(cardsHtml(smallOpen), expectedProjectsBoards(smaller));
  assert.equal(verifyProjectsPublicHtml(html, projectSnapshotDigest(smaller), smaller).publicCardCount, smallOpen.length);
  assert.throws(() => verifyProjectsPublicHtml(html, digest, snapshot));
  assert.throws(() => verifyProjectsPublicHtml(html, digest, smaller), /identity digest/u);
});

// Skipped only when no static build exists; `npm run build` precedes this suite in a full verify run.
test('the built Projects page satisfies the release assertion when a build exists', { skip: !existsSync('out/projects.html') }, () => {
  const result = verifyProjectsPublicHtml(readFileSync('out/projects.html', 'utf8'), digest);
  assert.equal(result.boardCount, 4);
  assert.equal(result.publicCardCount, open.length);
});

test('the snapshot digest is stable under key order and sensitive to content', () => {
  const reordered = { boards: snapshot.boards, sourceKind: snapshot.sourceKind, publicationReady: snapshot.publicationReady,
    preparedAt: snapshot.preparedAt, schema: snapshot.schema };
  assert.equal(projectSnapshotDigest(reordered), digest);
  assert.match(digest, /^[0-9a-f]{64}$/u);
  assert.notEqual(projectSnapshotDigest({ ...snapshot, preparedAt: 'x' }), digest);
});
