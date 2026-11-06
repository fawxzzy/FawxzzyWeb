import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { expectedProjectsBoards, verifyProjectsPublicHtml } from '../scripts/verify-production-release.mjs';

const boards = expectedProjectsBoards();
const tabs = (list = boards) => list.map(({ name, count }) => `<button class="project-tab"><span>${name}</span><strong>${count}</strong></button>`).join('');
const card = '<button class="project-card" type="button"><h3>Card</h3></button>';
const page = (body = card, list = boards) => `<html><head><meta name="robots" content="noindex, nofollow"></head><body>${tabs(list)}${body}</body></html>`;

test('expected boards come from the committed public snapshot', () => {
  assert.equal(boards.length, 4);
  assert.ok(boards.every(({ name, count }) => name && /^[1-9]\d*$/u.test(count)));
});

test('release Projects assertion accepts the published noindex board snapshot', () => {
  assert.deepEqual(verifyProjectsPublicHtml(page()), { noindex: true, boardCount: 4, publicCardCount: 1 });
  const wrongCount = boards.map((board, index) => index === 0 ? { ...board, count: '0' } : board);
  const tooMany = card.repeat(Number(boards[0].count) + 1);
  for (const html of [page().replace('noindex', 'index'), page(''), page(tooMany), page(`${card}FF-WEB-ANALYTICS-001`),
    page(`${card}FW-ANALYTICS-001`), page().replace(boards[3].name, 'Unreviewed board'),
    page(card, wrongCount), page(card, boards.slice(0, 3))]) {
    assert.throws(() => verifyProjectsPublicHtml(html));
  }
});

test('the built Projects page satisfies the release assertion when a build exists', { skip: !existsSync('out/projects.html') }, () => {
  const result = verifyProjectsPublicHtml(readFileSync('out/projects.html', 'utf8'));
  assert.equal(result.boardCount, 4);
  assert.ok(result.publicCardCount >= 1);
});
