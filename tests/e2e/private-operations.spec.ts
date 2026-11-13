import { expect, test } from '@playwright/test';

test('legacy Operations URL only forwards to /projects and renders nothing about it or the work overview', async ({ page }) => {
  const response = await page.request.get('/operations');
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).not.toContain('Work overview');
  // The chunk list names a nav component, but no visible text may mention Projects.
  expect(html.replace(/<script[\s\S]*?<\/script>/gu, '')).not.toMatch(/Projects/u);
  const requested: string[] = [];
  await page.route('https://account.fawxzzy.com/**', (route) => { requested.push(route.request().url()); return route.abort(); });
  await page.goto('/operations', { waitUntil: 'commit' });
  // /operations forwards to /projects, which (with no account service here) forwards to the account origin.
  await expect.poll(() => requested).toContain('https://account.fawxzzy.com/projects');
});
