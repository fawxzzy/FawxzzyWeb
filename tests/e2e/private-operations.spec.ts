import { test, expect, type Page } from '@playwright/test';

const producer = 'github-repository:1301080630';
const view = () => ({ health: 'healthy', authoritative: true, actions_enabled: false,
  projection_revision: `sha256:${'a'.repeat(64)}`,
  source_watermark: [{ producer_identity: producer, source_revision: 'b'.repeat(40) }],
  cards: [{ stable_id: `card:${Buffer.from(producer).toString('base64url')}:fixture`,
    title: 'Review <img src=x onerror=alert(1)> safely', lifecycle: 'review', owner_role: 'fixture.owner',
    created_at: '2026-10-15T12:00:00Z', updated_at: '2026-10-15T12:00:00Z',
    dependency_ids: [], blocker_codes: [], evidence_handles: ['evidence:abcdefghijklmnop'], supersedes_id: null }] });

async function fixture(page: Page) {
  const calls: string[] = []; let body = view(); let denied = false; let unavailable = false;
  // Existing loopback Auth fixture only. Any accidental provider request fails
  // the test and is aborted before a synthetic credential can leave the host.
  const external: string[] = [];
  await page.route('https://**/*', (route) => { external.push(new URL(route.request().url()).origin); return route.abort(); });
  await page.route('http://127.0.0.1:3210/api/operations/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); calls.push(`${request.method()} ${url.pathname}`);
    expect(request.headers()['x-fawxzzy-operations']).toBe('1');
    expect(request.headers().authorization).toBe('Bearer local-session-oauth-token-1234567890');
    expect(request.postData()).toBeNull(); expect(url.search).toBe('');
    if (unavailable) { await route.fulfill({ status: 503, json: { error: 'OPS_UNAVAILABLE' } }); return; }
    if (request.method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    await route.fulfill({ status: denied ? 403 : 200, json: denied ? { error: 'OPS_ACCESS_DENIED' } : body });
  });
  return { calls, external, setView(value: ReturnType<typeof view>) { body = value; },
    setDenied(value: boolean) { denied = value; }, setUnavailable(value: boolean) { unavailable = value; } };
}

test('signed-out shell is noindex, contains no work, and makes no operations requests', async ({ page }) => {
  const f = await fixture(page); await page.goto('/operations?auth_test=success');
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('button', { name: 'Open private session' })).toBeDisabled();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/u);
  await expect(page.getByRole('region', { name: 'Work overview' })).toHaveCount(0);
  expect(f.calls).toEqual([]); expect(f.external).toEqual([]);
});

test('explicit open, refresh, escaped private cards and close render on the actual route', async ({ page }, info) => {
  // Match the repository's deterministic visual-evidence motion preference.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const f = await fixture(page); await page.goto('/operations?auth_test=session');
  const open = page.getByRole('button', { name: 'Open private session' }); await expect(open).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeInViewport({ ratio: 1 });
  expect(f.calls).toEqual([]); await open.click();
  await expect(page.getByRole('status')).toContainText('Private session opened');
  expect(f.calls).toEqual(['POST /api/operations/session']);
  await page.getByRole('button', { name: 'Refresh overview' }).click();
  await expect(page.getByRole('heading', { name: view().cards[0].title })).toBeVisible();
  await expect(page.locator('section[aria-label="Work overview"] img')).toHaveCount(0);
  await expect(page.getByText('Observed at', { exact: false })).toBeVisible();
  await page.getByText('Evidence references', { exact: true }).click();
  await expect(page.getByText('evidence:abcdefghijklmnop', { exact: true })).toBeVisible();
  await expect(page.locator('a[href*="evidence:"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('body').innerText()).not.toContain('local-session-oauth-token');
  const persisted = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(persisted).not.toContain(view().cards[0].title);
  expect(persisted).not.toContain('local-session-oauth-token');
  await page.getByText('evidence:abcdefghijklmnop', { exact: true }).evaluate((element) => element.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await expect(page.getByText('evidence:abcdefghijklmnop', { exact: true })).toBeInViewport({ ratio: 1 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('private-operations.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Close private session' }).click();
  await expect(page.getByRole('status')).toContainText('Private session closed');
  await expect(page.getByRole('region', { name: 'Work overview' })).toHaveCount(0);
  expect(f.calls).toEqual(['POST /api/operations/session', 'GET /api/operations/read', 'DELETE /api/operations/session']);
  expect(f.external).toEqual([]);
});

test('timed expiry and pagehide clear the rendered observation without background reads', async ({ page }) => {
  await page.clock.install(); const f = await fixture(page); await page.goto('/operations?auth_test=session');
  await page.getByRole('button', { name: 'Check access' }).click();
  await expect(page.getByRole('region', { name: 'Work overview' })).toBeVisible();
  await page.clock.fastForward(60_001);
  await expect(page.getByRole('region', { name: 'Work overview' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('observation expired'); expect(f.calls).toHaveLength(1);
  await page.getByRole('button', { name: 'Refresh overview' }).click();
  await expect(page.getByRole('region', { name: 'Work overview' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByRole('region', { name: 'Work overview' })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.getByRole('region', { name: 'Work overview' })).toHaveCount(0); expect(f.calls).toHaveLength(2);
  expect(f.external).toEqual([]);
});

test('denial, failed acknowledgment and explicit reconciliation never auto-open a session', async ({ page }) => {
  const f = await fixture(page); f.setDenied(true); await page.goto('/operations?auth_test=session');
  await page.getByRole('button', { name: 'Check access' }).click();
  await expect(page.getByRole('status')).toContainText('Private access is not available'); expect(f.calls).toHaveLength(1);
  f.setUnavailable(true); await page.getByRole('button', { name: 'Open private session' }).click();
  await expect(page.getByRole('status')).toContainText('outcome could not be confirmed');
  await expect(page.getByRole('button', { name: 'Open private session' })).toBeDisabled(); expect(f.calls).toHaveLength(2);
  f.setUnavailable(false); f.setDenied(false); await page.getByRole('button', { name: 'Check access' }).click();
  await expect(page.getByRole('region', { name: 'Work overview' })).toBeVisible();
  expect(f.calls).toEqual(['GET /api/operations/read', 'POST /api/operations/session', 'GET /api/operations/read']);
  expect(f.external).toEqual([]);
});

test('nonhealthy response and durable Auth change erase rendered work immediately', async ({ page }) => {
  const f = await fixture(page); await page.goto('/operations?auth_test=session');
  await page.getByRole('button', { name: 'Check access' }).click();
  await expect(page.getByRole('region', { name: 'Work overview' })).toBeVisible();
  f.setView({ health: 'stale', authoritative: false, actions_enabled: false, projection_revision: null,
    source_watermark: [], cards: [] } as unknown as ReturnType<typeof view>);
  await page.getByRole('button', { name: 'Refresh overview' }).click();
  await expect(page.getByRole('status')).toContainText('out of date');
  await expect(page.getByRole('region', { name: 'Work overview' })).toHaveCount(0);
  f.setView(view()); await page.getByRole('button', { name: 'Refresh overview' }).click();
  await expect(page.getByRole('region', { name: 'Work overview' })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('fawxzzy.account.auth-generation.v1', 'changed-in-local-fixture');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fawxzzy.account.auth-generation.v1' }));
  });
  await expect(page.getByRole('region', { name: 'Work overview' })).toHaveCount(0);
  expect(f.calls).toHaveLength(3); expect(f.external).toEqual([]);
});
