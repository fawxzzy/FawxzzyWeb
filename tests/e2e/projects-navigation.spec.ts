import { expect, test } from "@playwright/test";

test("signed-out Account panel renders without the Projects links", async ({ page }) => {
  // No auth_test scenario and no service configuration: the Account panel is on screen but has no session.
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "Unavailable" })).toBeDisabled();
  await expect(page.locator(".account-auth-secondary")).toBeVisible();
  await expect(page.locator("[data-account-projects-links]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Private projects" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reset Password" })).toBeVisible();
});

test("signed-in Account panel links the main-site Projects and the private view", async ({ page }) => {
  await page.goto("/account?auth_test=session");
  const links = page.locator("[data-account-projects-links]");
  await expect(links.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute("href", "https://fawxzzy.com/projects");
  await expect(links.getByRole("link", { name: "Private projects" })).toHaveAttribute("href", "/projects");
});
