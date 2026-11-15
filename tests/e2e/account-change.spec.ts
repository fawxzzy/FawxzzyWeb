import { expect, test, type Page } from "@playwright/test";
import { AUTH_COPY, AUTH_MESSAGES, maskEmail, type AuthMessageId } from "../../src/lib/auth/copy-matrix";

/**
 * Change username / change email (design point 12) on the signed-in account page, driven through the
 * local test adapter (`auth_test`). Fixtures: password "wrong-password" is rejected and "too-many" is
 * rate limited; "taken-name" and "taken@example.test" belong to someone else; `change-rate` and
 * `change-unavailable` stand for the database answering "too many" and the SQL not applied yet.
 */
const PASSWORD = "correct horse battery 1";
const noticeOf = (page: Page, id: AuthMessageId) => page.locator(`[data-notice-id="${id}"]`);
const surface = (page: Page) => page.locator('[data-auth-surface="account-change"]');
const dock = (page: Page) => page.locator(".auth-dock__button");
const html = (page: Page) => page.locator("html");

async function open(page: Page, field: "username" | "email", scenario = "session", app?: string) {
  await page.goto(`/account?auth_test=${scenario}${app ? `&app=${app}` : ""}`);
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await page.getByRole("button", {
    name: field === "username" ? AUTH_COPY.aria.changeUsername : AUTH_COPY.aria.changeEmail,
  }).click();
  await expect(surface(page)).toHaveAttribute("data-change-step", "password");
}

async function confirmPassword(page: Page, password = PASSWORD) {
  await page.locator("#account-change-password").fill(password);
  await dock(page).click();
}

test("the account rows carry change buttons in place of the lock", async ({ page }) => {
  await page.goto("/account?auth_test=session");
  await expect(page.locator('[data-auth-field-action="username"]')).toHaveCount(1);
  await expect(page.locator('[data-auth-field-action="email"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: AUTH_COPY.aria.changeUsername })).toBeVisible();
  await expect(page.getByRole("button", { name: AUTH_COPY.aria.changeEmail })).toBeVisible();
  await expect(page.locator(".auth-field[data-locked] .auth-field__icon")).toHaveCount(0);
  // 44px touch targets.
  const box = await page.getByRole("button", { name: AUTH_COPY.aria.changeEmail }).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("change username: password first, then the new name is saved at once", async ({ page }) => {
  await open(page, "username");
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.changeUsername })).toBeVisible();
  await expect(page.getByText(AUTH_COPY.lead.changeConfirm)).toBeVisible();
  await expect(page.locator("#account-change-current")).toHaveValue("fawxzzy");
  await expect(page.locator("#account-change-current")).toHaveAttribute("readonly", "");
  await expect(dock(page)).toHaveText(AUTH_COPY.button.continue);

  // Empty password: local line, field outlined, nothing sent.
  await dock(page).click();
  await expect(noticeOf(page, "change.pwempty")).toBeVisible();
  await expect(page.locator("#account-change-password")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#account-change-password")).toBeFocused();
  await expect(html(page)).not.toHaveAttribute("data-reauthenticated", /.+/);

  await confirmPassword(page, "wrong-password");
  await expect(noticeOf(page, "change.pwwrong")).toBeVisible();
  await expect(surface(page)).toHaveAttribute("data-change-step", "password");

  await confirmPassword(page);
  await expect(surface(page)).toHaveAttribute("data-change-step", "value");
  await expect(html(page)).toHaveAttribute("data-reauthenticated", "true");
  await expect(page.getByText(AUTH_COPY.lead.changeUsername)).toBeVisible();
  const next = page.getByLabel(AUTH_COPY.field.newUsername, { exact: true });
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("maxlength", "15");
  await expect(dock(page)).toHaveText(AUTH_COPY.button.saveUsername);

  // Sign-up rules, locally.
  await next.fill("a b");
  await dock(page).click();
  await expect(noticeOf(page, "signup.userinvalid")).toBeVisible();
  await expect(next).toHaveAttribute("aria-invalid", "true");
  await next.fill("fawxzzy");
  await dock(page).click();
  await expect(noticeOf(page, "change.usersame")).toBeVisible();
  await next.fill("taken-name");
  await dock(page).click();
  await expect(noticeOf(page, "signup.taken")).toBeVisible();
  await expect(next).toHaveAttribute("aria-invalid", "true");

  await next.fill("new.name");
  await dock(page).click();
  await expect(html(page)).toHaveAttribute("data-changed-username", "new.name");
  // Back on the account screen with the new name and the done line.
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await expect(page.getByLabel(AUTH_COPY.field.username, { exact: true })).toHaveValue("new.name");
  await expect(noticeOf(page, "change.userdone")).toBeVisible();
});

test("change username: the database rate limit has its own line", async ({ page }) => {
  await open(page, "username", "change-rate");
  await confirmPassword(page);
  await page.getByLabel(AUTH_COPY.field.newUsername, { exact: true }).fill("other.name");
  await dock(page).click();
  await expect(noticeOf(page, "change.rate")).toBeVisible();
});

test("change username: a backend that is not applied yet shows the unavailable line", async ({ page }) => {
  await open(page, "username", "change-unavailable");
  await confirmPassword(page);
  await page.getByLabel(AUTH_COPY.field.newUsername, { exact: true }).fill("other.name");
  await dock(page).click();
  await expect(noticeOf(page, "change.unavailable")).toHaveText(AUTH_MESSAGES["change.unavailable"][1]);
  await expect(surface(page)).toHaveAttribute("data-change-step", "value");
});

test("password step: too many tries, and Cancel goes back without changing anything", async ({ page }) => {
  await open(page, "email");
  await confirmPassword(page, "too-many");
  await expect(noticeOf(page, "change.rate")).toBeVisible();
  await page.getByRole("button", { name: AUTH_COPY.link.cancel }).click();
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await expect(page.getByLabel(AUTH_COPY.field.email, { exact: true })).toHaveValue("preview.user@example.test");
});

test("change email: the link goes to the new address and the old one keeps working", async ({ page }) => {
  await open(page, "email", "session", "fitness");
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.changeEmail })).toBeVisible();
  await expect(surface(page)).toHaveAttribute("data-auth-product", "fitness");
  await confirmPassword(page);
  await expect(page.getByText(AUTH_COPY.lead.changeEmail)).toBeVisible();
  const next = page.getByLabel(AUTH_COPY.field.newEmail, { exact: true });
  await expect(next).toHaveAttribute("type", "email");
  await expect(dock(page)).toHaveText(AUTH_COPY.button.sendLink);

  await next.fill("not-an-email");
  await dock(page).click();
  await expect(noticeOf(page, "signup.emailinvalid")).toBeVisible();
  await next.fill("PREVIEW.user@example.test");
  await dock(page).click();
  await expect(noticeOf(page, "change.emailsame")).toBeVisible();
  await next.fill("taken@example.test");
  await dock(page).click();
  await expect(noticeOf(page, "change.emailexists")).toBeVisible();
  await expect(next).toHaveAttribute("aria-invalid", "true");

  await next.fill("new.address@example.test");
  await dock(page).click();
  await expect(surface(page)).toHaveAttribute("data-change-step", "sent");
  await expect(html(page)).toHaveAttribute("data-email-change-requested", "new.address@example.test");
  await expect(html(page)).toHaveAttribute(
    "data-email-change-redirect",
    "https://account.fawxzzy.com/auth/confirm?app=fitness",
  );
  await expect(noticeOf(page, "change.emailsent")).toContainText(maskEmail("new.address@example.test"));
  await expect(page.locator("#account-change-email")).toHaveValue("new.address@example.test");
  await expect(page.locator("#account-change-email")).toHaveAttribute("readonly", "");
  await expect(dock(page)).toHaveText(/^Resend in 0:\d\d$/);
  await expect(dock(page)).toBeDisabled();

  // The account still shows the old address until the link is opened.
  await page.getByRole("button", { name: AUTH_COPY.link.backToAccount }).click();
  await expect(page.getByLabel(AUTH_COPY.field.email, { exact: true })).toHaveValue("preview.user@example.test");
});

test("change email: the provider rate limit has its own line", async ({ page }) => {
  await open(page, "email", "change-rate");
  await confirmPassword(page);
  await page.getByLabel(AUTH_COPY.field.newEmail, { exact: true }).fill("new.address@example.test");
  await dock(page).click();
  await expect(noticeOf(page, "change.rate")).toBeVisible();
});

test("change email: a provider outage shows the unavailable line", async ({ page }) => {
  await open(page, "email", "change-unavailable");
  await confirmPassword(page);
  await page.getByLabel(AUTH_COPY.field.newEmail, { exact: true }).fill("new.address@example.test");
  await dock(page).click();
  await expect(noticeOf(page, "change.unavailable")).toBeVisible();
});

async function openedDestinations(page: Page, route: string) {
  const urls: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  await page.goto(route);
  return urls;
}

for (const [scenario, notice] of [
  ["success", "emaildone"],
  ["confirm-pending", "emailhalf"],
  ["error", "emaillink"],
] as const) {
  test(`an opened email-change link (${scenario}) lands on the account page with notice=${notice}`, async ({ page }) => {
    const urls = await openedDestinations(
      page,
      `/auth/confirm?app=mazer&auth_test=${scenario}&token_hash=private-hash&type=email_change`,
    );
    await expect.poll(() => urls.some((url) => new URL(url).pathname === "/account")).toBe(true);
    const landing = new URL(urls.find((url) => new URL(url).pathname === "/account")!);
    expect(landing.searchParams.get("notice")).toBe(notice);
    expect(landing.searchParams.get("app")).toBe("mazer");
    expect(landing.searchParams.has("token_hash")).toBe(false);
    expect(urls.some((url) => url.includes("mazer.fawxzzy.com"))).toBe(false);
  });
}

test("the account page shows the email-change outcome from an allowlisted notice only", async ({ page }) => {
  await page.goto("/account?auth_test=session&notice=emaildone");
  await expect(noticeOf(page, "change.emaildone")).toBeVisible();
  await page.goto("/account?auth_test=session&notice=emailhalf");
  await expect(noticeOf(page, "change.emailhalf")).toBeVisible();
  await page.goto("/account?auth_test=session&notice=emaillink");
  await expect(noticeOf(page, "change.linkfail")).toBeVisible();
  await page.goto("/account?auth_test=session&notice=signup.taken");
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.account })).toBeVisible();
  await expect(page.locator("[data-notice-id]")).toHaveCount(0);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`change screens fit ${viewport.width}x${viewport.height} without document scroll`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page, "email");
    const fits = () =>
      page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        overflowY: document.documentElement.scrollHeight - window.innerHeight,
      }));
    expect(await fits()).toEqual({ overflowX: 0, overflowY: 0 });
    await confirmPassword(page);
    await page.getByLabel(AUTH_COPY.field.newEmail, { exact: true }).fill("new.address@example.test");
    await dock(page).click();
    await expect(surface(page)).toHaveAttribute("data-change-step", "sent");
    expect(await fits()).toEqual({ overflowX: 0, overflowY: 0 });
    await expect(dock(page)).toBeInViewport();
  });
}
