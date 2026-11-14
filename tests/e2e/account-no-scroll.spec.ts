import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * MAZER-ACCT-041: no account page scrolls the document at rest. The owner saw "a lot of room to
 * scroll" on the reset-password screen. Cause: body had min-height: 100vh while the screen is
 * sized with 100dvh; on iOS Safari 100vh is the viewport with the toolbars retracted, so it is
 * taller than what is visible and the document scrolled by the toolbar height (and rubber-banded).
 *
 * Headless browsers have no dynamic toolbar, so vh == dvh and the bug cannot show on its own. Every
 * route is therefore measured twice: as served, and with every stylesheet rewritten so that
 * 100vh = 100dvh + 90px, which is what iOS Safari reports while its toolbars are showing. Before
 * the fix the second pass overflowed by exactly 90px on the reset screen; the same pass now stays
 * inside the viewport.
 */
const IOS_TOOLBAR_PX = 90;

type ViewportSpec = {
  deviceScaleFactor: number;
  height: number;
  mobile: boolean;
  name: string;
  width: number;
};

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  { name: "360x740", width: 360, height: 740, deviceScaleFactor: 3, mobile: true },
  { name: "412x915", width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true },
  { name: "320x568", width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
  { name: "1280x720", width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
] satisfies ReadonlyArray<ViewportSpec>;

// Every account route (login, sign up, reset request, new password, auth confirm, auth callback,
// account home, Mazer consent, sign out) and the error page. Fixtures (`auth_test`) are only honored
// on the approved local test origins.
const ROUTES = [
  { name: "login", path: "/login?auth_test=success" },
  { name: "signup", path: "/login?intent=signup&auth_test=success" },
  { name: "reset-request", path: "/reset-password?auth_test=success" },
  { name: "reset-new-password", path: "/reset-password?recovery=1&auth_test=success&code=one-time-code" },
  { name: "auth-confirm", path: "/auth/confirm" },
  { name: "auth-callback", path: "/auth/callback" },
  { name: "account-home", path: "/account?auth_test=session" },
  { name: "oauth-authorize", path: "/oauth/authorize" },
  { name: "signout", path: "/signout?auth_test=pending" },
  { name: "signout-failed", path: "/signout?auth_test=error" },
  { name: "not-found", path: "/this-page-does-not-exist" },
] as const;

async function newContext(
  browser: import("@playwright/test").Browser,
  viewport: ViewportSpec,
  simulateIosToolbar: boolean,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    deviceScaleFactor: viewport.deviceScaleFactor,
    hasTouch: viewport.mobile,
    isMobile: viewport.mobile,
    viewport: { height: viewport.height, width: viewport.width },
  });
  if (simulateIosToolbar) {
    await context.route("**/*.css*", async (route) => {
      const response = await route.fetch();
      const css = (await response.text()).replace(/100vh/g, `calc(100dvh + ${IOS_TOOLBAR_PX}px)`);
      await route.fulfill({ response, body: css });
    });
  }
  return context;
}

async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    window.scrollTo(0, 10_000);
    const scrolledTo = window.scrollY;
    window.scrollTo(0, 0);
    return {
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      clientWidth: document.documentElement.clientWidth,
      htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      scrollWidth: document.documentElement.scrollWidth,
      scrolledTo,
    };
  });
}

// The iOS-toolbar pass runs on the phone sizes only (the desktop size has no dynamic toolbar).
for (const viewport of VIEWPORTS) {
  for (const simulateIosToolbar of viewport.mobile ? [false, true] : [false]) {
    const mode = simulateIosToolbar ? "iOS toolbar simulated" : "as served";
    test(`no account page scrolls at ${viewport.name} (${mode})`, async ({ browser }, testInfo) => {
      test.slow();
      const context = await newContext(browser, viewport, simulateIosToolbar);
      try {
        for (const route of ROUTES) {
          const page = await context.newPage();
          await page.goto(route.path);
          await settle(page);
          const m = await measure(page);
          const label = `${route.name} @ ${viewport.name} (${mode})`;
          expect(m.scrollHeight, `${label}: document taller than the viewport`).toBeLessThanOrEqual(m.innerHeight + 1);
          expect(m.scrollWidth, `${label}: document wider than the viewport`).toBeLessThanOrEqual(m.innerWidth + 1);
          expect(m.scrolledTo, `${label}: the page can be scrolled`).toBe(0);
          expect(m.htmlOverflowY, `${label}: html must not scroll`).toBe("hidden");
          expect(m.bodyOverflowY, `${label}: body must not scroll`).toBe("hidden");
          if (!simulateIosToolbar) {
            await testInfo.attach(`${route.name}-${viewport.name}`, {
              body: await page.screenshot(),
              contentType: "image/png",
            });
          }
          await page.close();
        }
      } finally {
        await context.close();
      }
    });
  }
}

test("a sign-up form with a problem list scrolls inside its card at 360x640, never the page", async ({ browser }, testInfo) => {
  test.slow();
  const context = await newContext(browser, { deviceScaleFactor: 3, height: 640, mobile: true, name: "360x640", width: 360 }, true);
  try {
    const page = await context.newPage();
    await page.goto("/login?intent=signup&auth_test=success");
    await settle(page);
    await page.locator('.account-auth-dock button[type="submit"]').click();
    await expect(page.locator(".account-auth-guidance")).toBeVisible();
    const m = await measure(page);
    expect(m.scrollHeight).toBeLessThanOrEqual(m.innerHeight + 1);
    expect(m.scrolledTo).toBe(0);
    // The action stays on screen, and the fields area is the thing that scrolls.
    const dock = await page.locator(".account-auth-dock").boundingBox();
    expect(dock && dock.y + dock.height).toBeLessThanOrEqual(m.innerHeight + 1);
    const region = await page.locator(".account-auth-body").evaluate((element) => ({
      client: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(["auto", "scroll"]).toContain(region.overflowY);
    await testInfo.attach("signup-with-problems-360x640", { body: await page.screenshot(), contentType: "image/png" });
  } finally {
    await context.close();
  }
});

test("the error page scrolls inside itself, not the document, when its content does not fit", async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 2, height: 400, mobile: true, name: "320x400", width: 320 }, true);
  try {
    const page = await context.newPage();
    await page.goto("/this-page-does-not-exist");
    await settle(page);
    const m = await measure(page);
    expect(m.scrollHeight).toBeLessThanOrEqual(m.innerHeight + 1);
    const inner = await page.locator("main.system-page").evaluate((element) => ({
      client: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scroll: element.scrollHeight,
    }));
    expect(inner.overflowY).toBe("auto");
    expect(inner.scroll).toBeGreaterThan(inner.client);
  } finally {
    await context.close();
  }
});
