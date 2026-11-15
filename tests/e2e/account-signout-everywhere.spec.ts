import { expect, test, type Browser, type Page } from "@playwright/test";
import { AUTH_COPY, AUTH_MESSAGES } from "../../src/lib/auth/copy-matrix";

/**
 * Sign out everywhere on the account page: a link in the links row, a two-step confirm inside the one
 * notice box (no browser dialog), global scope at the provider, and the done line on the portal
 * sign-in. A failure keeps the person signed in with the unavailable line. Local test adapter only.
 */
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, deviceScaleFactor: 3 },
  { name: "320x568", width: 320, height: 568, deviceScaleFactor: 2 },
] as const;

const link = (page: Page) => page.locator("[data-sign-out-everywhere]");
const notice = (page: Page) => page.locator("#auth-notice");

async function phone(browser: Browser, viewport: (typeof VIEWPORTS)[number]) {
  const context = await browser.newContext({
    deviceScaleFactor: viewport.deviceScaleFactor,
    hasTouch: true,
    isMobile: true,
    viewport: { height: viewport.height, width: viewport.width },
  });
  return { context, page: await context.newPage() };
}

/** Everything that would move if the screen jumped: page scroll, body scroll, the links row and the dock. */
async function layout(page: Page) {
  return page.evaluate(() => ({
    bodyScroll: document.querySelector(".auth-body")?.scrollTop ?? -1,
    dockTop: Math.round(document.querySelector(".auth-dock")?.getBoundingClientRect().top ?? -1),
    linksTop: Math.round(document.querySelector(".auth-links")?.getBoundingClientRect().top ?? -1),
    linksHeight: Math.round(document.querySelector(".auth-links")?.getBoundingClientRect().height ?? -1),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    resetLeft: Math.round(document.querySelector(".auth-links a")?.getBoundingClientRect().left ?? -1),
    scrollY: window.scrollY,
    slotHeight: Math.round(document.querySelector("[data-auth-slot]")?.getBoundingClientRect().height ?? -1),
  }));
}

for (const viewport of VIEWPORTS) {
  test(`sign out everywhere asks in the notice box, then lands on sign in (${viewport.name})`, async ({ baseURL, browser }) => {
    const { context, page } = await phone(browser, viewport);
    await context.addCookies([{ name: "fawxzzy_owner_hint", url: baseURL!, value: "1" }]);
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await page.goto("/account?auth_test=session");
    await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();

    // One row: Reset password | Sign out everywhere, on a single line, 44 px tall targets.
    await expect(link(page)).toHaveAccessibleName(AUTH_COPY.link.signOutEverywhere);
    const reset = await page.locator(".auth-links a").boundingBox();
    const everywhere = await link(page).boundingBox();
    expect(Math.abs(reset!.y - everywhere!.y)).toBeLessThan(2);
    expect(everywhere!.height).toBeGreaterThanOrEqual(44);
    expect(everywhere!.x + everywhere!.width).toBeLessThanOrEqual(viewport.width);
    const before = await layout(page);
    expect(before.overflowX).toBe(false);

    // Step 1: nothing is signed out yet; the notice box asks, focus moves to its action.
    await link(page).click();
    await expect(notice(page)).toHaveAttribute("data-notice-id", "account.everywhereconfirm");
    await expect(notice(page)).toHaveAttribute("role", "status");
    await expect(notice(page)).toContainText(AUTH_MESSAGES["account.everywhereconfirm"][1]);
    const confirm = notice(page).getByRole("button", { name: AUTH_COPY.link.signOutEverywhere });
    await expect(confirm).toBeFocused();
    await expect(link(page)).toHaveAccessibleName(AUTH_COPY.link.cancel);
    await expect(page.locator("html")).not.toHaveAttribute("data-sign-out-scope", /.+/);
    expect(await layout(page)).toEqual(before);
    const box = await confirm.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    // Cancel puts everything back.
    await link(page).click();
    await expect(notice(page)).toHaveCount(0);
    await expect(link(page)).toHaveAccessibleName(AUTH_COPY.link.signOutEverywhere);
    expect(await layout(page)).toEqual(before);

    // Step 2: global scope, owner hint cleared, then the portal sign-in with the done line.
    await page.evaluate(() => {
      new MutationObserver(() => {
        const scope = document.documentElement.dataset.signOutScope;
        if (scope) window.sessionStorage.setItem("test-sign-out-scope", scope);
      }).observe(document.documentElement, { attributes: true });
    });
    await link(page).click();
    // The harness keeps itself (`auth_test=success`, signed out); the real destination is `/login?notice=everywhere`.
    // The sign-in screen drops `notice` from the address once read, so check the request that landed there.
    const landing = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname.startsWith("/login"));
    await notice(page).getByRole("button", { name: AUTH_COPY.link.signOutEverywhere }).click();
    expect(new URL((await landing).url()).searchParams.getAll("notice")).toEqual(["everywhere"]);
    await expect(page.locator('[data-auth-surface="credentials"]')).toBeVisible();
    await expect(page.locator('[data-notice-id="signin.everywhere"]')).toHaveText(AUTH_MESSAGES["signin.everywhere"][1]);
    expect(await page.evaluate(() => window.sessionStorage.getItem("test-sign-out-scope"))).toBe("everywhere");
    const cookies = await context.cookies(baseURL!);
    expect(cookies.find((cookie) => cookie.name === "fawxzzy_owner_hint")).toBeUndefined();
    expect((await layout(page)).overflowX).toBe(false);
    expect(dialogs).toBe(0);
    await context.close();
  });
}

test("a failed sign out everywhere keeps the person signed in with the unavailable line", async ({ page }) => {
  await page.goto("/account?auth_test=signout-everywhere-fail");
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await link(page).click();
  await notice(page).getByRole("button", { name: AUTH_COPY.link.signOutEverywhere }).click();
  await expect(notice(page)).toHaveAttribute("data-notice-id", "change.unavailable");
  await expect(notice(page)).toHaveText(AUTH_MESSAGES["change.unavailable"][1]);
  await expect(notice(page)).toHaveAttribute("role", "alert");
  await expect(page).toHaveURL(/\/account\?/);
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await expect(page.getByLabel(AUTH_COPY.field.email, { exact: true })).toHaveValue("preview.user@example.test");
  await expect(link(page)).toHaveAccessibleName(AUTH_COPY.link.signOutEverywhere);
  await expect(link(page)).toBeEnabled();
  await expect(page.locator(".auth-dock__button")).toHaveText(AUTH_COPY.button.signOut);
});

test("starting a change drops a pending confirm", async ({ page }) => {
  await page.goto("/account?auth_test=session");
  await link(page).click();
  await expect(notice(page)).toHaveAttribute("data-notice-id", "account.everywhereconfirm");
  await page.getByRole("button", { name: AUTH_COPY.aria.changeEmail }).click();
  await expect(page.locator('[data-auth-surface="account-change"]')).toBeVisible();
  await page.getByRole("button", { name: AUTH_COPY.link.cancel }).click();
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await expect(link(page)).toHaveAccessibleName(AUTH_COPY.link.signOutEverywhere);
});

test("no account screen without a session offers sign out everywhere", async ({ page }) => {
  await page.goto("/account?auth_test=error");
  await expect(page.locator('[data-notice-id="account.loadfail"]')).toBeVisible();
  await expect(link(page)).toHaveCount(0);
});
