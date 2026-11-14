import { expect, test, type Page } from "@playwright/test";
import { captchaOptions, waitForCaptchaToken } from "../../src/lib/auth/captcha";
import { turnstileConfig } from "../../src/config/turnstile";

test("captchaOptions only carries a non-empty token", () => {
  expect(captchaOptions("abc")).toEqual({ captchaToken: "abc" });
  expect(captchaOptions("  abc  ")).toEqual({ captchaToken: "abc" });
  expect(captchaOptions("")).toEqual({});
  expect(captchaOptions(undefined)).toEqual({});
  expect(captchaOptions(null)).toEqual({});
});

test("waitForCaptchaToken resolves ready, unavailable, and timed-out sources without hanging", async () => {
  expect(await waitForCaptchaToken({ peek: () => "t", isUnavailable: () => false }, 1_000)).toBe("t");
  expect(await waitForCaptchaToken({ peek: () => undefined, isUnavailable: () => true }, 1_000)).toBeUndefined();
  const started = Date.now();
  expect(await waitForCaptchaToken({ peek: () => undefined, isUnavailable: () => false }, 250, 25)).toBeUndefined();
  expect(Date.now() - started).toBeLessThan(2_000);
  let calls = 0;
  expect(await waitForCaptchaToken({ peek: () => (++calls > 2 ? "late" : undefined), isUnavailable: () => false }, 1_000, 10)).toBe("late");
});

test("turnstile config uses the public site key and the Cloudflare origin only", () => {
  expect(turnstileConfig.siteKey).toMatch(/^0x4[A-Za-z0-9_-]+$/);
  expect(turnstileConfig.scriptSrc.startsWith(`${turnstileConfig.scriptOrigin}/`)).toBe(true);
});

async function stubTurnstile(page: Page, mode: "ok" | "broken") {
  await page.addInitScript((m) => {
    const w = window as unknown as Record<string, unknown>;
    w.__turnstile = { renders: 0, resets: 0 };
    w.turnstile = {
      render(container: HTMLElement, options: { callback: (t: string) => void }) {
        (w.__turnstile as { renders: number }).renders += 1;
        if (m === "broken") throw new Error("widget failed");
        container.setAttribute("data-stub-widget", "1");
        options.callback("stub-token");
        return "w1";
      },
      reset() {
        (w.__turnstile as { resets: number }).resets += 1;
      },
      remove() {},
    };
  }, mode);
}

for (const route of ["/login", "/login?intent=signup", "/reset-password"]) {
  test(`widget renders on ${route}`, async ({ page }) => {
    await stubTurnstile(page, "ok");
    await page.goto(`${route}${route.includes("?") ? "&" : "?"}auth_test=success`);
    await expect(page.locator("[data-stub-widget]")).toHaveCount(1);
    await expect(page.getByTestId("turnstile-unavailable")).toHaveCount(0);
  });
}

test("a broken widget shows a plain note and the form still submits", async ({ page }) => {
  await stubTurnstile(page, "broken");
  await page.goto("/reset-password?auth_test=success");
  await expect(page.getByTestId("turnstile-unavailable")).toHaveText(/could not load/i);
  await page.getByLabel("Email").fill("person@example.test");
  await page.locator("#account-reset-form").evaluate((f) => (f as HTMLFormElement).requestSubmit());
  await expect(page.getByText("Check your email.").first()).toBeVisible();
});

test("the widget is reset after a failed sign-in", async ({ page }) => {
  await stubTurnstile(page, "ok");
  await page.goto("/login?auth_test=error");
  // The widget renders after the page settles (500ms timer where requestIdleCallback is missing, e.g. WebKit);
  // a reset before it exists is correctly a no-op, so wait for it.
  await expect(page.locator("[data-stub-widget]")).toHaveCount(1);
  await page.locator("#account-email").fill("person@example.test");
  await page.locator("#account-password").fill("correct horse battery 1");
  await page.locator("#account-auth-form").evaluate((f) => (f as HTMLFormElement).requestSubmit());
  await expect.poll(() => page.evaluate(() => (window as unknown as { __turnstile: { resets: number } }).__turnstile.resets)).toBeGreaterThan(0);
});
