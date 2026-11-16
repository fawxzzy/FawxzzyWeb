import { expect, test, type Page } from "@playwright/test";
import { accountContract } from "../../src/config/account";
import { AUTH_COPY } from "../../src/lib/auth/copy-matrix";

/**
 * Password-manager autofill on every account form (iOS/Safari keychain, Android/Chrome, 1Password).
 * Pins, per screen and field, the attributes those managers read: autocomplete token, name, id, type,
 * inputmode, and no capitalising, correcting or spell-checking. Driven by the local test adapter
 * (`auth_test`), so no provider is called. No portal form asks for a typed code (links only), so no
 * field carries `one-time-code`; the last test keeps it that way on purpose.
 */
type Expected = {
  autocomplete: string;
  name: string;
  type: "text" | "email" | "password";
  inputmode?: string;
  readonly?: boolean;
  minlength?: string;
  passwordrules?: string;
};

async function expectField(page: Page, id: string, expected: Expected) {
  const input = page.locator(`#${id}`);
  await expect(input).toHaveCount(1);
  const attrs = await input.evaluate((element) => {
    const read = (name: string) => element.getAttribute(name);
    return {
      autocapitalize: read("autocapitalize"),
      autocomplete: read("autocomplete"),
      autocorrect: read("autocorrect"),
      inputmode: read("inputmode"),
      minlength: read("minlength"),
      name: read("name"),
      passwordrules: read("passwordrules"),
      readonly: element.hasAttribute("readonly"),
      spellcheck: read("spellcheck"),
      type: read("type") ?? "text",
    };
  });
  expect(attrs, id).toEqual({
    autocapitalize: "none",
    autocomplete: expected.autocomplete,
    autocorrect: "off",
    inputmode: expected.inputmode ?? null,
    minlength: expected.minlength ?? null,
    name: expected.name,
    passwordrules: expected.passwordrules ?? null,
    readonly: expected.readonly ?? false,
    spellcheck: "false",
    type: expected.type,
  });
}

const NEW_PASSWORD = { minlength: "10", passwordrules: "minlength: 10;" } as const;

test("sign in: username with an email keyboard, current password", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.welcome })).toBeVisible();
  await expectField(page, "account-email", { autocomplete: "username", inputmode: "email", name: "email", type: "text" });
  await expectField(page, "account-password", { autocomplete: "current-password", name: "password", type: "password" });
  // Both live in one form, so managers pair them.
  await expect(page.locator("#account-auth-form #account-email, #account-auth-form #account-password")).toHaveCount(2);
});

test("sign in, remembered: the locked name is still the username field and announces its label", async ({ page }) => {
  for (const [stored, label] of [
    ["fawxzzy", AUTH_COPY.field.username],
    ["preview.user@example.test", AUTH_COPY.field.email],
  ] as const) {
    await page.goto("/login?auth_test=success");
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [accountContract.rememberedIdentityKey, stored]);
    await page.reload();
    await expect(page.getByRole("heading", { name: AUTH_COPY.title.welcomeBack })).toBeVisible();
    await expectField(page, "account-email", { autocomplete: "username", name: "email", readonly: true, type: "text" });
    const named = page.getByRole("textbox", { name: label, exact: true });
    await expect(named).toHaveValue(stored);
    await expect(named).toHaveAttribute("id", "account-email");
    await expectField(page, "account-password", { autocomplete: "current-password", name: "password", type: "password" });
  }
});

test("sign up: username, email, and a new password with the policy minimum", async ({ page }) => {
  await page.goto("/login?intent=signup&auth_test=success");
  await expect(page.getByRole("heading", { name: AUTH_COPY.title.createAccount })).toBeVisible();
  await expectField(page, "account-username", { autocomplete: "username", name: "username", type: "text" });
  await expect(page.locator("#account-username")).toHaveAttribute("maxlength", "15");
  await expectField(page, "account-email", { autocomplete: "email", inputmode: "email", name: "email", type: "email" });
  await expectField(page, "account-password", { autocomplete: "new-password", name: "password", type: "password", ...NEW_PASSWORD });
});

test("reset request: username when signed out, the locked account email when signed in", async ({ page }) => {
  // Design direction #9: signed out, the request takes a username, never a typed email.
  await page.goto("/reset-password?auth_test=success");
  await expect(page.locator('[data-auth-surface="recovery"]')).toHaveAttribute("data-auth-state", "signed-out");
  await expectField(page, "account-reset-username", { autocomplete: "username", name: "username", type: "text" });
  await expect(page.locator("#account-reset-username")).toHaveAttribute("maxlength", "15");
  await expect(page.locator("#account-reset-email")).toHaveCount(0);

  // Until the server side is live (RESET_BY_USERNAME_LIVE), the live portal keeps the email form.
  await page.goto("/reset-password?auth_test=reset-email-legacy");
  await expect(page.locator('[data-auth-surface="recovery"]')).toHaveAttribute("data-auth-state", "signed-out");
  await expectField(page, "account-reset-email", { autocomplete: "email", inputmode: "email", name: "email", type: "email" });

  await page.goto("/reset-password?auth_test=session");
  await expect(page.locator('[data-auth-surface="recovery"]')).toHaveAttribute("data-auth-state", "signed-in");
  await expectField(page, "account-reset-email", { autocomplete: "username", name: "email", readonly: true, type: "email" });
  await expect(page.getByRole("textbox", { name: AUTH_COPY.field.email, exact: true })).toHaveValue("preview.user@example.test");
});

test("new password: two new-password fields plus a hidden username for the saved account", async ({ page }) => {
  await page.goto("/reset-password?recovery=1&auth_test=session");
  await expect(page.locator("form").getByLabel(AUTH_COPY.field.newPassword, { exact: true })).toBeEnabled();
  await expectField(page, "account-new-password", { autocomplete: "new-password", name: "password", type: "password", ...NEW_PASSWORD });
  await expectField(page, "account-confirm-password", { autocomplete: "new-password", name: "confirmation", type: "password", ...NEW_PASSWORD });
  const username = page.locator("#account-recovery-username");
  await expect(username).toHaveAttribute("autocomplete", "username");
  await expect(username).toHaveAttribute("type", "email");
  await expect(username).toHaveValue("preview.user@example.test");
  await expect(username).toHaveAttribute("readonly", "");
  // Not seen, not announced, not reachable by Tab, and inside the same form as the new password.
  await expect(username).toBeHidden();
  await expect(username).toHaveCSS("display", "none");
  await expect(page.locator("#account-reset-form #account-recovery-username")).toHaveCount(1);
});

test("change username and email: locked current name, current password, then the new value", async ({ page }) => {
  for (const field of ["username", "email"] as const) {
    await page.goto("/account?auth_test=session");
    await page.getByRole("button", {
      name: field === "username" ? AUTH_COPY.aria.changeUsername : AUTH_COPY.aria.changeEmail,
    }).click();
    const surface = page.locator('[data-auth-surface="account-change"]');
    await expect(surface).toHaveAttribute("data-change-step", "password");
    await expectField(page, "account-change-current", {
      autocomplete: "username",
      name: field === "username" ? "current-username" : "current-email",
      readonly: true,
      type: field === "email" ? "email" : "text",
    });
    await expectField(page, "account-change-password", { autocomplete: "current-password", name: "password", type: "password" });

    await page.locator("#account-change-password").fill("correct horse battery 1");
    await page.locator(".auth-dock__button").click();
    await expect(surface).toHaveAttribute("data-change-step", "value");
    if (field === "username") {
      // A new name is not a saved credential yet: managers must not fill the old one here.
      await expectField(page, "account-change-username", { autocomplete: "off", name: "username", type: "text" });
    } else {
      await expectField(page, "account-change-email", { autocomplete: "email", inputmode: "email", name: "email", type: "email" });
    }
  }
});

test("delete account: locked current name, current password, then a typed check managers must not fill", async ({ page }) => {
  await page.goto("/account?auth_test=session");
  await page.getByRole("button", { name: AUTH_COPY.aria.deleteAccount }).click();
  const surface = page.locator('[data-auth-surface="account-delete"]');
  await expect(surface).toHaveAttribute("data-delete-step", "password");
  await expectField(page, "account-delete-current", { autocomplete: "username", name: "current-username", readonly: true, type: "text" });
  await expectField(page, "account-delete-password", { autocomplete: "current-password", name: "password", type: "password" });
  await page.locator("#account-delete-password").fill("correct horse battery 1");
  await page.locator(".auth-dock__button").click();
  await expect(surface).toHaveAttribute("data-delete-step", "type");
  await expectField(page, "account-delete-confirm", { autocomplete: "off", name: "delete-confirm", type: "text" });
});

test("no portal form asks for a typed one-time code", async ({ page }) => {
  for (const path of [
    "/login?auth_test=success",
    "/login?intent=signup&auth_test=success",
    "/reset-password?auth_test=success",
    "/reset-password?recovery=1&auth_test=session",
    "/account?auth_test=session",
  ]) {
    await page.goto(path);
    await expect(page.locator(".auth-surface")).toBeVisible();
    await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
  }
});
