import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  accountContract,
  accountUrls,
  classifyRuntimeOrigin,
  sanitizeReturnTarget,
} from "../../src/config/account";
import {
  callbackReceiptKey,
  callbackStateMatches,
  parseCallbackPayload,
  parseConfirmPayload,
} from "../../src/lib/auth/callback-contract";
import { safeAuthError, safeAuthSuccess } from "../../src/lib/auth/errors";
import { validatePassword } from "../../src/lib/auth/password-policy";

const accountRoutes = [
  ["/login", "Sign in | Fawxzzy"],
  ["/account", "Account | Fawxzzy"],
  ["/auth/confirm", "Confirm account | Fawxzzy"],
  ["/auth/callback", "Account handoff | Fawxzzy"],
  ["/reset-password", "Reset password | Fawxzzy"],
] as const;

test("account origins and exact redirects are centralized", () => {
  expect(accountContract.canonicalOrigin).toBe("https://account.fawxzzy.com");
  expect(accountUrls.confirm).toBe("https://account.fawxzzy.com/auth/confirm");
  expect(accountUrls.callback).toBe("https://account.fawxzzy.com/auth/callback");
  expect(accountUrls.recovery).toBe(
    "https://account.fawxzzy.com/reset-password?recovery=1",
  );
  expect(accountContract.productOrigins).toEqual({
    fitness: "https://fitness.fawxzzy.com",
    mazer: "https://mazer.fawxzzy.com",
  });
  expect(classifyRuntimeOrigin("http://127.0.0.1:3210")).toBe("local-test");
  expect(classifyRuntimeOrigin("https://fawxzzyweb-example.vercel.app")).toBe("preview");
  expect(classifyRuntimeOrigin("https://account.fawxzzy.com.evil.test")).toBe("foreign");
});

test("return targets fail closed unless they exactly match the contract", () => {
  for (const allowed of [
    "/account",
    "/reset-password?recovery=1",
    "https://fawxzzy.com/",
    "https://fitness.fawxzzy.com/",
    "https://mazer.fawxzzy.com/",
    "https://fawxzzy-fitness-local.vercel.app/",
    "https://fawxzzy-mazer.vercel.app/",
  ]) {
    expect(sanitizeReturnTarget(allowed)).toBe(allowed);
  }

  for (const rejected of [
    "//evil.test/account",
    "/account?access_token=secret",
    "/reset-password?recovery=1&code=secret",
    "/login",
    "https://user@example.com/",
    "https://fitness.fawxzzy.com.evil.test/",
    "https://fitness.fawxzzy.com/path",
    "https://fitness.fawxzzy.com/?code=secret",
    "https://fitness.fawxzzy.com/#access_token=secret",
    "http://fitness.fawxzzy.com/",
    "https://evil.test/",
  ]) {
    expect(sanitizeReturnTarget(rejected), rejected).toBe("/account");
  }
});

test("password policy distinguishes login from account-changing actions without truncation", () => {
  expect(validatePassword("short", "login")).toEqual({ valid: true });
  expect(validatePassword("short", "signup").valid).toBe(false);
  expect(validatePassword("1234567890", "signup")).toEqual({ valid: true });
  expect(validatePassword("x".repeat(129), "reset")).toEqual({ valid: true });
  expect(validatePassword("x".repeat(512), "change")).toEqual({ valid: true });
});

test("safe messages are deterministic and non-enumerating", () => {
  expect(safeAuthError("login")).not.toContain("account exists");
  expect(safeAuthError("signup")).toContain("If this address");
  expect(safeAuthSuccess("reset-request")).toContain("If an account can receive");
  expect(safeAuthError("reset-request")).toBe(safeAuthSuccess("reset-request"));
});

test("confirm and callback parsers accept only the expected one-time material", () => {
  const confirm = parseConfirmPayload(
    new URL(
      "https://account.fawxzzy.com/auth/confirm?token_hash=hash&type=signup&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
    ),
  );
  expect(confirm).toEqual({
    returnTo: "https://fitness.fawxzzy.com/",
    tokenHash: "hash",
    type: "signup",
  });
  expect(parseConfirmPayload(new URL("https://account.fawxzzy.com/auth/confirm?type=bad"))).toBeNull();

  const callback = parseCallbackPayload(
    new URL("https://account.fawxzzy.com/auth/callback?code=code&state=state"),
  );
  expect(callback).toEqual({ code: "code", returnTo: "/account", state: "state" });
  expect(
    parseCallbackPayload(
      new URL("https://account.fawxzzy.com/auth/callback?code=code&state=state#access_token=secret"),
    ),
  ).toBeNull();
  expect(callbackStateMatches("same", "same")).toBe(true);
  expect(callbackStateMatches("same", "other")).toBe(false);
  expect(callbackReceiptKey("stable-code")).toBe(callbackReceiptKey("stable-code"));
});

test("all account routes carry account canonical metadata and setup-pending state", async ({ page }) => {
  for (const [route, title] of accountRoutes) {
    await page.goto(route);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${accountContract.canonicalOrigin}${route}`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('[data-auth-state="setup-pending"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
    await expect(page.getByRole("link", { name: "Account", exact: true })).toHaveAttribute(
      "href",
      "/account",
    );
  }
});

test("public navigation hands account traffic to the canonical account origin", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Account", exact: true })).toHaveAttribute(
    "href",
    accountUrls.account,
  );
});

test("login accepts a legacy short password and maps adapter errors safely", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  const form = page.locator("form");
  await form.getByLabel("Email").fill("legacy@example.test");
  await form.getByLabel("Password").fill("short");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in on this account origin");
  await expect(form.getByRole("button")).toBeDisabled();

  await page.goto("/login?auth_test=error");
  await page.locator("form").getByLabel("Email").fill("unknown@example.test");
  await page.locator("form").getByLabel("Password").fill("short");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(safeAuthError("login"));
});

test("signup enforces ten characters and accepts long passwords", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  await page.getByRole("button", { name: "Create account" }).click();
  const form = page.locator("form");
  await expect(form.getByLabel("Password")).toHaveAttribute("minlength", "10");
  await form.getByLabel("Email").fill("new@example.test");
  await form.getByLabel("Password").fill("x".repeat(129));
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("account request is complete");
});

test("account settings stay session-scoped and username remains capability-gated", async ({
  context,
  page,
}) => {
  await page.goto("/account?auth_test=session");
  await expect(page.getByText("preview.user@example.test")).toBeVisible();
  await expect(page.locator('[data-username-capability="gated"] button')).toBeDisabled();
  expect(await context.cookies()).toEqual([]);

  const emailForm = page.locator("form").filter({ has: page.getByLabel("Update email") });
  await emailForm.getByLabel("Update email").fill("changed@example.test");
  await emailForm.getByRole("button", { name: "Save email" }).click();
  await expect(page.getByRole("status")).toContainText("email update was accepted");

  const passwordForm = page.locator("form").filter({ has: page.getByLabel("New password") });
  await passwordForm.getByLabel("New password").fill("x".repeat(129));
  await passwordForm.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("status")).toContainText("password has been updated");

  await page.getByRole("button", { name: "Sign out here" }).click();
  await expect(page.getByText("You are not signed in on this origin.")).toBeVisible();
});

test("recovery stays non-enumerating and accepts a 128-plus character password", async ({ page }) => {
  await page.goto("/reset-password?auth_test=error");
  await page.getByLabel("Email").fill("private@example.test");
  await page.getByRole("button", { name: "Send recovery link" }).click();
  await expect(page.getByRole("status")).toHaveText(safeAuthSuccess("reset-request"));
  await expect(page.getByRole("button")).toBeDisabled();

  await page.goto("/reset-password?recovery=1&auth_test=success");
  const password = "x".repeat(129);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password").fill(password);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("status")).toContainText("password has been updated");
});

test("confirmation is one-time, sanitized, and preserves only an approved return", async ({ page }) => {
  await page.goto(
    "/auth/confirm?auth_test=success&token_hash=private-hash&type=signup&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
  );
  await expect(page.getByRole("status")).toHaveText("Confirmation complete.");
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  await expect(page.getByRole("link", { name: "Continue safely" })).toHaveAttribute(
    "href",
    "https://fitness.fawxzzy.com/",
  );
});

test("callback validates state, exchanges once, and never retains token material", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "expected-state"), accountContract.callbackStateKey);
  const callback =
    "/auth/callback?auth_test=success&code=one-time-code&state=expected-state&returnTo=https%3A%2F%2Fmazer.fawxzzy.com%2F";
  await page.goto(callback);
  await expect(page.getByRole("status")).toHaveText("Sign-in handoff complete.");
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page.getByRole("link", { name: "Continue safely" })).toHaveAttribute(
    "href",
    "https://mazer.fawxzzy.com/",
  );

  await page.goto(callback);
  await expect(page.getByRole("status")).toHaveText("This sign-in handoff was already completed.");
  await expect(page).toHaveURL(/\/auth\/callback$/);

  await page.goto("/auth/callback?auth_test=success#access_token=secret&refresh_token=secret");
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(
    safeAuthError("callback"),
  );
  await expect(page).toHaveURL(/\/auth\/callback$/);
});

test("callback rejects a mismatched state without an exchange", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "expected"), accountContract.callbackStateKey);
  await page.goto("/auth/callback?auth_test=success&code=code&state=wrong");
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(
    safeAuthError("callback"),
  );
});

test("account routes load without app console, page, or framework errors", async ({ context }) => {
  for (const [route] of accountRoutes) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page.locator('[data-nextjs-dialog], #webpack-dev-server-client-overlay')).toHaveCount(0);
    expect(errors, route).toEqual([]);
    await page.close();
  }
});

for (const [route] of accountRoutes) {
  test(`${route} has no automated WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("account routes fit an iPhone-class viewport and expose visible focus states", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route] of accountRoutes) {
    await page.goto(route);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      minimumTargetHeight: Math.min(
        ...[...document.querySelectorAll<HTMLElement>(
          ".site-nav a, .account-card button, .account-card input, .account-card a",
        )]
          .map((element) => Math.round(element.getBoundingClientRect().height))
          .filter((height) => height > 0),
      ),
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.className,
            right: Math.round(rect.right),
            tag: element.tagName,
            width: Math.round(rect.width),
          };
        })
        .filter(({ right, width }) => right > document.documentElement.clientWidth + 1 || width > document.documentElement.clientWidth + 1)
        .slice(0, 8),
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `${route}: ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
    expect(dimensions.minimumTargetHeight, `${route} touch targets`).toBeGreaterThanOrEqual(44);
    await expect(page.locator("main#main-content")).toBeVisible();
    await page.locator("main a, main button, main input").first().focus();
    await expect(page.locator(":focus")).toBeVisible();
  }
});
