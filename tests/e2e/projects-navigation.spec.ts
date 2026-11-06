import { expect, test } from "@playwright/test";

test("signed-out visitors never see the Account panel's Projects links", async ({ page }) => {
  await page.goto("/account?auth_test=success");
  await expect(page).toHaveURL(/\/login(\?|$)/u);
  await expect(page.locator("[data-account-projects-links]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Private projects" })).toHaveCount(0);
});

test("signed-in Account panel links the main-site Projects and the private view", async ({ page }) => {
  await page.goto("/account?auth_test=session");
  const links = page.locator("[data-account-projects-links]");
  await expect(links.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute("href", "https://fawxzzy.com/projects");
  await expect(links.getByRole("link", { name: "Private projects" })).toHaveAttribute("href", "/projects");
});
