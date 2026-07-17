import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { productIdentity } from "../../src/config/product";
import { apps } from "../../src/data/apps";
import { discoveryDestinations } from "../../src/data/discovery";

async function sha256ForPublicAsset(src: string) {
  const asset = await readFile(resolve(process.cwd(), "public", src.replace(/^\//, "")));
  return createHash("sha256").update(asset).digest("hex").toUpperCase();
}

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
  await expect(page.getByRole("link", { name: "Start here" })).toHaveAttribute(
    "href",
    "/discover",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    productIdentity.canonicalOrigin,
  );
  await expect(page.locator('img[src="/brand/fawxzzy-banner.png"]')).toHaveAttribute(
    "alt",
    /Fawxzzy/,
  );

  for (const app of apps) {
    await expect(page.getByRole("img", { name: `${app.name} icon` })).toHaveAttribute(
      "src",
      app.icon.src,
    );
  }
});

test("discover route exposes centralized public destinations", async ({ page }) => {
  await page.goto("/discover");

  await expect(page).toHaveTitle("Discover | FawxzzyWeb");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Apps, training, and community—one clean jump away.",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${productIdentity.canonicalOrigin}/discover`,
  );

  for (const destination of discoveryDestinations) {
    const card = page.locator(`[data-destination-id="${destination.id}"]`);
    await expect(card.getByRole("heading", { name: destination.title })).toBeVisible();
    await expect(card.locator("a")).toHaveAttribute("href", destination.href);
    await expect(card.locator("a")).toHaveAttribute("target", "_blank");
    await expect(card.locator("a")).toHaveAttribute("rel", "noreferrer");
  }

  await expect(page.locator('[data-destination-id="custom-workout"]')).toContainText(
    "Fitness owns the future intake replacement",
  );
  await expect(page.locator('[data-destination-id="youtube"]')).toHaveCount(1);
});

test("apps route reflects centralized icon and trailer truth", async ({ page, request }) => {
  await page.goto("/apps");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Apps, grounded in their real homes.",
  );

  for (const app of apps) {
    await expect(page.getByRole("heading", { name: app.name, level: 2 })).toBeVisible();
    await expect(page.getByRole("img", { name: `${app.name} icon` })).toHaveAttribute(
      "src",
      app.icon.src,
    );
    const appLink = page.locator(`a[href="${app.liveUrl}"]`, { hasText: "Open app" });
    await expect(appLink).toHaveCount(1);
    await expect(appLink).toHaveAttribute("target", "_blank");

    const trailer = page.getByLabel(`${app.name} trailer`);
    await expect(trailer).toBeVisible();
    await expect(trailer).toHaveAttribute("controls", "");
    await expect(trailer).toHaveAttribute("poster", app.trailer.poster.src);
    await expect(trailer.locator("source")).toHaveAttribute("src", app.trailer.video.src);
    await expect(trailer.locator("track")).toHaveAttribute("src", app.trailer.captionsSrc);

    for (const asset of [app.icon.src, app.trailer.poster.src, app.trailer.video.src, app.trailer.captionsSrc]) {
      const response = await request.get(asset);
      expect(response.ok(), `${asset} should be served`).toBe(true);
    }
  }

  await expect(page.locator("details")).toHaveCount(0);
  await expect(page.locator('img[src="/brand/trove-foxmark.png"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `${productIdentity.canonicalOrigin}/brand/fawxzzy-banner.png`,
  );
});

test("vendored media matches its centralized provenance hashes", async () => {
  for (const app of apps) {
    expect(await sha256ForPublicAsset(app.icon.src)).toBe(app.icon.sha256);
    expect(await sha256ForPublicAsset(app.trailer.video.src)).toBe(app.trailer.video.sha256);
    expect(await sha256ForPublicAsset(app.trailer.poster.src)).toBe(
      app.trailer.poster.sha256,
    );
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
  await expect(page.getByRole("link", { name: "Back to Fitness trailer" })).toHaveAttribute(
    "href",
    "/apps#fitness-trailer",
  );
});

for (const route of ["/", "/apps", "/discover", "/trove", "/apps/fitness/preview"]) {
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

  for (const route of ["/", "/apps", "/discover", "/trove", "/apps/fitness/preview"]) {
    await page.goto(route);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.locator("main#main-content")).toBeVisible();
  }
});
