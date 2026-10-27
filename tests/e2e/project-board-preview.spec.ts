import { expect, test } from "@playwright/test";

test("four project boards show an empty public placeholder without actual cards", async ({ page, browserName }) => {
  async function activate(target: ReturnType<typeof page.getByRole>) {
    if (browserName !== "webkit") return target.click();
    await target.evaluate((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
    const box = await target.boundingBox();
    if (!box) throw new Error("Mobile target has no visible bounds");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }

  await page.goto("/projects");
  await expect(page.getByText("Live master sync is pending", { exact: false })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Project boards" });
  await expect(navigation.getByRole("button")).toHaveCount(4);
  for (const name of ["Fawxzzy Fitness", "Mazer", "Fawxzzy Web", "Atlas Stack"]) {
    await activate(navigation.getByRole("button", { name: `${name}, 0 cards` }));
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(page.getByText("No cards are cleared for this display board yet", { exact: false })).toBeVisible();
    await expect(page.locator(".project-card")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('head > link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://account.fawxzzy.com/projects",
  );
});
