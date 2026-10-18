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
  const privateCardCalls: string[] = [];
  await page.route('https://**/*', (route) => { external.push(new URL(route.request().url()).origin); return route.abort(); });
  await page.route('http://127.0.0.1:3210/api/projects/private-card', (route) => {
    privateCardCalls.push(route.request().method()); return route.abort();
  });
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
  return { calls, external, privateCardCalls, setDenied(value: boolean) { denied = value; } };
}

async function selectWebBoard(page: Page, afterFakeClock = false) {
  const button = page.getByRole('navigation', { name: 'Project boards' }).getByRole('button', { name: /Fawxzzy Web/u });
  // Playwright's installed clock can leave WebKit's action-stability timer paused after reload.
  if (afterFakeClock) await button.evaluate((element: HTMLButtonElement) => element.click());
  else await button.click();
}

test('signed-out Projects keeps public boards separate from the dormant private Web slot', async ({ page }) => {
  const fixture = await privateFixture(page);
  const response = await page.request.get('/projects?auth_test=success');
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain(title);
  await page.goto('/projects?auth_test=success');
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Project boards' }).getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('region', { name: 'Private project cards' })).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Private projects' })).toHaveCount(0);
  await selectWebBoard(page);
  await expect(page.getByRole('region', { name: 'Private projects' }).getByRole('link', { name: 'Sign in' }))
    .toHaveAttribute('href', '/login?returnTo=%2Fprojects');
  await page.getByRole('navigation', { name: 'Project boards' }).getByRole('button', { name: /Mazer/u }).click();
  await expect(page.getByRole('region', { name: 'Private projects' })).toHaveCount(0);
  expect(fixture.calls).toEqual([]);
  expect(fixture.privateCardCalls).toEqual([]);
  expect(fixture.external).toEqual([]);
});

test('verified owner sees pending Web card state, never the legacy Operations fixture', async ({ page }) => {
  const fixture = await privateFixture(page);
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateCards = page.getByRole('region', { name: 'Private project cards' });
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  await expect(privateCards).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);
  expect(fixture.privateCardCalls).toEqual([]);
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Projects' })).toBeVisible();
  expect(fixture.calls).toEqual([
    'GET /api/operations/read', 'POST /api/operations/session', 'GET /api/operations/read',
  ]);
  expect(await page.locator('body').innerText()).not.toContain('local-session-oauth-token');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(title);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(privateArea.getByRole('status')).not.toContainText("You're signed in");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  expect(fixture.calls).toEqual([
    'GET /api/operations/read', 'POST /api/operations/session', 'GET /api/operations/read',
    'GET /api/operations/read',
  ]);
  await expect(privateCards).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);
  expect(fixture.external).toEqual([]);
});

test('foreign account gets no private Web card or open retry loop', async ({ page }) => {
  const fixture = await privateFixture(page, { deny: true });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(privateArea.getByRole('status')).toContainText('Private access is not available');
  await expect(page.getByRole('region', { name: 'Private project cards' })).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);
  expect(fixture.calls).toEqual(['GET /api/operations/read']);
  expect(fixture.privateCardCalls).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  expect(fixture.calls).toEqual(['GET /api/operations/read']);
  expect(fixture.external).toEqual([]);
});

test('expiry, Auth change and revocation clear verified Web state without legacy payload', async ({ page }) => {
  await page.clock.install();
  const fixture = await privateFixture(page);
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  const privateCards = page.getByRole('region', { name: 'Private project cards' });
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  await expect(privateCards).toHaveCount(0);
  await page.clock.fastForward(60_001);
  await expect(privateCards).toHaveCount(0);
  await expect(privateArea.getByRole('status')).not.toContainText("You're signed in");
  expect(fixture.calls).toHaveLength(3);
  await page.getByRole('button', { name: 'Refresh private work' }).click();
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  await page.clock.resume();
  await page.reload();
  await selectWebBoard(page, true);
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  await page.evaluate(() => {
    localStorage.setItem('fawxzzy.account.auth-generation.v1', 'changed-in-local-fixture');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fawxzzy.account.auth-generation.v1' }));
  });
  await expect(privateArea.getByRole('status')).not.toContainText("You're signed in");
  await expect(privateCards).toHaveCount(0);
  fixture.setDenied(true);
  await page.reload();
  await selectWebBoard(page, true);
  await expect(page.getByRole('region', { name: 'Private projects' }).getByRole('status')).toContainText('Private access is not available');
  await expect(privateCards).toHaveCount(0);
  const html = await (await page.request.get('/projects?auth_test=session')).text();
  expect(html).not.toContain(title);
  expect(html).not.toContain(privateView.cards[0].stable_id);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(title);
  expect(stored).not.toContain(privateView.cards[0].stable_id);
  expect(fixture.privateCardCalls).toEqual([]);
  expect(fixture.external).toEqual([]);
});
