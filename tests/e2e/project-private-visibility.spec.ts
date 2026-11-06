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

const boardRevision = 'sha256:39f3fd99ab531bd576dce3618e033d33762ba0d738bd23274eac97e9d2a921ad';
const cardTitle = 'FIRST_PRIVATE_CARD_TITLE';
const canonicalCard = (page: Page) => page.getByRole('region', { name: 'Canonical private project card' });
const privateCard = {
  stable_id: 'FF-WEB-ANALYTICS-001', version: 1, body_digest: `sha256:${'c'.repeat(64)}`, board: 'fawxzzyweb',
  board_revision: boardRevision, source_revision: '4495db9c42dcba75adf8ddeaf87ababd6485417f',
  title: cardTitle, summary: 'First private card summary.', lifecycle: 'planning',
};
type CardReply = 'absent' | 'valid' | 'denied' | 'unavailable' | 'mismatch';

const staleView = { health: 'stale', authoritative: false, actions_enabled: false,
  projection_revision: null, source_watermark: [], cards: [] };

async function privateFixture(page: Page, { deny = false, card = 'absent', hold = false, overview = 'healthy', keepClosed = false }:
  { deny?: boolean; card?: CardReply; hold?: boolean; overview?: 'healthy' | 'stale'; keepClosed?: boolean } = {}) {
  let opened = false;
  let releaseCard: () => void = () => undefined;
  const gate = hold ? new Promise<void>((resolve) => { releaseCard = resolve; }) : Promise.resolve();
  let denied = deny;
  const calls: string[] = [];
  const external: string[] = [];
  const privateCardCalls: string[] = [];
  // A build with NEXT_PUBLIC_FAWXZZY_ANALYTICS_URL baked (the analytics spec uses collector.invalid) legitimately
  // emits the signed-in Projects page view; that single sink is not an external leak, so it is not recorded here.
  await page.route('https://**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin !== 'https://collector.invalid') external.push(origin);
    return route.abort();
  });
  await page.route('http://127.0.0.1:3210/api/projects/private-card', async (route) => {
    privateCardCalls.push(route.request().method());
    await gate;
    const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
    // 'absent' models the reader RPC not being installed: the route cannot answer at all.
    if (card === 'valid') return route.fulfill({ status: 200, headers, json: privateCard });
    if (card === 'mismatch') return route.fulfill({ status: 200, headers, json: { ...privateCard, board: 'atlas-stack' } });
    if (card === 'denied') return route.fulfill({ status: 403, headers, json: { error: 'CARD_ACCESS_DENIED' } });
    if (card === 'unavailable') return route.fulfill({ status: 503, headers, json: { error: 'CARD_UNAVAILABLE' } });
    return route.abort();
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
      opened = !keepClosed;
      await route.fulfill({ status: 204, headers });
    } else if (keepClosed) {
      await route.fulfill({ status: 403, headers, json: { error: 'OPS_SESSION_MISSING' } });
    } else {
      await route.fulfill({ status: 200, headers, json: overview === 'stale' ? staleView : privateView });
    }
  });
  return { calls, external, privateCardCalls, releaseCard, setDenied(value: boolean) { denied = value; } };
}

// Playwright's installed clock can leave WebKit's action-stability (rAF) wait paused, so clock tests
// activate buttons directly instead of waiting for actionability.
async function refreshPrivateWork(page: Page) {
  await page.getByRole('button', { name: 'Refresh private work' }).evaluate((element: HTMLButtonElement) => element.click());
}

async function selectWebBoard(page: Page, afterFakeClock = false) {
  const button = page.getByRole('navigation', { name: 'Project boards' }).getByRole('button', { name: /Fawxzzy Web/u });
  // Playwright's installed clock can leave WebKit's action-stability timer paused after reload.
  if (afterFakeClock) await button.evaluate((element: HTMLButtonElement) => element.click());
  else await button.click();
}

test('main-site Projects offers only a plain sign-in link and never starts the private reader', async ({ page }) => {
  const foreign: string[] = [];
  // Serve the static export under the main-site origin; every other HTTPS origin is refused.
  await page.route('https://**/*', (route) => { foreign.push(new URL(route.request().url()).origin); return route.abort(); });
  await page.route('https://fawxzzy.com/**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:3210${url.pathname}${url.search}` }) });
  });
  await page.goto('https://fawxzzy.com/projects');
  await expect(page.locator('head > link[rel="canonical"]')).toHaveAttribute('href', 'https://fawxzzy.com/projects');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toHaveAttribute('href', '/projects');
  await expect(page.getByRole('navigation', { name: 'Project boards' }).getByRole('button')).toHaveCount(4);
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(privateArea.getByRole('link', { name: 'Sign in to see private work' }))
    .toHaveAttribute('href', 'https://account.fawxzzy.com/login?returnTo=%2Fprojects');
  await expect(privateArea.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Canonical private project card' })).toHaveCount(0);
  // The storefront listener may count the public page view; nothing else leaves the page, and
  // in particular the account origin is never contacted.
  expect(foreign.filter((origin) => origin !== 'https://collector.invalid')).toEqual([]);
});

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
  // The public boards now render real cards; WebKit can stall action stability on the taller page.
  await page.getByRole('navigation', { name: 'Project boards' }).getByRole('button', { name: /Mazer/u })
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.getByRole('region', { name: 'Private projects' })).toHaveCount(0);
  expect(fixture.calls).toEqual([]);
  expect(fixture.privateCardCalls).toEqual([]);
  expect(fixture.external).toEqual([]);
});

test('verified owner with no reader RPC sees the unchanged page, never the legacy Operations fixture', async ({ page }) => {
  const fixture = await privateFixture(page);
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateCards = page.getByRole('region', { name: 'Private project cards' });
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  await expect(privateCards).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);
  // Reader RPC absent: the page is exactly what it was before the card existed.
  await expect(privateArea.getByRole('status')).toContainText('Private project cards are not available yet.');
  await expect(page.getByRole('region', { name: 'Canonical private project card' })).toHaveCount(0);
  await expect(page.getByText('Private card unavailable')).toHaveCount(0);
  await expect(page.getByText('Checking the current private card')).toHaveCount(0);
  expect(fixture.privateCardCalls).toEqual(['GET']);
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

test('verified owner with a valid reader payload sees exactly the first private card', async ({ page }) => {
  const fixture = await privateFixture(page, { card: 'valid' });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  const card = page.getByRole('region', { name: 'Canonical private project card' });
  await expect(card.getByRole('heading', { name: cardTitle })).toBeVisible();
  await expect(card).toContainText('First private card summary.');
  await expect(card).toContainText('FF-WEB-ANALYTICS-001');
  await expect(privateArea.getByRole('status')).toContainText('Your private project card is shown below.');
  expect(fixture.privateCardCalls).toEqual(['GET']);
  // The card never reaches browser storage, and the legacy fixture stays out.
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(cardTitle);
  await expect(page.getByText(title)).toHaveCount(0);
  // Leaving the page (pagehide) clears it again.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByRole('region', { name: 'Canonical private project card' })).toHaveCount(0);
  expect(fixture.external).toEqual([]);
});

test('card text appears only after the owner fetch completes, never before', async ({ page }) => {
  // /projects is a static export, so the only meaningful boundary is the owner-authenticated fetch:
  // hold that response, prove the page shows no card text or region, then release it.
  const fixture = await privateFixture(page, { card: 'valid', hold: true });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(privateArea.getByRole('status')).toContainText('Private project cards are not available yet.');
  await expect.poll(() => fixture.privateCardCalls.length).toBe(1);
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  await expect(page.getByText('Checking the current private card')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain(cardTitle);
  fixture.releaseCard();
  await expect(canonicalCard(page)).toHaveCount(1);
  await expect(canonicalCard(page).getByRole('heading', { name: cardTitle })).toBeVisible();
});

test('a visible card clears when the tab is hidden and returns only after a fresh owner read', async ({ page }) => {
  const fixture = await privateFixture(page, { card: 'valid' });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  await expect(canonicalCard(page)).toHaveCount(1);
  expect(fixture.privateCardCalls).toHaveLength(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(canonicalCard(page)).toHaveCount(1);
  expect(fixture.privateCardCalls.length).toBeGreaterThan(1);
});

for (const reply of ['denied', 'unavailable', 'mismatch'] as const) {
  test(`owner session whose card read is ${reply} shows no private card and no new text`, async ({ page }) => {
    const fixture = await privateFixture(page, { card: reply });
    await page.goto('/projects?auth_test=session');
    await selectWebBoard(page);
    const privateArea = page.getByRole('region', { name: 'Private projects' });
    await expect(privateArea.getByRole('status')).toContainText('Private project cards are not available yet.');
    await expect.poll(() => fixture.privateCardCalls.length).toBe(1);
    await expect(page.getByRole('region', { name: 'Canonical private project card' })).toHaveCount(0);
    await expect(page.getByText(cardTitle)).toHaveCount(0);
    await expect(page.getByText('Private card unavailable')).toHaveCount(0);
    expect(fixture.external).toEqual([]);
  });
}

test('foreign account gets no private Web card or open retry loop', async ({ page }) => {
  const fixture = await privateFixture(page, { deny: true });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(privateArea.getByRole('status')).toContainText('Private access is not available');
  await expect(page.getByRole('region', { name: 'Private project cards' })).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Canonical private project card' })).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  expect(fixture.calls).toEqual(['GET /api/operations/read']);
  expect(fixture.privateCardCalls).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  expect(fixture.calls).toEqual(['GET /api/operations/read']);
  expect(fixture.external).toEqual([]);
});

test('expiry, Auth change and revocation clear verified Web state without legacy payload', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  // A VISIBLE valid card must render first; each event below must then clear it.
  const fixture = await privateFixture(page, { card: 'valid' });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  const privateCards = page.getByRole('region', { name: 'Private project cards' });
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  await expect(privateCards).toHaveCount(0);
  await expect(canonicalCard(page)).toHaveCount(1);
  await page.clock.fastForward(60_001);
  await expect(privateCards).toHaveCount(0);
  await expect(privateArea.getByRole('status')).not.toContainText("You're signed in");
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  expect(fixture.calls).toHaveLength(3);
  await refreshPrivateWork(page);
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  await expect(canonicalCard(page)).toHaveCount(1);
  await page.clock.resume();
  await page.reload();
  await selectWebBoard(page, true);
  await expect(privateArea.getByRole('status')).toContainText("You're signed in");
  await expect(canonicalCard(page)).toHaveCount(1);
  await page.evaluate(() => {
    localStorage.setItem('fawxzzy.account.auth-generation.v1', 'changed-in-local-fixture');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fawxzzy.account.auth-generation.v1' }));
  });
  // Auth generation change: the same bump a sign-out or user switch performs in the adapter.
  await expect(privateArea.getByRole('status')).not.toContainText("You're signed in");
  await expect(privateCards).toHaveCount(0);
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  fixture.setDenied(true);
  await page.reload();
  await selectWebBoard(page, true);
  // Revocation: the operations reader now denies, so the previously visible card must be gone.
  await expect(page.getByRole('region', { name: 'Private projects' }).getByRole('status')).toContainText('Private access is not available');
  await expect(privateCards).toHaveCount(0);
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  const html = await (await page.request.get('/projects?auth_test=session')).text();
  expect(html).not.toContain(title);
  expect(html).not.toContain(privateView.cards[0].stable_id);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(title);
  expect(stored).not.toContain(privateView.cards[0].stable_id);
  await expect(page.getByRole('region', { name: 'Canonical private project card' })).toHaveCount(0);
  expect(fixture.external).toEqual([]);
});

test('stale overview with an open session still shows the owner card and keeps the overview empty', async ({ page }) => {
  const fixture = await privateFixture(page, { card: 'valid', overview: 'stale' });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(canonicalCard(page).getByRole('heading', { name: cardTitle })).toBeVisible();
  await expect(privateArea.getByRole('status')).toContainText("You're signed in. Your private project card is shown below.");
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Private project cards' })).toHaveCount(0);
  expect(fixture.calls).toEqual(['GET /api/operations/read', 'POST /api/operations/session', 'GET /api/operations/read']);
  expect(fixture.privateCardCalls).toHaveLength(1);
  // Hiding the tab clears it; coming back reads fresh from the owner endpoint.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(canonicalCard(page)).toHaveCount(1);
  // The card only returned because the owner endpoint and the reader were actually read again.
  expect(fixture.privateCardCalls.length).toBeGreaterThan(1);
  expect(fixture.calls.filter((call) => call === 'GET /api/operations/read').length).toBeGreaterThan(2);
  expect(fixture.external).toEqual([]);
});

test('stale overview card is bounded to 60 seconds and returns only after an explicit re-read', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  const fixture = await privateFixture(page, { card: 'valid', overview: 'stale' });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  await expect(canonicalCard(page)).toHaveCount(1);
  const cardReads = fixture.privateCardCalls.length;
  const overviewReads = fixture.calls.length;
  await page.clock.fastForward(60_001);
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  expect(fixture.calls).toHaveLength(overviewReads); // expiry never polls
  await refreshPrivateWork(page);
  await expect(canonicalCard(page)).toHaveCount(1);
  expect(fixture.privateCardCalls.length).toBeGreaterThan(cardReads);
  expect(fixture.calls.length).toBeGreaterThan(overviewReads);
});

test('stale overview card clears when the owner session is revoked on return', async ({ page }) => {
  const fixture = await privateFixture(page, { card: 'valid', overview: 'stale' });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  await expect(canonicalCard(page)).toHaveCount(1);
  fixture.setDenied(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(canonicalCard(page)).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.getByRole('region', { name: 'Private projects' }).getByRole('status')).toContainText('Private access is not available');
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
});

test('stale overview with a closed session shows no card and never reads one', async ({ page }) => {
  const fixture = await privateFixture(page, { card: 'valid', overview: 'stale', keepClosed: true });
  await page.goto('/projects?auth_test=session');
  await selectWebBoard(page);
  const privateArea = page.getByRole('region', { name: 'Private projects' });
  await expect(privateArea.getByRole('status')).toContainText('Opening your private session');
  await expect.poll(() => fixture.calls.length).toBe(3);
  await expect(canonicalCard(page)).toHaveCount(0);
  await expect(page.getByText(cardTitle)).toHaveCount(0);
  expect(fixture.privateCardCalls).toEqual([]);
  expect(fixture.external).toEqual([]);
});
