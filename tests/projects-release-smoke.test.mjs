import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyProjectsPublicHtml } from '../scripts/verify-production-release.mjs';

const names = ['Fawxzzy Fitness', 'Mazer', 'Fawxzzy Web', 'Atlas Stack'];
const page = (body = '') => `<html><head><meta name="robots" content="noindex, nofollow"></head><body>${names.map((name) => `<button class="project-tab"><span>${name}</span><strong>0</strong></button>`).join('')}${body}</body></html>`;

test('release Projects assertion accepts only four empty noindex public boards', () => {
  assert.deepEqual(verifyProjectsPublicHtml(page()), { noindex: true, boardCount: 4, publicCardCount: 0 });
  for (const html of [page().replace('noindex', 'index'), page('<button class="project-card">Card</button>'),
    page('FF-WEB-ANALYTICS-001'), page().replace('Atlas Stack', 'Unreviewed board')]) {
    assert.throws(() => verifyProjectsPublicHtml(html));
  }
});
