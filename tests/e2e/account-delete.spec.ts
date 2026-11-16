import { expect, test, type Page } from "@playwright/test";
import { accountContract } from "../../src/config/account";
import { AUTH_COPY, AUTH_MESSAGES, type AuthMessageId } from "../../src/lib/auth/copy-matrix";

/**
 * Delete account on the signed-in account page, driven through the local test adapter (`auth_test`).
 * Nothing here reaches a live service. Fixtures: password "wrong-password" is rejected and "too-many"
 * is rate limited; the typed text must be the username ("fawxzzy"). `delete-unavailable` stands for
 * the SQL not applied yet, `delete-billing`/`delete-rate` for those database answers, `delete-gone`
 * for an account already deleted, `delete-expired` for a password check older than 10 minutes.
 */
const PASSWORD = "correct horse battery 1";
const USERNAME = "fawxzzy";
const noticeOf = (page: Page, id: AuthMessageId) => page.locator(`[data-notice-id="${id}"]`);
const surface = (page: Page) => page.locator('[data-auth-surface="account-delete"]');
const dock = (page: Page) => page.locator(".auth-dock__button");
const html = (page: Page) => page.locator("html");
const fits = (page: Page) =>
  page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    overflowY: document.documentElement.scrollHeight - window.innerHeight,
  }));

async function open(page: Page, scenario = "session") {
  await page.goto(`/account?auth_test=${scenario}`);
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await page.getByRole("button", { name: AUTH_COPY.aria.deleteAccount }).click();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "password");
}

async function toWarning(page: Page) {
  await page.locator("#account-delete-password").fill(PASSWORD);
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "type");
  await page.locator("#account-delete-confirm").fill(USERNAME);
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "warning");
}

test("Delete account is the last account row, in danger style, with a 44px button", async ({ page }) => {
  await page.goto("/account?auth_test=session");
  const rows = page.locator(".auth-body > .auth-field");
  await expect(rows).toHaveCount(3);
  await expect(rows.last()).toHaveAttribute("data-auth-field", "delete-account");
  await expect(rows.last()).toHaveAttribute("data-danger", "true");
  await expect(rows.last().locator("input")).toHaveValue(AUTH_COPY.field.deleteAccountValue);
  const button = page.getByRole("button", { name: AUTH_COPY.aria.deleteAccount });
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // Signed out: no row (the page goes to sign in anyway).
  await page.goto("/account?auth_test=success");
  await expect(page.locator('[data-auth-field="delete-account"]')).toHaveCount(0);
});

test("delete: password, typed username, plain-words warning, then the sign-in screen says it is done", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.deleteAccount })).toBeVisible();
  await expect(page.getByText(AUTH_COPY.lead.changeConfirm)).toBeVisible();
  await expect(page.locator("#account-delete-current")).toHaveValue(USERNAME);
  await expect(dock(page)).toHaveText(AUTH_COPY.button.continue);
  await expect(dock(page)).not.toHaveAttribute("data-danger", /.+/);

  // Empty password: local line, nothing sent.
  await dock(page).click();
  await expect(noticeOf(page, "change.pwempty")).toBeVisible();
  await expect(page.locator("#account-delete-password")).toBeFocused();
  await expect(html(page)).not.toHaveAttribute("data-delete-checked", /.+/);

  await page.locator("#account-delete-password").fill("wrong-password");
  await dock(page).click();
  await expect(noticeOf(page, "change.pwwrong")).toBeVisible();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "password");

  await page.locator("#account-delete-password").fill(PASSWORD);
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "type");
  await expect(html(page)).toHaveAttribute("data-delete-checked", "true");
  await expect(page.getByText(AUTH_COPY.lead.deleteType)).toBeVisible();
  const typed = page.getByLabel(AUTH_COPY.field.typeToConfirm(USERNAME), { exact: true });
  await expect(typed).toBeFocused();

  // Wrong text: local line, the box outlined, no delete call.
  await typed.fill("fawxzz");
  await dock(page).click();
  await expect(noticeOf(page, "delete.confirmwrong")).toBeVisible();
  await expect(typed).toHaveAttribute("aria-invalid", "true");
  await expect(html(page)).not.toHaveAttribute("data-delete-calls", /.+/);

  // Any case and spaces are fine (same rule as the server).
  await typed.fill("  FawXzzy ");
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "warning");
  await expect(page.getByText(AUTH_COPY.lead.deleteWarning)).toBeVisible();
  for (const line of AUTH_COPY.deleteList) await expect(page.getByText(line, { exact: true })).toBeVisible();
  await expect(dock(page)).toHaveText(AUTH_COPY.button.deleteAccount);
  await expect(dock(page)).toHaveAttribute("data-danger", "true");
  await expect(html(page)).not.toHaveAttribute("data-delete-calls", /.+/);

  const landing = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname.startsWith("/login"));
  await dock(page).click();
  expect(new URL((await landing).url()).searchParams.getAll("notice")).toEqual(["deleted"]);
  await expect(page.locator('[data-auth-surface="credentials"]')).toBeVisible();
  await expect(noticeOf(page, "signin.deleted")).toHaveText(AUTH_MESSAGES["signin.deleted"][1]);
  // Never the "session ended" redirect, even though the session vanished mid-call.
  await expect(html(page)).not.toHaveAttribute("data-session-lost-redirect", /.+/);
});

test("delete: the remembered name of the deleted account is forgotten", async ({ page }) => {
  const key = accountContract.rememberedIdentityKey;
  await page.goto("/account?auth_test=session");
  await page.evaluate((name) => window.localStorage.setItem(name, "FAWXZZY"), key);
  await open(page);
  await toWarning(page);
  const landing = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname.startsWith("/login"));
  await dock(page).click();
  await landing;
  await expect(noticeOf(page, "signin.deleted")).toBeVisible();
  expect(await page.evaluate((name) => window.localStorage.getItem(name), key)).toBeNull();
});

test("delete: Cancel goes back to the account page and ends the step-1 check", async ({ page }) => {
  await open(page);
  await page.locator("#account-delete-password").fill(PASSWORD);
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "type");
  await page.getByRole("button", { name: AUTH_COPY.link.cancel }).click();
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  // Opening it again starts from the password.
  await page.getByRole("button", { name: AUTH_COPY.aria.deleteAccount }).click();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "password");
});

test("delete refusals keep the account and say why", async ({ page }) => {
  await open(page, "delete-billing");
  await toWarning(page);
  await dock(page).click();
  await expect(noticeOf(page, "delete.billing")).toBeVisible();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "warning");
  await expect(html(page)).not.toHaveAttribute("data-account-deleted", /.+/);

  await open(page, "delete-rate");
  await toWarning(page);
  await dock(page).click();
  await expect(noticeOf(page, "delete.rate")).toBeVisible();

  await open(page, "delete-unavailable");
  await toWarning(page);
  await dock(page).click();
  await expect(noticeOf(page, "delete.unavailable")).toBeVisible();
  await expect(html(page)).not.toHaveAttribute("data-session-lost-redirect", /.+/);
  await expect(page.locator("#account-delete-title")).toBeVisible();

  await open(page);
  await page.locator("#account-delete-password").fill("too-many");
  await dock(page).click();
  await expect(noticeOf(page, "delete.rate")).toBeVisible();
});

test("delete: an expired password check goes back to the password step", async ({ page }) => {
  await open(page, "delete-expired");
  await toWarning(page);
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-delete-step", "password");
  await expect(noticeOf(page, "delete.reauth")).toBeVisible();
  await toWarning(page);
  const landing = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname.startsWith("/login"));
  await dock(page).click();
  await landing;
  await expect(noticeOf(page, "signin.deleted")).toBeVisible();
});

test("delete: an account already gone (retry, second tab) lands on the same done screen", async ({ page }) => {
  await open(page, "delete-gone");
  await toWarning(page);
  const landing = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname.startsWith("/login"));
  await dock(page).click();
  await landing;
  await expect(noticeOf(page, "signin.deleted")).toBeVisible();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`delete screens fit ${viewport.width}x${viewport.height} without document scroll`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/account?auth_test=session");
    await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
    expect(await fits(page)).toEqual({ overflowX: 0, overflowY: 0 });
    await page.getByRole("button", { name: AUTH_COPY.aria.deleteAccount }).click();
    await expect(surface(page)).toHaveAttribute("data-delete-step", "password");
    expect(await fits(page)).toEqual({ overflowX: 0, overflowY: 0 });
    await page.locator("#account-delete-password").fill(PASSWORD);
    await dock(page).click();
    await expect(surface(page)).toHaveAttribute("data-delete-step", "type");
    expect(await fits(page)).toEqual({ overflowX: 0, overflowY: 0 });
    await page.locator("#account-delete-confirm").fill(USERNAME);
    await dock(page).click();
    await expect(surface(page)).toHaveAttribute("data-delete-step", "warning");
    expect(await fits(page)).toEqual({ overflowX: 0, overflowY: 0 });
    await expect(dock(page)).toBeInViewport();
  });

  test(`delete warning with a refusal fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page, "delete-billing");
    await toWarning(page);
    await dock(page).click();
    await expect(noticeOf(page, "delete.billing")).toBeVisible();
    expect(await fits(page)).toEqual({ overflowX: 0, overflowY: 0 });
    await expect(dock(page)).toBeInViewport();
  });
}
