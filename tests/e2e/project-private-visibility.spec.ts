import { expect, test, type Page } from '@playwright/test';

const title = 'PRIVATE_ZAC_CARD_TITLE <img src=x onerror=alert(1)>';
const producer = 'github-repository:1301080630';
const privateView = {
  health: 'healthy', authoritative: true, actions_enabled: false,
  projection_revision: `sha256:${'a'.repeat(64)}`,
  source_watermark: [{ producer_identity: producer, source_revision: 'b'.repeat(40) }],
  cards: [{ stable_id: `card:${Buffer.from(producer).toString('base64url')}:fixture`,
    title, lifecycle: 'review', owner_role: 'fixture.owner',
    created_at: '2026-10-15T12:00:00Z', updated_at: '2026-10-15T12:00:00Z',
    dependency_ids: [], blocker_codes: [], evidence_handles: [], supersedes_id: null }],
};

async function privateFixture(page: Page, { deny = false } = {}) {
  let opened = false;
  let denied = deny;
  const calls: string[] = [];
  const external: string[] = [];
  await page.route('https://**/*', (route) => { external.push(new URL(route.request().url()).origin); return route.abort(); });
  await page.route('http://127.0.0.1:3210/api/operations/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push(`${request.method()} ${path}`);
    expect(request.headers()['x-fawxzzy-operations']).toBe('1');
    expect(request.headers().authorization).toBe('Bearer local-session-oauth-token-1234567890');
    const headers = { 'Cache-Control': 'no-store, max-age=0' };
    if (denied) {
      await route.fulfill({ status: 403, headers, json: { error: 'OPS_ACCESS_DENIED' } });
    } else if (request.method() === 'GET' && !opened) {
      await route.fulfill({ status: 403, headers, json: { error: 'OPS_SESSION_MISSING' } });
    } else if (request.method() === 'POST') {
      opened = true;
      await route.fulfill({ status: 204, headers });
    } else {
      await route.fulfill({ status: 200, headers, json: privateView });
    }
  });
  return { calls, external, setDenied(value: boolean) { denied = value; } };
}

test('Projects stays visible signed out; HTML and public boards contain no private card', async ({ page }) => {
  const fixture = await privateFixture(page);
  const response = await page.request.get('/projects?auth_test=success');
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain(title);
  await page.goto('/projects?auth_test=success');
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Project boards' }).getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('region', { name: 'Private project cards' })).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Private projects' }).getByRole('link', { name: 'Sign in' }))
    .toHaveAttribute('href', '/login?returnTo=%2Fprojects');
  expect(fixture.calls).toEqual([]);
  expect(fixture.external).toEqual([]);
});

test('verified owner sees private cards automatically on the same Projects page; leaving clears them', async ({ page }) => {
  const fixture = await privateFixture(page);
  await page.goto('/projects?auth_test=session');
  const privateCards = page.getByRole('region', { name: 'Private project cards' });
  await expect(privateCards.getByRole('heading', { name: title })).toBeVisible();
  await expect(privateCards.locator('img')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' })).toBeVisible();
  expect(fixture.calls).toEqual([
    'GET /api/operations/read', 'POST /api/operations/session', 'GET /api/operations/read',
  ]);
  expect(await page.locator('body').innerText()).not.toContain('local-session-oauth-token');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(title);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(privateCards).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(privateCards.getByRole('heading', { name: title })).toBeVisible();
  expect(fixture.calls).toEqual([
    'GET /api/operations/read', 'POST /api/operations/session', 'GET /api/operations/read',
    'GET /api/operations/read',
  ]);
  expect(fixture.external).toEqual([]);
});

test('another signed-in account gets no private card or count and cannot cause an open retry loop', async ({ page }) => {
  const fixture = await privateFixture(page, { deny: true });
  await page.goto('/projects?auth_test=session');
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(privateArea.getByRole('status')).toContainText('Private access is not available');
  await expect(page.getByRole('region', { name: 'Private project cards' })).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);
  expect(fixture.calls).toEqual(['GET /api/operations/read']);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  expect(fixture.calls).toEqual(['GET /api/operations/read']);
  expect(fixture.external).toEqual([]);
});

test('expiry, changed Auth generation and revoked access erase private data without shared-page leakage', async ({ page }) => {
  await page.clock.install();
  const fixture = await privateFixture(page);
  await page.goto('/projects?auth_test=session');
  const privateCards = page.getByRole('region', { name: 'Private project cards' });
  await expect(privateCards.getByRole('heading', { name: title })).toBeVisible();
  await page.clock.fastForward(60_001);
  await expect(privateCards).toHaveCount(0);
  expect(fixture.calls).toHaveLength(3);
  await page.getByRole('button', { name: 'Refresh private work' }).click();
  await expect(privateCards.getByRole('heading', { name: title })).toBeVisible();
  await page.reload();
  await expect(privateCards.getByRole('heading', { name: title })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('fawxzzy.account.auth-generation.v1', 'changed-in-local-fixture');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fawxzzy.account.auth-generation.v1' }));
  });
  await expect(privateCards).toHaveCount(0);
  fixture.setDenied(true);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Private projects' }).getByRole('status')).toContainText('Private access is not available');
  await expect(privateCards).toHaveCount(0);
  const html = await (await page.request.get('/projects?auth_test=session')).text();
  expect(html).not.toContain(title);
  expect(html).not.toContain(privateView.cards[0].stable_id);
  expect(fixture.external).toEqual([]);
});
