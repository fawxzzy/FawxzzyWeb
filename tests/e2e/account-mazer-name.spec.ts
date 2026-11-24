import { expect, test, type Page } from "@playwright/test";
import { AUTH_COPY, type AuthMessageId } from "../../src/lib/auth/copy-matrix";

/**
 * Mazer name on the signed-in account page (MAZER-ACCT-047), driven through the local test adapter
 * (`auth_test`). Fixtures: `mazer-name` has the generated name "Mazer-123456", `mazer-name-missing`
 * has no Mazer profile yet (the page creates it once and retries), `mazer-name-unavailable` behaves
 * like the database function is unreachable. "taken-name" belongs to someone else.
 */
const noticeOf = (page: Page, id: AuthMessageId) => page.locator(`[data-notice-id="${id}"]`);
const surface = (page: Page) => page.locator('[data-auth-surface="account-mazer-name"]');
const dock = (page: Page) => page.locator(".auth-dock__button");
const html = (page: Page) => page.locator("html");
const row = (page: Page) => page.locator('[data-auth-field="mazer-name"]');

async function open(page: Page, scenario = "mazer-name", app = "website") {
  await page.goto(`/account?auth_test=${scenario}${app ? `&app=${app}` : ""}`);
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
}

const PASSWORD = "correct horse battery 1";
const passwordBox = (page: Page) => page.locator("#account-mazer-name-password");

/** Opens Change Mazer name and passes the password step (the same check as Change username). */
async function startRename(page: Page, buttonName: string = AUTH_COPY.aria.changeMazerName) {
  await page.getByRole("button", { name: buttonName }).click();
  await expect(surface(page)).toHaveAttribute("data-change-step", "password");
  await passwordBox(page).fill(PASSWORD);
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-change-step", "value");
}

test("the Mazer name row shows the leaderboard name with a change button", async ({ page }) => {
  await open(page);
  await expect(page.getByLabel(AUTH_COPY.field.mazerName, { exact: true })).toHaveValue("Mazer-123456");
  await expect(page.getByLabel(AUTH_COPY.field.mazerName, { exact: true })).toHaveAttribute("readonly", "");
  const button = page.getByRole("button", { name: AUTH_COPY.aria.changeMazerName });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // The sign-in username row is unchanged and separate.
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("fawxzzy");
});

test("an account with no Mazer profile outside Mazer gets no row", async ({ page }) => {
  await open(page, "session", "");
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("fawxzzy");
  await expect(row(page)).toHaveCount(0);
  await open(page, "session", "fitness");
  await expect(row(page)).toHaveCount(0);
});

test("change Mazer name asks for the password first (empty, wrong, then right)", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: AUTH_COPY.aria.changeMazerName }).click();
  await expect(surface(page)).toHaveAttribute("data-change-step", "password");
  await expect(page.getByText(AUTH_COPY.lead.changeConfirm)).toBeVisible();
  await expect(page.getByLabel(AUTH_COPY.field.newMazerName, { exact: true })).toHaveCount(0);
  await expect(dock(page)).toHaveText(AUTH_COPY.button.continue);

  await dock(page).click();
  await expect(noticeOf(page, "change.pwempty")).toBeVisible();
  await expect(passwordBox(page)).toHaveAttribute("aria-invalid", "true");
  await expect(html(page)).not.toHaveAttribute("data-reauthenticated", /.+/);

  await passwordBox(page).fill("wrong-password");
  await dock(page).click();
  await expect(noticeOf(page, "change.pwwrong")).toBeVisible();
  await expect(surface(page)).toHaveAttribute("data-change-step", "password");

  await passwordBox(page).fill(PASSWORD);
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-change-step", "value");
  await expect(html(page)).toHaveAttribute("data-reauthenticated", "true");
  await expect(html(page)).not.toHaveAttribute("data-mazer-name-saves", /.+/);
});

test("change Mazer name: rules, taken name, same name, then saved at once", async ({ page }) => {
  await open(page);
  await startRename(page);
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.changeMazerName })).toBeVisible();
  await expect(page.getByText(AUTH_COPY.lead.changeMazerName)).toBeVisible();
  await expect(page.locator("#account-mazer-name-current")).toHaveValue("Mazer-123456");
  const next = page.getByLabel(AUTH_COPY.field.newMazerName, { exact: true });
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("maxlength", "15");
  await expect(dock(page)).toHaveText(AUTH_COPY.button.saveName);

  // Local rule, nothing sent.
  await next.fill("a b");
  await dock(page).click();
  await expect(noticeOf(page, "signup.userinvalid")).toBeVisible();
  await expect(next).toHaveAttribute("aria-invalid", "true");
  await expect(html(page)).not.toHaveAttribute("data-mazer-name-saves", /.+/);
  await next.fill("Mazer-123456");
  await dock(page).click();
  await expect(noticeOf(page, "mazer.namesame")).toBeVisible();
  await expect(html(page)).not.toHaveAttribute("data-mazer-name-saves", /.+/);

  // The database says taken.
  await next.fill("taken-name");
  await dock(page).click();
  await expect(noticeOf(page, "signup.taken")).toBeVisible();
  await expect(next).toHaveAttribute("aria-invalid", "true");
  await expect(next).toBeFocused();

  await next.fill("star.runner");
  await dock(page).click();
  await expect(html(page)).toHaveAttribute("data-mazer-name", "star.runner");
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await expect(page.getByLabel(AUTH_COPY.field.mazerName, { exact: true })).toHaveValue("star.runner");
  await expect(noticeOf(page, "mazer.namedone")).toBeVisible();
  // The sign-in username did not change.
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("fawxzzy");
});

test("cancel returns to the account page and changes nothing", async ({ page }) => {
  await open(page);
  await startRename(page);
  await page.getByLabel(AUTH_COPY.field.newMazerName, { exact: true }).fill("other.name");
  await page.getByRole("button", { name: AUTH_COPY.link.cancel }).click();
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await expect(page.getByLabel(AUTH_COPY.field.mazerName, { exact: true })).toHaveValue("Mazer-123456");
  await expect(html(page)).not.toHaveAttribute("data-mazer-name-saves", /.+/);
});

test("from Mazer with no profile yet: the row is empty and the save creates the profile once", async ({ page }) => {
  await open(page, "mazer-name-missing", "mazer");
  // In Mazer the Mazer name is the one name, labelled Username.
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("");
  await startRename(page, AUTH_COPY.aria.changeUsername);
  await page.getByLabel(AUTH_COPY.field.newUsername, { exact: true }).fill("first.name");
  await dock(page).click();
  await expect(html(page)).toHaveAttribute("data-mazer-profile-ensured", "true");
  await expect(html(page)).toHaveAttribute("data-mazer-name-saves", "1");
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("first.name");
  await expect(noticeOf(page, "mazer.namedone")).toBeVisible();
});

test("an unreachable database function reads as unavailable and keeps the editor open", async ({ page }) => {
  await open(page, "mazer-name-unavailable", "mazer");
  await startRename(page, AUTH_COPY.aria.changeUsername);
  await page.getByLabel(AUTH_COPY.field.newUsername, { exact: true }).fill("star.runner");
  await dock(page).click();
  await expect(noticeOf(page, "change.unavailable")).toBeVisible();
  await expect(surface(page)).toBeVisible();
});

test("in Mazer there is ONE name row: the Mazer name, labelled Username, with no sign-in row", async ({ page }) => {
  await open(page, "mazer-name", "mazer");
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveCount(1);
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("Mazer-123456");
  await expect(page.getByLabel(AUTH_COPY.field.mazerName, { exact: true })).toHaveCount(0);
  await expect(page.locator("#account-current-username")).toHaveCount(0);
  await startRename(page, AUTH_COPY.aria.changeUsername);
  await expect(page.getByLabel(AUTH_COPY.field.newMazerName, { exact: true })).toHaveCount(0);
  await page.getByLabel(AUTH_COPY.field.newUsername, { exact: true }).fill("star.runner");
  await dock(page).click();
  await expect(noticeOf(page, "mazer.namedone")).toBeVisible();
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("star.runner");
});

test("outside Mazer both rows stay: sign-in username and Mazer name", async ({ page }) => {
  await open(page, "mazer-name", "website");
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("fawxzzy");
  await expect(page.getByLabel(AUTH_COPY.field.mazerName, { exact: true })).toHaveValue("Mazer-123456");
});
