import { expect, test } from "@playwright/test";

const boards = [
  { name: "Fawxzzy Fitness", count: 29, sample: "Add Calendar View" },
  { name: "Mazer", count: 210, sample: "Maintain the mobile-clean 2D shipping baseline" },
  { name: "Fawxzzy Web", count: 1, sample: "Publish the master-backed Fawxzzy project board" },
  { name: "Atlas Stack", count: 21, sample: "Deterministic roadmap next command" },
];

test("four project boards show the owner-approved public cards and keep private work gated", async ({ page, browserName }) => {
  async function activate(target: ReturnType<typeof page.getByRole>) {
    if (browserName !== "webkit") return target.click();
    await target.evaluate((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
    const box = await target.boundingBox();
    if (!box) throw new Error("Mobile target has no visible bounds");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }

  await page.goto("/projects");
  await expect(page.getByText("Public board snapshot accepted", { exact: false })).toBeVisible();
  await expect(page.getByText("Live master sync is pending", { exact: false })).toHaveCount(0);
  await expect(page.getByText("No cards are cleared for this display board yet", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Private work appears here after account access is verified", { exact: false })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Project boards" });
  await expect(navigation.getByRole("button")).toHaveCount(4);
  for (const { name, count, sample } of boards) {
    await activate(navigation.getByRole("button", { name: `${name}, ${count} cards` }));
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    // The page lists open and completed cards separately; the tab count is their sum.
    const open = await page.locator(".project-card").count();
    await activate(page.locator(".project-completed__toggle"));
    const total = await page.locator(".project-card").count();
    expect(total).toBe(count);
    expect(open).toBeGreaterThan(0);
    await expect(page.locator(".project-card h3", { hasText: sample }).first()).toBeVisible();
    await activate(page.locator(".project-completed__toggle"));
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // A card opens its detail dialog and closes again.
  await activate(navigation.getByRole("button", { name: "Mazer, 210 cards" }));
  await activate(page.locator(".project-card", { hasText: "Maintain the mobile-clean 2D shipping baseline" }).first());
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Maintain the mobile-clean 2D shipping baseline" })).toBeVisible();
  await expect(dialog.getByText("Accepted public snapshot", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Cards that are not approved never reach the page.
  const html = await page.content();
  for (const hidden of ["FW-ANALYTICS-001", "FF-MKT-001", "FF-BETA-001", "FF-ANALYTICS-002", "lane-security-containment"]) {
    expect(html).not.toContain(hidden);
  }
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('head > link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://fawxzzy.com/projects",
  );
});
