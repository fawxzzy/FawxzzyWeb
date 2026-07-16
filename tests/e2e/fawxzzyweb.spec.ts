import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { productIdentity } from "../../src/config/product";
import { apps } from "../../src/data/apps";

test("root is the canonical FawxzzyWeb experience", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("FawxzzyWeb");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "One home for the work, apps, and experiments.",
  );
  await expect(page.getByRole("link", { name: "Explore apps" })).toHaveAttribute(
    "href",
    "/apps",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    productIdentity.canonicalOrigin,
  );
});

test("apps route reflects centralized catalog truth", async ({ page }) => {
  await page.goto("/apps");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Apps, grounded in their real homes.",
  );

  for (const app of apps) {
    await expect(page.getByRole("heading", { name: app.name, level: 2 })).toBeVisible();
    const appLink = page.locator(`a[href="${app.liveUrl}"]`, { hasText: "Open app" });
    await expect(appLink).toHaveCount(1);
    await expect(appLink).toHaveAttribute("target", "_blank");
  }
});

test("compatibility route is reversible and points search engines to apps", async ({ page }) => {
  await page.goto("/trove");

  await expect(page.locator('main[data-compatibility-identity="trove"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "/apps" })).toHaveAttribute("href", "/apps");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${productIdentity.canonicalOrigin}/apps`,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(productIdentity.legacyProviderOrigin).toBe("https://fawxzzy-trove.vercel.app");
});

test("deep links remain available under the apps namespace", async ({ page }) => {
  await page.goto("/apps/fitness/preview");

  await expect(page.getByRole("heading", { name: "Layered screen slots" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Fitness preview" })).toHaveAttribute(
    "href",
    "/apps#fitness",
  );
});

for (const route of ["/", "/apps", "/trove", "/apps/fitness/preview"]) {
  test(`${route} has no automated WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test("mobile routes fit the viewport and preserve primary navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const route of ["/", "/apps", "/trove", "/apps/fitness/preview"]) {
    await page.goto(route);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.locator("main#main-content")).toBeVisible();
  }
});
