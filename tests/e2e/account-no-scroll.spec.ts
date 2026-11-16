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

// Callback and confirm links without a code replace themselves with sign in plus a notice
// (Auth Surface v2), so settle waits out that one navigation before measuring.
async function retryAcrossNavigation<T>(page: Page, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.waitForLoadState("load");
      return await run();
    } catch (error) {
      const navigating = String(error).includes("Execution context was destroyed");
      if (attempt >= 5 || !navigating) throw error;
    }
  }
}

// A late client redirect can land between any two evaluates (seen on mobile-webkit under workers=3),
// so settle waits until the URL has held still for a quiet window, and every later page.evaluate
// is wrapped to retry once the replacement document has loaded.
async function settle(page: Page) {
  let last = "";
  let stableSince = Date.now();
  while (Date.now() - stableSince < 600) {
    await retryAcrossNavigation(page, () => page.evaluate(() => document.fonts.ready.then(() => true)));
    const url = page.url();
    if (url !== last) {
      last = url;
      stableSince = Date.now();
    }
    await page.waitForTimeout(100);
  }
}

async function measure(page: Page) {
  return retryAcrossNavigation(page, () => page.evaluate(() => {
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
      // A form body that overflows at rest hides part of a field; it may only scroll when a keyboard is up.
      formBodyOverflow: (() => {
        const body = document.querySelector<HTMLElement>(".auth-body");
        return body ? body.scrollHeight - body.clientHeight : 0;
      })(),
    };
  }));
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
          expect(m.formBodyOverflow, `${label}: the form is clipped`).toBeLessThanOrEqual(1);
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

// Auth Surface v2: ONE notice box in a fixed, reserved slot. Showing the longest notices must not
// move a field, the links or the dock, must not clip the notice, and must not scroll the page.
const NOTICE_CASES = [
  {
    name: "sign in, throttled (longest sign-in line)",
    path: "/login?auth_test=login-throttled",
    fill: async (page: Page) => {
      await page.locator("#account-email").fill("someone");
      await page.locator("#account-password").fill("long-enough-password");
    },
    notice: "signin.throttled",
  },
  {
    name: "create account, invalid username",
    path: "/login?intent=signup&auth_test=success",
    fill: async (page: Page) => {
      await page.locator("#account-username").fill("a b");
    },
    notice: "signup.userinvalid",
  },
  {
    name: "reset request, invalid username",
    path: "/reset-password?auth_test=success",
    fill: async (page: Page) => {
      await page.locator("#account-reset-username").fill("a b");
    },
    notice: "signup.userinvalid",
  },
  {
    name: "reset request by username, sent",
    path: "/reset-password?auth_test=success",
    fill: async (page: Page) => {
      await page.locator("#account-reset-username").fill("someone");
    },
    notice: "reset.sentuser",
  },
  {
    name: "legacy reset request, invalid email",
    path: "/reset-password?auth_test=reset-email-legacy",
    fill: async (page: Page) => {
      await page.locator("#account-reset-email").fill("nope");
    },
    notice: "signup.emailinvalid",
  },
] as const;

async function layout(page: Page) {
  return retryAcrossNavigation(page, () => page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { bottom: Math.round(rect.bottom), height: Math.round(rect.height), top: Math.round(rect.top) };
    };
    return {
      dock: box(".auth-dock__button"),
      fields: [...document.querySelectorAll(".auth-field")].map((field) => {
        const rect = field.getBoundingClientRect();
        return Math.round(rect.top);
      }),
      links: box(".auth-links"),
      slot: box("[data-auth-slot]"),
      title: box(".auth-title"),
    };
  }));
}

for (const noticeCase of NOTICE_CASES) {
  test(`320x568: ${noticeCase.name} shows in the reserved slot without moving anything`, async ({ browser }, testInfo) => {
    const context = await newContext(browser, { deviceScaleFactor: 2, height: 568, mobile: true, name: "320x568", width: 320 }, true);
    try {
      const page = await context.newPage();
      await page.goto(noticeCase.path);
      await settle(page);
      await expect(page.locator("[data-auth-slot]")).toBeVisible();
      await noticeCase.fill(page);
      const before = await layout(page);
      await page.locator(".auth-dock__button").click();
      const notice = page.locator(`[data-notice-id="${noticeCase.notice}"]`);
      await expect(notice).toBeVisible();
      const after = await layout(page);
      expect(after, "a notice must not move the title, fields, links or dock").toEqual(before);
      // Never clipped: the whole box sits inside its slot and inside the viewport, with no hidden overflow.
      const fit = await notice.evaluate((element) => {
        const slot = element.closest("[data-auth-slot]")!.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const text = element.querySelector(".auth-notice__text")!;
        return {
          insideSlot: rect.top >= slot.top - 0.5 && rect.bottom <= slot.bottom + 0.5,
          insideViewport: rect.bottom <= window.innerHeight && rect.right <= window.innerWidth && rect.left >= 0,
          textFits: text.scrollHeight <= text.clientHeight + 1,
        };
      });
      expect(fit).toEqual({ insideSlot: true, insideViewport: true, textFits: true });
      const m = await measure(page);
      expect(m.scrollHeight).toBeLessThanOrEqual(m.innerHeight + 1);
      expect(m.scrolledTo).toBe(0);
      await testInfo.attach(`${noticeCase.notice}-320x568`, { body: await page.screenshot(), contentType: "image/png" });
    } finally {
      await context.close();
    }
  });
}

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
