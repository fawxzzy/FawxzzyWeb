import { expect, test } from "@playwright/test";

/**
 * MAZER-ACCT-041: GET /signout?returnTo=<url> and the password-reset session revocation, driven
 * through the portal UI with the deterministic local adapter (no provider is called). The hostile
 * target matrix lives in tests/account-signout-contract.test.mjs; this proves the page applies it.
 */
const mazer = "https://mazer.fawxzzy.com";

function destination(page: import("@playwright/test").Page) {
  return page.locator("html").getAttribute("data-sign-out-destination");
}

test("signing out with a Mazer returnTo ends this session and continues to Mazer", async ({ baseURL, page }) => {
  await page.context().addCookies([{ name: "fawxzzy_owner_hint", url: baseURL!, value: "1" }]);
  await page.goto(`/signout?auth_test=session&returnTo=${encodeURIComponent(`${mazer}/`)}`);
  await expect(page.locator("html")).toHaveAttribute("data-sign-out-destination", `${mazer}/`);
  // Local scope only: the person's other devices stay signed in.
  await expect(page.locator("html")).toHaveAttribute("data-sign-out-scope", "this-session");
  // The shared owner hint is cleared like the account page's Sign out does.
  const cookies = await page.context().cookies(baseURL!);
  expect(cookies.find((cookie) => cookie.name === "fawxzzy_owner_hint")).toBeUndefined();
});

test("a missing, hostile or lookalike returnTo goes to the account sign-in page", async ({ baseURL, page }) => {
  const login = `${new URL(baseURL!).origin}/login`;
  for (const returnTo of [
    "",
    "//evil.example",
    "https://evil.example/",
    "https://mazer.fawxzzy.com.evil.example/",
    "https://mazer.fawxzzy.com@evil.example/",
    "javascript:alert(1)",
    "https%3A%2F%2Fevil.example",
    "https://fitness.fawxzzy.com/",
  ]) {
    await page.goto(`/signout?auth_test=session&returnTo=${encodeURIComponent(returnTo)}`);
    await expect(page.locator("html")).toHaveAttribute("data-sign-out-destination", login);
  }
  await page.goto("/signout?auth_test=session");
  await expect(page.locator("html")).toHaveAttribute("data-sign-out-destination", login);
});

test("signing out with no session is still a success and still follows the allowlisted target", async ({ page }) => {
  await page.goto(`/signout?auth_test=success&returnTo=${encodeURIComponent(`${mazer}/`)}`);
  await expect(page.locator("html")).toHaveAttribute("data-sign-out-destination", `${mazer}/`);
});

test("a failed sign-out stays on the page, says so, and offers a retry instead of redirecting", async ({ page }) => {
  await page.goto(`/signout?auth_test=error&returnTo=${encodeURIComponent(`${mazer}/`)}`);
  await expect(page.getByRole("heading", { name: "Still signed in." })).toBeVisible();
  await expect(page.getByText("Sign out failed. Try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  expect(await destination(page)).toBeNull();
});

test("the sign-out page is not indexed", async ({ page }) => {
  await page.goto("/signout?auth_test=pending");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

async function chooseNewPassword(page: import("@playwright/test").Page, scenario: string) {
  await page.goto(`/reset-password?recovery=1&auth_test=${scenario}&code=one-time-code`);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill("correct-horse-battery-staple");
  await page.getByLabel("Confirm password").fill("correct-horse-battery-staple");
  await page.locator('.account-auth-dock button[type="submit"]').click();
}

test("a new password ends the other sessions first, then the recovery session", async ({ page }) => {
  await chooseNewPassword(page, "success");
  await expect(page.locator("html")).toHaveAttribute("data-sign-out-scopes", "other-sessions,this-session");
  await expect(page.getByRole("status").filter({ hasText: "Password updated." })).toBeVisible();
});

test("if the other sessions cannot be ended the password is still reported saved, plainly", async ({ page }) => {
  await chooseNewPassword(page, "reset-others-error");
  // The recovery session still ends, and the person is told the one thing that did not happen.
  await expect(page.locator("html")).toHaveAttribute("data-sign-out-scopes", "other-sessions,this-session");
  await expect(page.getByRole("status").filter({ hasText: "Other devices may stay signed in." })).toBeVisible();
});

test("the Mazer authorization loading state is Mazer's loader: #02080f, icon after 150 ms, no text, no scroll", async ({ page }) => {
  await page.goto("/oauth/authorize?auth_test=session-pending");
  const bare = page.locator(".oauth-bare");
  await expect(bare).toBeAttached();
  await expect(bare).toHaveCSS("background-color", "rgb(2, 8, 15)");
  const stage = page.locator(".oauth-bare__stage");
  // Same timeline as Mazer's boot splash: fade in over 200 ms after a 150 ms delay.
  await expect(stage).toHaveCSS("animation-delay", "0.15s");
  await expect(stage).toHaveCSS("animation-duration", "0.2s");
  const facts = await page.evaluate(() => {
    const element = document.querySelector(".oauth-bare")!;
    const box = element.getBoundingClientRect();
    const corners = [[1, 1], [innerWidth - 2, 1], [1, innerHeight - 2], [innerWidth - 2, innerHeight - 2]];
    const icon = element.querySelector("img.oauth-bare__icon") as HTMLImageElement | null;
    const iconBox = icon?.getBoundingClientRect();
    return {
      coversViewport: box.width === innerWidth && box.height === innerHeight,
      visibleText: [...element.querySelectorAll("*")].filter((node) => !node.classList.contains("sr-only") && !node.closest("[aria-hidden='true']") && (node.textContent ?? "").trim() !== "").length,
      iconInline: icon?.src.startsWith("data:image/webp;base64,") ?? false,
      iconSize: icon ? icon.offsetWidth : 0,
      centred: iconBox ? Math.abs(iconBox.left + iconBox.width / 2 - innerWidth / 2) < 1 && Math.abs(iconBox.top + iconBox.height / 2 - innerHeight / 2) < 2 : false,
      cornersCovered: corners.every(([x, y]) => document.elementFromPoint(x, y) === element),
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight,
      innerWidth,
    };
  });
  expect(facts.coversViewport).toBe(true);
  expect(facts.cornersCovered).toBe(true);
  expect(facts.visibleText).toBe(0);
  expect(facts.iconInline).toBe(true);
  expect(facts.centred).toBe(true);
  // 30% of the short side, clamped to 88..150 px, like Mazer's loader.
  expect(facts.iconSize).toBe(Math.round(Math.min(150, Math.max(88, Math.min(facts.innerWidth, facts.innerHeight) * 0.3))));
  expect(facts.scrollHeight).toBeLessThanOrEqual(facts.innerHeight + 1);
});
