import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { productIdentity } from "../../src/config/product";
import { apps } from "../../src/data/apps";
import { discoveryDestinations } from "../../src/data/discovery";
import {
  analyticsApps,
  analyticsEvents,
  compatibilitySources,
  normalizeAnalyticsRoute,
} from "../../src/lib/analytics/contract";

async function sha256ForPublicAsset(src: string) {
  const asset = await readFile(resolve(process.cwd(), "public", src.replace(/^\//, "")));
  return createHash("sha256").update(asset).digest("hex").toUpperCase();
}

test("visual-system documentation keeps Newsletter historical only", async () => {
  const visualSystem = (
    await readFile(resolve(process.cwd(), "docs", "visual-system.md"), "utf8")
  ).replace(/\r\n/g, "\n");

  expect(visualSystem).toContain("## Historical editorial template");
  expect(visualSystem).toContain("`/newsletter` is intentionally\nabsent and returns 404");
  expect(visualSystem).toContain("immutable comparison evidence");
  expect(visualSystem).toContain("The current footer uses only Home, Apps");
  expect(visualSystem).toContain(
    "Wave 2B editorial families remain historical provenance only",
  );
  expect(visualSystem).not.toContain("Newsletter is the publication home");
  expect(visualSystem).not.toContain("Discover and Newsletter share");
  expect(visualSystem).not.toContain("Wave 2B implements the editorial family");
  expect(visualSystem).not.toContain("Newsletter/build log, Login, and Account");
});

test("first-party analytics stays closed, anonymous, and provider-gated", async () => {
  expect(analyticsEvents).toEqual([
    "page_view",
    "tiktok_open",
    "catalog_app_view",
    "app_launch",
    "compatibility_visit",
  ]);
  expect(analyticsApps).toEqual(["fitness", "mazer"]);
  expect(compatibilitySources).toEqual([
    "discover",
    "trove",
    "fitness_legacy_origin",
    "mazer_legacy_origin",
  ]);
  expect(normalizeAnalyticsRoute("/apps/fitness")).toBe("/apps");
  expect(normalizeAnalyticsRoute("/private/free-form-path")).toBe("/");

  const migration = await readFile(
    resolve(process.cwd(), "supabase/migrations/202608200001_first_party_analytics.sql"),
    "utf8",
  );
  const collector = await readFile(
    resolve(process.cwd(), "supabase/functions/first-party-analytics/index.ts"),
    "utf8",
  );
  const client = await readFile(
    resolve(process.cwd(), "src/components/analytics/first-party-analytics.tsx"),
    "utf8",
  );

  expect(migration).toContain("revoke all on table fawxzzy_analytics.events from public, anon, authenticated");
  expect(migration).not.toMatch(
    /\b(ip_address|user_agent|referrer|account_id|user_id)\s+(text|uuid|inet)\b/i,
  );
  expect(collector).toContain("allowedOrigins");
  expect(collector).toContain("hasValidProductShape");
  expect(collector).toContain("isClosedPayload");
  expect(collector).toContain("Object.keys(value).every");
  expect(migration).toContain("product = 'fitness'");
  expect(migration).toContain("product = 'mazer'");
  expect(collector).toContain("SUPABASE_SERVICE_ROLE_KEY");
  expect(collector).not.toMatch(/request\.headers\.get\(["']user-agent|x-forwarded-for|referer/i);
  expect(client).toContain("NEXT_PUBLIC_FAWXZZY_ANALYTICS_URL");
  expect(client).toContain('product: "web"');
  expect(client).toContain('credentials: "omit"');
  expect(client).not.toContain("sendBeacon");
  expect(client).not.toContain("document.cookie");
});

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
    "Built by Fawxzzy.",
  );
  await expect(page.getByRole("link", { name: "Fawxzzy home" })).toHaveAttribute("href", "/");
  await expect(page.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator(".site-nav__links a")).toHaveCount(3);
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Account" }),
  ).toHaveAttribute("href", "https://account.fawxzzy.com/account");
  await expect(page.getByRole("link", { name: "Explore apps" })).toHaveAttribute("href", "/apps");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
    "href",
    "https://account.fawxzzy.com/login",
  );
  await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText("Discover");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    productIdentity.canonicalOrigin,
  );
  await expect(page.locator('img[src="/brand/fawxzzy-banner-v2-hero.webp"]')).toHaveAttribute(
    "alt",
    /Fawxzzy/,
  );

  await expect(page.getByRole("heading", { name: "Creator. Builder. Fitness. Gamer." })).toBeVisible();
  await expect(page.locator("[data-app-card], [data-app-launcher]")).toHaveCount(0);
  await expect(page.locator("[data-product-showcase], video")).toHaveCount(0);
  await expect(page.locator('.creator-profile [data-analytics-event="tiktok_open"]')).toHaveCount(1);
  await expect(page.locator('.site-footer [data-analytics-event="tiktok_open"]')).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("&nearr;");
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Account" }),
  ).toHaveAttribute(
    "href",
    "https://account.fawxzzy.com/account",
  );
});

test("public discovery files expose only canonical indexable routes", async ({
  request,
}) => {
  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBe(true);
  expect(sitemapResponse.headers()["content-type"]).toContain("application/xml");
  const sitemap = await sitemapResponse.text();
  const expectedRoutes = ["/", "/apps"];

  for (const route of expectedRoutes) {
    const canonical =
      route === "/"
        ? productIdentity.canonicalOrigin
        : new URL(route, productIdentity.canonicalOrigin).href;
    expect(sitemap).toContain(`<loc>${canonical}</loc>`);
  }
  for (const excluded of [
    "/discover",
    "/trove",
    "/apps/fitness",
    "/apps/mazer",
    "/newsletter",
    "/account",
    "/login",
    "/auth/confirm",
    "/reset-password",
  ]) {
    expect(sitemap).not.toContain(`<loc>${new URL(excluded, productIdentity.canonicalOrigin).href}</loc>`);
  }

  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.ok()).toBe(true);
  const robots = await robotsResponse.text();
  expect(robots).toContain("Allow: /");
  expect(robots).toContain("Disallow: /account");
  expect(robots).toContain("Disallow: /auth/");
  expect(robots).toContain("Disallow: /trove");
  expect(robots).toContain(`Sitemap: ${productIdentity.canonicalOrigin}/sitemap.xml`);
  expect(robots).toContain(`Host: ${productIdentity.canonicalOrigin}`);
});

test("public routes carry social metadata and grounded structured data", async ({
  page,
}) => {
  const publicRoutes = [
    { path: "/", image: productIdentity.linkPreview.url },
    { path: "/apps", image: productIdentity.linkPreview.url },
    { path: "/discover", image: productIdentity.linkPreview.url },
  ];

  for (const route of publicRoutes) {
    await page.goto(route.path);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Fawxzzy/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /\S/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      new URL(route.image, productIdentity.canonicalOrigin).href,
    );
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      "content",
      String(productIdentity.linkPreview.width),
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      "content",
      String(productIdentity.linkPreview.height),
    );
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      "content",
      productIdentity.linkPreview.alt,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
      "content",
      new URL(route.image, productIdentity.canonicalOrigin).href,
    );
  }

  await page.goto("/");
  const siteGraph = JSON.parse(
    (await page.locator("#fawxzzy-site-structured-data").textContent()) ?? "{}",
  );
  expect(siteGraph["@context"]).toBe("https://schema.org");
  expect(siteGraph["@graph"].map((entry: { "@type": string }) => entry["@type"])).toEqual([
    "Organization",
    "WebSite",
  ]);

  await page.goto("/apps");
  const catalogGraph = JSON.parse(
    (await page.locator("#fawxzzy-app-catalog-structured-data").textContent()) ?? "{}",
  );
  const applicationList = catalogGraph["@graph"].find(
    (entry: { "@type": string }) => entry["@type"] === "ItemList",
  );
  const applications = catalogGraph["@graph"].filter(
    (entry: { "@type": string }) => entry["@type"] === "SoftwareApplication",
  );

  expect(applicationList.itemListElement).toHaveLength(apps.length);
  expect(applications).toHaveLength(apps.length);
  for (const app of apps) {
    const application = applications.find(
      (entry: { name: string }) => entry.name === app.name,
    );
    expect(application.url).toBe(app.origin.current);
    expect(application.sameAs).toBe(app.origin.current);
    expect(application.mainEntityOfPage).toBe(
      `${productIdentity.canonicalOrigin}/apps`,
    );
    expect(application.screenshot).toBe(
      new URL(app.display.poster.src, productIdentity.canonicalOrigin).href,
    );
    expect(application.featureList).toEqual(
      app.detail.stories.map(({ title }) => title),
    );
    expect(application).not.toHaveProperty("aggregateRating");
    expect(application).not.toHaveProperty("offers");
    expect(application).not.toHaveProperty("review");
  }
});

test("discover route is a lightweight compatibility entry for canonical Home", async ({ page }) => {
  await page.goto("/discover");

  await expect(page).toHaveTitle("Fawxzzy");
  await expect(page.locator('main[data-compatibility-identity="discover"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Everything is together now.");
  await expect(page.getByRole("link", { name: "Go to Fawxzzy" })).toHaveAttribute("href", "/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    productIdentity.canonicalOrigin,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("[data-app-card], [data-product-showcase], video")).toHaveCount(0);
  await expect(page.locator('[data-analytics-event="tiktok_open"]')).toHaveCount(1);
  expect(discoveryDestinations.some((destination) => destination.href?.includes("link.me"))).toBe(
    false,
  );
  expect(discoveryDestinations.map((destination) => destination.id)).toEqual(["tiktok"]);
  expect(discoveryDestinations[0]).toMatchObject({
    displayValue: "@fawxzzy",
    href: "https://www.tiktok.com/@fawxzzy",
  });
  expect(JSON.stringify(discoveryDestinations)).not.toContain("fukitzzzzz");
  expect(discoveryDestinations.map((destination) => String(destination.id))).not.toContain("instagram");
  await expect(page.locator('a[href*="youtube"], a[href*="twitter"], a[href*="snapchat"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
});

test("retired newsletter route is absent", async ({ page }) => {
  const response = await page.goto("/newsletter");

  expect(response?.status()).toBe(404);
  await expect(page.locator('[data-system-state="empty"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not here.");
});

test("editorial pages keep clear mobile hierarchy and interaction contracts", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const route of ["/discover"]) {
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(route);

      const geometry = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.scrollWidth, `${route} at ${width}px`).toBeLessThanOrEqual(
        geometry.clientWidth,
      );

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const targetHeights = await page
        .locator(".app-store-card, .catalog-button, .site-footer a")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      expect(Math.min(...targetHeights), `${route} at ${width}px`).toBeGreaterThanOrEqual(44);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/discover");
  const motion = await page.getByRole("link", { name: "Go to Fawxzzy" }).evaluate((element) => {
    const styles = getComputedStyle(element);
    return { animation: styles.animationName, transition: styles.transitionDuration };
  });
  expect(motion.animation).toBe("none");
  expect(motion.transition).toBe("0s");
});

test("apps route presents install help first and a direct-launch app grid", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto("/apps");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to install my apps");
  await expect(page.locator("body")).not.toContainText("App catalog");
  await expect(page.locator("body")).not.toContainText("Pick your app.");
  const sectionOrder = await page.locator(".catalog-install, .catalog-launcher").evaluateAll(
    (sections) => sections.map((section) => section.className),
  );
  expect(sectionOrder).toEqual(["catalog-install surface-panel", "catalog-launcher"]);

  for (const app of apps) {
    const entry = page.locator(`#${app.slug}`);
    await expect(entry).toHaveAttribute("data-app-launcher", app.slug);
    const launchLink = entry.getByRole("link", { name: `Open ${app.name} app`, exact: true });
    await expect(launchLink.locator("img")).toHaveAttribute(
      "src",
      app.display.icon.src,
    );
    await expect(launchLink).toHaveAttribute("href", app.origin.current);
    await expect(launchLink).toHaveAttribute("target", "_blank");
    await expect(launchLink).toHaveAttribute("rel", "noreferrer");
    await expect(launchLink).toHaveAttribute("data-analytics-event", "app_launch");
    await expect(launchLink).toContainText(app.name);
    const launcherControls = entry.locator(":scope > .app-launcher__actions > *");
    await expect(launcherControls).toHaveCount(3);
    await expect(launcherControls.nth(0)).toHaveText(/Open/);
    await expect(launcherControls.nth(1)).toHaveText("Preview");
    await expect(launcherControls.nth(2)).toHaveText("Feedback");
    const openControl = entry.getByRole("link", {
      name: `Open ${app.name} app from launcher controls`,
    });
    await expect(openControl).toHaveAttribute("href", app.origin.current);
    await expect(openControl).toHaveAttribute("target", "_blank");
    await expect(openControl).toHaveAttribute("rel", "noreferrer");
    await expect(openControl).toHaveAttribute("data-analytics-event", "app_launch");
    await expect(entry.locator(":scope > .app-launcher__launch img")).toHaveCount(1);
    await expect(entry.locator(":scope > .app-launcher__launch img")).not.toHaveAttribute(
      "src",
      app.display.poster.src,
    );
    await expect(entry).not.toContainText(app.description);
    await expect(entry).not.toContainText(app.category);
    await expect(entry).not.toContainText(app.status);
    await expect(entry.locator(`a[href="/apps/${app.slug}"]`)).toHaveCount(0);
    await expect(entry.locator("[data-review-placeholder]")).toHaveCount(0);
    await expect(entry.locator("video")).toHaveCount(0);
    await expect(entry.locator("details")).toHaveCount(0);

    const previewDialog = entry.locator(`dialog[data-app-preview="${app.slug}"]`);
    await expect(
      previewDialog.locator(`img[alt="${app.name} current app preview"]`),
    ).toHaveAttribute("src", app.display.poster.src);
    await expect(
      previewDialog.locator(`a[aria-label="Open ${app.name} app from preview"]`),
    ).toHaveAttribute("href", app.origin.current);
    const feedbackDialog = entry.locator(`dialog[data-app-feedback="${app.slug}"]`);
    await expect(feedbackDialog.locator('[data-feedback-state="unavailable"]')).toContainText(
      "No verified public feedback yet.",
    );

    for (const asset of [
      app.display.icon.src,
      app.display.poster.src,
    ]) {
      const response = await request.get(asset);
      expect(response.ok(), `${asset} should be served`).toBe(true);
    }
  }

  const fitnessEntry = page.locator("#fitness");
  await fitnessEntry.getByRole("button", { name: "Preview" }).click();
  const fitnessPreview = fitnessEntry.locator('dialog[data-app-preview="fitness"]');
  await expect(fitnessPreview).toBeVisible();
  await fitnessPreview.getByRole("button", { name: "Close Fitness preview" }).click();
  await expect(fitnessPreview).not.toBeVisible();

  const mazerEntry = page.locator("#mazer");
  await mazerEntry.getByRole("button", { name: "Feedback" }).click();
  const mazerFeedback = mazerEntry.locator('dialog[data-app-feedback="mazer"]');
  await expect(mazerFeedback).toBeVisible();
  await mazerFeedback.getByRole("button", { name: "Close Mazer feedback" }).click();
  await expect(mazerFeedback).not.toBeVisible();

  await expect(page.locator("details")).toHaveCount(0);
  await expect(page.locator(".meta-chip")).toHaveCount(0);
  await expect(page.locator(".app-store-card__category")).toHaveCount(0);
  await expect(page.locator("[data-review-placeholder]")).toHaveCount(0);
  await expect(page.locator('img[src="/brand/trove-foxmark.png"]')).toHaveCount(0);
  const installGuide = page.getByRole("region", { name: "How to install my apps" });
  await expect(installGuide).toBeVisible();
  await expect(installGuide.getByRole("listitem")).toHaveCount(3);
  await expect(installGuide).toContainText("Tap Share, then Add to Home Screen.");
  await expect(installGuide).toContainText("Open the browser menu, then tap Install app.");
  await expect(installGuide).toContainText(
    "Use the install icon in the address bar or browser menu.",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    new URL(productIdentity.linkPreview.url, productIdentity.canonicalOrigin).href,
  );
  await expect(page).toHaveTitle("Apps | Fawxzzy");
  await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
});

test("Home stays creator-focused and Apps launches each product without an extra detail page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/");
  await expect(page.locator("[data-app-card], [data-app-launcher]")).toHaveCount(0);
  await expect(page.locator("[data-product-showcase], video")).toHaveCount(0);

  await page.goto("/apps");
  const cards = page.locator("[data-app-launcher]");
  await expect(cards).toHaveCount(apps.length);
  for (const app of apps) {
    const card = page.locator(`#${app.slug}`);
    await expect(card.locator(":scope > .app-launcher__launch img")).toBeVisible();
    await expect(card.locator("video")).toHaveCount(0);
    await expect(card.locator("details")).toHaveCount(0);
    await expect(card.getByRole("link", { name: `Open ${app.name} app`, exact: true })).toHaveAttribute(
      "href",
      app.origin.current,
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Built by Fawxzzy." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore apps" })).toBeVisible();

  await page.goto("/apps");
  const launcherRects = await page.locator("[data-app-launcher]").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top };
    }),
  );
  expect(launcherRects[1].top).toBe(launcherRects[0].top);
  expect(launcherRects.every((rect) => rect.left >= 0 && rect.right <= 390)).toBe(true);
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});

test("Wave 1 interactions retain 44px targets and reduced-motion restraint", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/apps");

  const targetHeights = await page
    .locator(".app-launcher__launch, .app-launcher__action, .site-footer a")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(Math.min(...targetHeights)).toBeGreaterThanOrEqual(44);

  const motion = await page.locator(".app-launcher__icon").first().evaluate((element) => {
    const styles = getComputedStyle(element);
    return { animation: styles.animationName, transition: styles.transitionDuration };
  });
  expect(motion.animation).toBe("none");
  expect(motion.transition).toBe("0s");
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

  for (const iconPath of [
    "/favicon.ico",
    "/favicon-16x16.png",
    "/favicon-32x32.png",
    "/app/icon-192.png",
    "/app/icon-512.png",
    "/icons/apple-touch-icon.png",
  ]) {
    const iconResponse = await request.get(iconPath);
    expect(iconResponse.ok(), `${iconPath} should be publicly available`).toBe(true);
  }

  expect(manifest.icons).toEqual([
    { src: "/app/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/app/icon-512.png", sizes: "512x512", type: "image/png" },
  ]);

  expect(await sha256ForPublicAsset("/brand/fawxzzy-banner-v2.png")).toBe(
    "4CB01488B2C3AAFF3E96309B01462E2EF8590AD37489FC95D5E2A4B64AF35594",
  );
});

test("app origins use branded launch homes and preserve legacy rollback entrypoints", () => {
  const compatibilityOrigins = {
    fitness: "https://fawxzzy-fitness-local.vercel.app",
    mazer: "https://fawxzzy-mazer.vercel.app",
  } as const;

  for (const app of apps) {
    const compatibilityOrigin =
      compatibilityOrigins[app.slug as keyof typeof compatibilityOrigins];

    expect(app.origin.current).toBe(`https://${app.slug}.fawxzzy.com`);
    expect(app.origin.plannedCanonical).toBe(`https://${app.slug}.fawxzzy.com`);
    expect(compatibilityOrigin, `${app.name} needs a known compatibility origin`).toBeDefined();
    expect(app.origin.current).not.toBe(compatibilityOrigin);
    expect(app.origin.preserveOnCutover).toContain(compatibilityOrigin);
  }
});

test("vendored media matches its centralized provenance hashes", async () => {
  for (const app of apps) {
    expect(await sha256ForPublicAsset(app.icon.src)).toBe(app.icon.sha256);
    expect(await sha256ForPublicAsset(app.display.icon.src)).toBe(app.display.icon.sha256);
    expect(await sha256ForPublicAsset(app.display.poster.src)).toBe(app.display.poster.sha256);
  }
});

test("Trove compatibility points people and search engines to Apps", async ({ page }) => {
  await page.goto("/trove");

  await expect(page.locator('main[data-compatibility-identity="trove"]')).toBeVisible();
  await expect(page.locator('[data-system-state="unavailable"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Trove is now Apps.",
  );
  await expect(page.getByRole("link", { name: "Browse apps" })).toHaveAttribute(
    "href",
    "/apps",
  );
  await expect(page.locator("[data-product-showcase], video")).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${productIdentity.canonicalOrigin}/apps`,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(productIdentity.legacyProviderOrigin).toBe("https://fawxzzy-trove.vercel.app");
});

test("missing routes use the shared recoverable system surface", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const response = await page.goto("/this-page-does-not-exist");

    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-system-state="empty"]')).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This page is not here.",
    );
    await expect(page.getByRole("link", { name: "Browse apps" })).toHaveAttribute(
      "href",
      "/apps",
    );
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  }

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("route and root error boundaries use explicit shared recovery states", async () => {
  const routeError = await readFile(resolve(process.cwd(), "src", "app", "error.tsx"), "utf8");
  const globalError = await readFile(
    resolve(process.cwd(), "src", "app", "global-error.tsx"),
    "utf8",
  );

  expect(routeError).toContain('variant="recoverable-error"');
  expect(routeError).toContain("unstable_retry()");
  expect(globalError).toContain('variant="terminal-error"');
  expect(globalError).toContain("unstable_retry()");
  expect(globalError).toContain("<html lang=\"en\">");
  expect(globalError).not.toContain("error.message");
});

test("provider redirects preserve permanent and reversible compatibility boundaries", async () => {
  const vercelConfig = JSON.parse(await readFile(resolve(process.cwd(), "vercel.json"), "utf8"));
  const readme = await readFile(resolve(process.cwd(), "README.md"), "utf8");

  expect(readme).toContain("Real static fallback pages exist only for `/discover` and `/trove`");
  expect(readme).toContain("paths are provider-only redirects");
  expect(readme).toContain("local and non-Vercel static hosts intentionally return 404");

  expect(vercelConfig.redirects).toContainEqual({
    source: "/apps/fitness/preview",
    destination: "https://fitness.fawxzzy.com",
    permanent: true,
  });
  expect(vercelConfig.redirects).toContainEqual({
    source: "/apps/fitness",
    destination: "https://fitness.fawxzzy.com",
    permanent: true,
  });
  expect(vercelConfig.redirects).toContainEqual({
    source: "/apps/mazer",
    destination: "https://mazer.fawxzzy.com",
    permanent: true,
  });
  expect(vercelConfig.redirects).toContainEqual({
    source: "/discover",
    destination: "/?compatibility=discover",
    permanent: true,
  });
  expect(vercelConfig.redirects).toContainEqual({
    source: "/trove",
    destination: "/apps?compatibility=trove",
    permanent: false,
  });
});

test("public routes load without browser errors or framework overlays", async ({ context }, testInfo) => {
  for (const route of [
    "/",
    "/apps",
    "/discover",
    "/trove",
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
  "/discover",
  "/trove",
]) {
  test(`${route} has no automated WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test("primary navigation adapts without clipping from 320px through desktop", async ({ page }) => {
  const routes = [
    "/",
    "/apps",
    "/discover",
    "/trove",
  ];
  const destinations = [
    ["Home", "/"],
    ["Apps", "/apps"],
  ] as const;

  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 844 });

    for (const route of routes) {
      await page.goto(route);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      expect(dimensions.scrollWidth, `${route} at ${width}px`).toBeLessThanOrEqual(
        dimensions.clientWidth,
      );
      await expect(page.locator("main#main-content")).toBeVisible();

      const primaryNav = page.getByRole("navigation", { name: "Primary" });
      if (!(await primaryNav.count())) continue;

      for (const [name, href] of destinations) {
        const link = primaryNav.getByRole("link", { name, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute("href", href);
      }

      const geometry = await primaryNav.evaluate((nav) => {
        const brand = nav.querySelector<HTMLElement>(".site-nav__brand");
        const links = nav.querySelector<HTMLElement>(".site-nav__links");
        const targets = [...nav.querySelectorAll<HTMLElement>("a")];

        if (!brand || !links) {
          throw new Error("Primary navigation geometry is incomplete");
        }

        const navRect = nav.getBoundingClientRect();
        const brandRect = brand.getBoundingClientRect();
        const linksRect = links.getBoundingClientRect();
        const targetRects = targets.map((target) => target.getBoundingClientRect());

        return {
          brandBottom: brandRect.bottom,
          linksClientWidth: links.clientWidth,
          linksLeft: linksRect.left,
          linksRight: linksRect.right,
          linksScrollWidth: links.scrollWidth,
          linksTop: linksRect.top,
          minimumTargetHeight: Math.min(...targetRects.map((rect) => rect.height)),
          navLeft: navRect.left,
          navRight: navRect.right,
          targetsInsideNav: targetRects.every(
            (rect) => rect.left >= navRect.left - 1 && rect.right <= navRect.right + 1,
          ),
        };
      });

      expect(geometry.linksTop, `${route} at ${width}px`).toBeLessThan(
        geometry.brandBottom,
      );
      expect(geometry.linksLeft).toBeGreaterThanOrEqual(geometry.navLeft);
      expect(geometry.linksRight).toBeLessThanOrEqual(geometry.navRight);
      expect(geometry.linksScrollWidth).toBeLessThanOrEqual(geometry.linksClientWidth);
      expect(geometry.targetsInsideNav).toBe(true);
      expect(geometry.minimumTargetHeight).toBeGreaterThanOrEqual(44);
      await expect(primaryNav.locator(".site-nav__brand-label")).toBeVisible();
      await expect(primaryNav.locator('a[aria-current="page"]')).toHaveCount(1);
    }
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/discover");
  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  const desktopGeometry = await primaryNav.evaluate((nav) => {
    const brand = nav.querySelector<HTMLElement>(".site-nav__brand");
    const links = nav.querySelector<HTMLElement>(".site-nav__links");
    if (!brand || !links) throw new Error("Primary navigation geometry is incomplete");
    const brandRect = brand.getBoundingClientRect();
    const linksRect = links.getBoundingClientRect();
    return {
      brandBottom: brandRect.bottom,
      brandRight: brandRect.right,
      brandTop: brandRect.top,
      linksBottom: linksRect.bottom,
      linksLeft: linksRect.left,
      linksTop: linksRect.top,
    };
  });

  expect(desktopGeometry.brandRight).toBeLessThanOrEqual(desktopGeometry.linksLeft);
  expect(desktopGeometry.brandTop).toBeLessThan(desktopGeometry.linksBottom);
  expect(desktopGeometry.linksTop).toBeLessThan(desktopGeometry.brandBottom);
  await expect(primaryNav.locator('a[aria-current="page"]')).toHaveCount(1);
});

test("creator home keeps its primary actions close and app names inside launcher tiles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const mobileGeometry = await page.evaluate(() => ({
    actionsBottom:
      document.querySelector(".storefront-hero__actions")?.getBoundingClientRect().bottom ??
      Number.POSITIVE_INFINITY,
    heroHeight: document.querySelector(".storefront-hero")?.getBoundingClientRect().height ?? 0,
  }));
  expect(mobileGeometry.heroHeight).toBeLessThanOrEqual(500);
  expect(mobileGeometry.actionsBottom).toBeLessThanOrEqual(760);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/apps");
  const cardGeometry = await page.locator("[data-app-launcher]").evaluateAll((cards) =>
    cards.map((card) => {
      const cardRect = card.getBoundingClientRect();
      const headingRect = card.querySelector(".app-launcher__launch strong")?.getBoundingClientRect();
      return {
        cardLeft: cardRect.left,
        cardRight: cardRect.right,
        headingLeft: headingRect?.left ?? 0,
        headingRight: headingRect?.right ?? Number.POSITIVE_INFINITY,
      };
    }),
  );

  for (const geometry of cardGeometry) {
    expect(geometry.headingLeft).toBeGreaterThanOrEqual(geometry.cardLeft);
    expect(geometry.headingRight).toBeLessThanOrEqual(geometry.cardRight);
  }
});

test("primary navigation stays viewport-sticky while the document owns scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 520 });

  for (const route of [
    "/",
    "/apps",
    "/discover",
  ]) {
    await page.goto(route);

    const primaryNav = page.getByRole("navigation", { name: "Primary" });
    const initial = await primaryNav.evaluate((nav) => {
      const style = getComputedStyle(nav);
      const main = nav.closest<HTMLElement>("main#main-content");

      if (!main) throw new Error("Primary navigation page shell is missing");

      return {
        documentScrollHeight: document.documentElement.scrollHeight,
        mainScrollTop: main.scrollTop,
        position: style.position,
        stickyTop: Number.parseFloat(style.top),
        viewportHeight: window.innerHeight,
      };
    });

    expect(initial.position, `${route} position`).toBe("sticky");
    expect(initial.stickyTop, `${route} sticky top`).toBeGreaterThanOrEqual(0);
    expect(initial.mainScrollTop, `${route} initial main scroll`).toBe(0);
    expect(initial.documentScrollHeight, `${route} document-owned page height`).toBeGreaterThan(
      initial.viewportHeight,
    );

    await page.evaluate(() => {
      window.scrollTo({ top: Math.min(480, document.documentElement.scrollHeight), behavior: "instant" });
    });

    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message: `${route} should scroll the document`,
      })
      .toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          primaryNav.evaluate((nav) => {
            const stickyTop = Number.parseFloat(getComputedStyle(nav).top);
            return Math.abs(nav.getBoundingClientRect().top - stickyTop);
          }),
        { message: `${route} navigation should remain at its sticky viewport offset` },
      )
      .toBeLessThanOrEqual(2);

    const settled = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("main#main-content");
      if (!main) throw new Error("Primary navigation page shell is missing");

      return {
        clientWidth: document.documentElement.clientWidth,
        mainScrollTop: main.scrollTop,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(settled.mainScrollTop, `${route} must not gain nested scrolling`).toBe(0);
    expect(settled.scrollWidth, `${route} horizontal overflow`).toBeLessThanOrEqual(
      settled.clientWidth,
    );
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
