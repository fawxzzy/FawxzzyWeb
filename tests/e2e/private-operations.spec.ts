import { expect, test } from '@playwright/test';

test('legacy Operations URL opens the single Projects experience without private server HTML', async ({ page }) => {
  const response = await page.request.get('/operations');
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain('Work overview');
  await page.goto('/operations');
  await expect(page).toHaveURL(/\/projects$/u);
  await expect(page.getByRole('navigation', { name: 'Project boards' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toHaveCount(0);
});
