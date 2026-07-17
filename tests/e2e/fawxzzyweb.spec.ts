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

test("root is the canonical Fawxzzy experience", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Fawxzzy");
  await expect(page.getByRole("navigation", { name: "Primary" })).toContainText("Fawxzzy");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "Fawxzzy",
  );
  await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
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

  await expect(page).toHaveTitle("Discover | Fawxzzy");
  await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
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
    const entry = page.locator(`#${app.slug}`);
    const appCard = entry.locator(`[data-app-card="${app.slug}"]`);
    await expect(appCard).toHaveAttribute("href", `/apps/${app.slug}`);
    await expect(appCard).toHaveAttribute("aria-label", `View ${app.name} details`);
    await expect(appCard.getByRole("img", { name: `${app.name} icon` })).toHaveAttribute(
      "src",
      app.icon.src,
    );
    await expect(appCard).toContainText(app.tagline);
    await expect(appCard).toContainText(app.status);

    const disclosure = entry.locator("details");
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(disclosure.getByText(`Watch ${app.name} in motion`)).toBeVisible();
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");

    const trailer = page.getByLabel(`${app.name} trailer`);
    await expect(trailer).toBeVisible();
    await expect(trailer).toHaveAttribute("controls", "");
    await expect(trailer).toHaveAttribute("poster", app.trailer.poster.src);
    await expect(trailer.locator("source")).toHaveAttribute("src", app.trailer.video.src);
    await expect(trailer.locator("track")).toHaveAttribute("src", app.trailer.captionsSrc);
    await expect(page.getByRole("button", { name: `Play ${app.name} trailer` })).toBeVisible();

    for (const asset of [
      app.icon.src,
      app.trailer.poster.src,
      app.trailer.video.src,
      app.trailer.captionsSrc,
    ]) {
      const response = await request.get(asset);
      expect(response.ok(), `${asset} should be served`).toBe(true);
    }

    await disclosure.locator("summary").click();
  }

  await expect(page.locator("details")).toHaveCount(apps.length);
  await expect(page.locator(".meta-chip")).toHaveCount(0);
  await expect(page.locator('img[src="/brand/trove-foxmark.png"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `${productIdentity.canonicalOrigin}/brand/fawxzzy-banner.png`,
  );
  await expect(page).toHaveTitle("Apps | Fawxzzy");
  await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
});

test("each catalog trailer starts real playback from its explicit action", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/apps");

  for (const app of apps) {
    const disclosure = page.locator(`#${app.slug}-trailer`);
    await disclosure.locator("summary").click();

    const trailer = page.getByLabel(`${app.name} trailer`);
    await page.getByRole("button", { name: `Play ${app.name} trailer` }).click();
    await expect.poll(
      () => trailer.evaluate((video: HTMLVideoElement) => video.currentTime),
      { message: `${app.name} trailer should advance`, timeout: 10_000 },
    ).toBeGreaterThan(0.1);
    await expect(disclosure.locator('[data-playback-state="playing"]')).toBeVisible();

    await trailer.evaluate((video: HTMLVideoElement) => video.pause());
    await expect(page.getByRole("button", { name: `Resume ${app.name} trailer` })).toBeVisible();
  }
});

for (const app of apps) {
  test(`${app.name} has a dedicated public app-detail route`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/apps/${app.slug}`);

    await expect(page).toHaveTitle(`${app.name} | Fawxzzy`);
    await expect(page.getByRole("heading", { level: 1, name: app.name })).toBeVisible();
    await expect(page.getByRole("img", { name: `${app.name} icon` })).toHaveAttribute(
      "src",
      app.icon.src,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${productIdentity.canonicalOrigin}/apps/${app.slug}`,
    );
    await expect(page.getByText(app.description)).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(app.features.length);

    const openApp = page.getByRole("link", { name: `Open ${app.name}` });
    await expect(openApp).toHaveAttribute("href", app.origin.current);
    await expect(openApp).toHaveAttribute("target", "_blank");
    await expect(openApp).toHaveAttribute("rel", "noreferrer");

    for (const screenshot of app.screenshots) {
      await expect(page.getByRole("img", { name: screenshot.alt })).toHaveAttribute(
        "src",
        screenshot.src,
      );
    }

    const disclosure = page.locator(`#${app.slug}-trailer`);
    await expect(disclosure).not.toHaveAttribute("open", "");
    await disclosure.locator("summary").click();
    const trailer = page.getByLabel(`${app.name} trailer`);
    await page.getByRole("button", { name: `Play ${app.name} trailer` }).click();
    await expect.poll(
      () => trailer.evaluate((video: HTMLVideoElement) => video.currentTime),
      { message: `${app.name} detail trailer should advance`, timeout: 10_000 },
    ).toBeGreaterThan(0.1);
    await trailer.evaluate((video: HTMLVideoElement) => video.pause());
    await expect(page.locator("body")).toContainText("No public review data is shown yet.");
    await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
  });
}

test("trailer disclosure and playback are keyboard operable", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/apps");

  const disclosure = page.locator("#fitness-trailer");
  const summary = disclosure.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");

  const playButton = page.getByRole("button", { name: "Play Fitness trailer" });
  await playButton.focus();
  await expect(playButton).toBeFocused();
  await page.keyboard.press("Enter");

  const trailer = page.getByLabel("Fitness trailer");
  await expect.poll(
    () => trailer.evaluate((video: HTMLVideoElement) => video.currentTime),
    { message: "keyboard-activated trailer should advance", timeout: 10_000 },
  ).toBeGreaterThan(0.1);
  await trailer.evaluate((video: HTMLVideoElement) => video.pause());
});

test("public branding stays separate from repository and provider identity", async ({ request }) => {
  expect(productIdentity.publicName).toBe("Fawxzzy");
  expect(productIdentity.repositoryName).toBe("FawxzzyWeb");
  expect(productIdentity.providerSlug).toBe("fawxzzyweb");

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe("Fawxzzy");
  expect(manifest.short_name).toBe("Fawxzzy");
});

test("app origins preserve the future owner-lane cutover and rollback contract", () => {
  const compatibilityOrigins = {
    fitness: "https://fawxzzy-fitness-local.vercel.app",
    mazer: "https://fawxzzy-mazer.vercel.app",
  } as const;

  for (const app of apps) {
    const compatibilityOrigin =
      compatibilityOrigins[app.slug as keyof typeof compatibilityOrigins];

    expect(app.origin.plannedCanonical).toBe(`https://${app.slug}.fawxzzy.com`);
    expect(compatibilityOrigin, `${app.name} needs a known compatibility origin`).toBeDefined();
    expect(app.origin.preserveOnCutover).toContain(compatibilityOrigin);
  }
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
  await expect(page.getByRole("link", { name: "/apps", exact: true })).toHaveAttribute(
    "href",
    "/apps",
  );
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
    "/apps/fitness#fitness-trailer",
  );
});

test("public routes load without browser errors or framework overlays", async ({ context }, testInfo) => {
  for (const route of [
    "/",
    "/apps",
    "/apps/fitness",
    "/apps/mazer",
    "/discover",
    "/trove",
    "/apps/fitness/preview",
  ]) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      // Playwright WebKit 26.5 can throw this inside native modern-media-controls
      // layout. Real Fitness and Mazer playback is verified separately.
      const isKnownWebKitMediaControlsError =
        testInfo.project.name === "mobile-webkit" &&
        error.message === "Temporal.Duration properties must be finite and of consistent sign";

      if (!isKnownWebKitMediaControlsError) {
        errors.push(`page: ${error.message}`);
      }
    });

    await page.goto(route, { waitUntil: "networkidle" });
    await expect(
      page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay'),
    ).toHaveCount(0);
    expect(errors, `${route} should load without browser errors`).toEqual([]);
    await page.close();
  }
});

for (const route of [
  "/",
  "/apps",
  "/apps/fitness",
  "/apps/mazer",
  "/discover",
  "/trove",
  "/apps/fitness/preview",
]) {
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

  for (const route of [
    "/",
    "/apps",
    "/apps/fitness",
    "/apps/mazer",
    "/discover",
    "/trove",
    "/apps/fitness/preview",
  ]) {
    await page.goto(route);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.locator("main#main-content")).toBeVisible();
  }
});

test("health and manifest remain available with the public identity", async ({ request }) => {
  const healthResponse = await request.get("/healthz.json");
  expect(healthResponse.ok()).toBe(true);

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe(productIdentity.publicName);
  expect(manifest.start_url).toBe("/");
});
