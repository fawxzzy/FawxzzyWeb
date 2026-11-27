import { expect, test, type Page } from "@playwright/test";
import { authNotice, type AuthMessageId } from "../../src/lib/auth/copy-matrix";
import { RESET_SENT_AT_KEY } from "../../src/lib/auth/recovery-link";

/**
 * Password reset that works in any browser (2026-11-26). The emailed recovery link opens
 * /auth/confirm?token_hash=...&type=recovery, which asks the provider to check the token (verifyOtp)
 * instead of exchanging a PKCE code only the requesting browser can. Driven by the local test adapter
 * (`auth_test`): no provider, inbox or Edge Function is involved.
 */

const dock = (page: Page) => page.locator(".auth-dock__button");
const noticeOf = (page: Page, id: AuthMessageId) => page.locator(`[data-notice-id="${id}"]`);
const newPassword = (page: Page) => page.locator("form").getByLabel("New password", { exact: true });

/** Every top-level URL the page visits, starting with `route`. */
async function openedDestinations(page: Page, route: string) {
  const urls: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  await page.goto(route);
  return urls;
}

async function landingOf(page: Page, route: string) {
  const urls = await openedDestinations(page, route);
  await expect.poll(() => urls.some((url) => new URL(url).pathname === "/reset-password")).toBe(true);
  const landing = new URL(urls.find((url) => new URL(url).pathname === "/reset-password")!);
  // The browser never leaves the portal and the token never travels past the confirm page.
  for (const url of urls) {
    expect(new URL(url).origin).toBe(new URL(page.url()).origin);
    if (new URL(url).pathname !== "/auth/confirm") expect(url).not.toContain("private-hash");
  }
  return landing;
}

test("an opened recovery link (any browser) lands on the new-password form for the product", async ({ page }) => {
  const landing = await landingOf(
    page,
    "/auth/confirm?app=mazer&auth_test=success&token_hash=private-hash&type=recovery&returnTo=%2Foauth%2Fauthorize",
  );
  expect(`${landing.pathname}${landing.search}`).toBe("/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize");
});

test("a hostile continuation on a recovery link is dropped, never followed", async ({ page }) => {
  for (const returnTo of ["https%3A%2F%2Fevil.example%2F", "%2F%2Fevil.example", "%2Faccount"]) {
    const landing = await landingOf(
      page,
      `/auth/confirm?app=mazer&auth_test=success&token_hash=private-hash&type=recovery&returnTo=${returnTo}&next=${returnTo}`,
    );
    expect(`${landing.pathname}${landing.search}`).toBe("/reset-password?recovery=1&app=mazer");
  }
});

for (const [scenario, reason] of [
  ["recovery-expired", "expired"],
  ["error", "invalid"],
] as const) {
  test(`a recovery link the provider refuses (${scenario}) lands on the request form with link=${reason}`, async ({ page }) => {
    const landing = await landingOf(
      page,
      `/auth/confirm?app=fitness&auth_test=${scenario}&token_hash=private-hash&type=recovery`,
    );
    expect(`${landing.pathname}${landing.search}`).toBe(`/reset-password?link=${reason}&app=fitness`);
  });
}

test("the request form names an allowlisted link reason, and nothing for anything else", async ({ page }) => {
  for (const [reason, id] of [["expired", "reset.expired"], ["invalid", "reset.invalid"]] as const) {
    await page.goto(`/reset-password?link=${reason}&auth_test=success`);
    await expect(noticeOf(page, id)).toHaveText(authNotice(id).text);
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
    await expect(newPassword(page)).toHaveCount(0);
  }
  await page.goto("/reset-password?link=signin.wrong&auth_test=success");
  await expect(page.getByLabel("Username")).toBeEnabled();
  await expect(page.locator("#auth-notice")).toHaveCount(0);
});

test("a send the provider refuses says no email went out and counts down the minute", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/reset-password?auth_test=reset-email-wait");
  await expect(page.getByLabel("Email")).toBeEnabled();
  await page.getByLabel("Email").fill("person@example.test");
  await dock(page).click();
  await expect(noticeOf(page, "reset.wait")).toHaveText(authNotice("reset.wait").text);
  await expect(noticeOf(page, "reset.sentany")).toHaveCount(0);
  await expect(dock(page)).toHaveText(/^Resend in 0:\d\d$/);
  await expect(dock(page)).toBeDisabled();
});

test("a reload inside the resend minute keeps counting down instead of asking again", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/reset-password?auth_test=success");
  await expect(page.getByLabel("Username")).toBeEnabled();
  await page.getByLabel("Username").fill("someone");
  await dock(page).click();
  await expect(noticeOf(page, "reset.sentuser")).toBeVisible();
  // Only a timestamp is kept, never the username or an address.
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), RESET_SENT_AT_KEY);
  expect(stored).toMatch(/^\d{13}$/);

  await page.reload();
  await expect(dock(page)).toHaveText(/^Resend in 0:[3-5]\d$/);
  await expect(dock(page)).toBeDisabled();
  await expect(page.locator("#auth-notice")).toHaveCount(0);

  // A minute later (or another browser) the form asks again.
  await page.evaluate((key) => window.localStorage.setItem(key, String(Date.now() - 61_000)), RESET_SENT_AT_KEY);
  await page.reload();
  await expect(page.getByLabel("Username")).toBeEnabled();
  await expect(dock(page)).toHaveText("Send reset link");
});
