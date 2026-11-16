import { expect, test, type Page } from "@playwright/test";
import { accountRecoveryUrl } from "../../src/config/account";
import { authNotice } from "../../src/lib/auth/copy-matrix";

/**
 * Signed-out password reset by USERNAME (design direction #9). Driven by the local test adapter
 * (`auth_test`), so no provider or Edge Function is called. The reset form never takes a typed email
 * when signed out, every username gets the same line, and no address (masked or not) is shown.
 */

const VIEWPORTS = [
  { height: 844, name: "390x844", width: 390 },
  { height: 568, name: "320x568", width: 320 },
] as const;

const dock = (page: Page) => page.locator(".auth-dock__button");
const usernameInput = (page: Page) => page.locator("#account-reset-username");

/** The field starts disabled until the adapter has read the session (async, slower on WebKit). */
async function openRequestForm(page: Page, query = "auth_test=success") {
  await page.goto(`/reset-password?${query}`);
  await expect(page.locator('[data-auth-surface="recovery"]')).toHaveAttribute("data-auth-state", "signed-out");
  await expect(usernameInput(page)).toBeEnabled();
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { height: Math.round(rect.height), top: Math.round(rect.top) };
    };
    return {
      dock: box(".auth-dock__button"),
      fields: [...document.querySelectorAll(".auth-field")].map((field) => Math.round(field.getBoundingClientRect().top)),
      links: box(".auth-links"),
      slot: box("[data-auth-slot]"),
      title: box(".auth-title"),
    };
  });
}

async function documentScroll(page: Page) {
  return page.evaluate(() => {
    window.scrollTo(0, 10_000);
    const scrolledTo = window.scrollY;
    window.scrollTo(0, 0);
    return {
      innerHeight: window.innerHeight,
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      scrolledTo,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: the signed-out request asks for a username only, with no scroll and a reserved notice slot`, async ({ page }) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await openRequestForm(page);

    // Inputs: one username field (password-manager friendly), no email field, nothing else to type.
    await expect(usernameInput(page)).toHaveAttribute("autocomplete", "username");
    await expect(usernameInput(page)).toHaveAttribute("name", "username");
    await expect(usernameInput(page)).toHaveAttribute("maxlength", "15");
    await expect(page.locator("#account-reset-email")).toHaveCount(0);
    await expect(page.locator('form input[type="email"]')).toHaveCount(0);
    await expect(page.locator(".auth-field")).toHaveCount(1);

    // The notice slot is reserved (has height) before any notice shows.
    const slot = page.locator("[data-auth-slot]");
    await expect(slot).toBeVisible();
    expect((await slot.boundingBox())?.height ?? 0).toBeGreaterThan(0);

    const resting = await documentScroll(page);
    expect(resting.scrollHeight).toBeLessThanOrEqual(resting.innerHeight + 1);
    expect(resting.scrolledTo).toBe(0);

    await usernameInput(page).fill("someone");
    const before = await layout(page);
    await dock(page).click();
    const notice = page.locator('[data-notice-id="reset.sentuser"]');
    await expect(notice).toHaveText(authNotice("reset.sentuser").text);
    expect(await layout(page), "the notice must not move the title, field, links or dock").toEqual(before);
    const fit = await notice.evaluate((element) => {
      const slotRect = element.closest("[data-auth-slot]")!.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const text = element.querySelector(".auth-notice__text")!;
      return {
        insideSlot: rect.top >= slotRect.top - 0.5 && rect.bottom <= slotRect.bottom + 0.5,
        insideViewport: rect.bottom <= window.innerHeight && rect.right <= window.innerWidth && rect.left >= 0,
        textFits: text.scrollHeight <= text.clientHeight + 1,
      };
    });
    expect(fit).toEqual({ insideSlot: true, insideViewport: true, textFits: true });

    const after = await documentScroll(page);
    expect(after.scrollHeight).toBeLessThanOrEqual(after.innerHeight + 1);
    expect(after.scrolledTo).toBe(0);
  });
}

test("every username gets the same line, no address, and the resend countdown", async ({ page }) => {
  const answers: string[] = [];
  for (const username of ["known.user", "nobody.here.x", "Mixed_Case"]) {
    await openRequestForm(page);
    await usernameInput(page).fill(username);
    await dock(page).click();
    const notice = page.locator('[data-notice-id="reset.sentuser"][role="status"]');
    await expect(notice).toBeVisible();
    answers.push((await notice.textContent()) ?? "");
    await expect(page.locator("body")).not.toContainText("@");
    await expect(dock(page)).toHaveText(/^Resend in 0:\d\d$/);
    await expect(dock(page)).toBeDisabled();
    await expect(page.locator("html")).toHaveAttribute("data-reset-username", username);
  }
  expect(new Set(answers).size).toBe(1);
  expect(answers[0]).toBe(authNotice("reset.sentuser").text);
});

test("the recovery link returns to the portal's fixed recovery URL for the product", async ({ page }) => {
  await openRequestForm(page);
  await usernameInput(page).fill("someone");
  await dock(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-reset-redirect", accountRecoveryUrl("website"));

  await openRequestForm(page, "app=mazer&returnTo=%2Foauth%2Fauthorize&auth_test=success");
  await usernameInput(page).fill("someone");
  await dock(page).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-reset-redirect",
    accountRecoveryUrl("mazer", "/oauth/authorize"),
  );
});

test("format, rate limit and an unavailable service each get their own line, never the sent line", async ({ page }) => {
  await openRequestForm(page);
  await usernameInput(page).fill("a b");
  await dock(page).click();
  await expect(page.locator('[data-notice-id="signup.userinvalid"]')).toBeVisible();
  await expect(page.locator('[data-notice-id="reset.sentuser"]')).toHaveCount(0);

  await openRequestForm(page, "auth_test=reset-throttled");
  await usernameInput(page).fill("someone");
  await dock(page).click();
  await expect(page.locator('[data-notice-id="reset.rate"]')).toHaveText(authNotice("reset.rate").text);
  await expect(page.locator('[data-notice-id="reset.sentuser"]')).toHaveCount(0);

  await openRequestForm(page, "auth_test=reset-unavailable");
  await usernameInput(page).fill("someone");
  await dock(page).click();
  await expect(page.locator('[data-notice-id="reset.sendfail"]')).toHaveText(authNotice("reset.sendfail").text);
});

test("signed in, the request keeps the locked account email and asks for no username", async ({ page }) => {
  await page.goto("/reset-password?auth_test=session");
  await expect(page.locator('[data-auth-surface="recovery"]')).toHaveAttribute("data-auth-state", "signed-in");
  await expect(page.locator("#account-reset-email")).toHaveValue("preview.user@example.test");
  await expect(page.locator("#account-reset-email")).toHaveAttribute("readonly", "");
  await expect(usernameInput(page)).toHaveCount(0);
});
