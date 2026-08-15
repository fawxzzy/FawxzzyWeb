import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Request } from "@playwright/test";
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

test("visual-system documentation keeps Newsletter historical only", async () => {
  const visualSystem = (
    await readFile(resolve(process.cwd(), "docs", "visual-system.md"), "utf8")
  ).replace(/\r\n/g, "\n");

  expect(visualSystem).toContain("## Historical editorial template");
  expect(visualSystem).toContain("`/newsletter` is intentionally\nabsent and returns 404");
  expect(visualSystem).toContain("immutable comparison evidence");
  expect(visualSystem).toContain("The current footer uses only Home, Apps");
  expect(visualSystem).toContain(
    "The retired Wave 2B editorial family remains historical provenance only",
  );
  expect(visualSystem).not.toContain("Newsletter is the publication home");
  expect(visualSystem).not.toContain("Discover and Newsletter share");
  expect(visualSystem).not.toContain("Wave 2B implements the editorial family");
  expect(visualSystem).not.toContain("Newsletter/build log, Login, and Account");
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
    "Train. Play. Keep moving.",
  );
  await expect(page.getByText(`${apps.length} focused apps.`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Fawxzzy home" })).toHaveAttribute("href", "/");
  await expect(page.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator(".site-nav__links a")).toHaveCount(2);
  await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText("Account");
  await expect(page.getByRole("link", { name: "Choose an app" })).toHaveAttribute("href", "#apps");
  await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText("Discover");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    productIdentity.canonicalOrigin,
  );
  await expect(page.locator('img[src="/brand/fawxzzy-banner-v2-hero.webp"]')).toHaveAttribute(
    "alt",
    /Fawxzzy/,
  );

  await expect(page.getByRole("heading", { name: "Built for momentum and play." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "See the next build." })).toBeVisible();
  await expect(page.locator("[data-app-card]")).toHaveCount(apps.length);
  await expect(page.locator("[data-product-showcase], video")).toHaveCount(0);
  await expect(page.locator('.storefront-social [data-analytics-event="tiktok_open"]')).toHaveCount(1);
  await expect(page.locator('.site-footer [data-analytics-event="tiktok_open"]')).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("&nearr;");
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account" })).toHaveAttribute(
    "href",
    "/account",
  );
});

test("public discovery files expose only canonical indexable routes", async ({
  request,
}) => {
  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBe(true);
  expect(sitemapResponse.headers()["content-type"]).toContain("application/xml");
  const sitemap = await sitemapResponse.text();
  const expectedRoutes = ["/", "/apps", "/apps/fitness", "/apps/mazer"];

  for (const route of expectedRoutes) {
    const canonical =
      route === "/"
        ? productIdentity.canonicalOrigin
        : new URL(route, productIdentity.canonicalOrigin).href;
    expect(sitemap).toContain(`<loc>${canonical}</loc>`);
  }
  for (const excluded of ["/discover", "/trove", "/newsletter", "/account", "/login", "/auth/confirm", "/reset-password"]) {
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
    { path: "/", image: "/brand/fawxzzy-banner-v2.png" },
    { path: "/apps", image: "/brand/fawxzzy-banner-v2.png" },
    { path: "/discover", image: "/brand/fawxzzy-banner-v2.png" },
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
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
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

  for (const app of apps) {
    await page.goto(`/apps/${app.slug}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      new URL(app.trailer.poster.src, productIdentity.canonicalOrigin).href,
    );
    const graph = JSON.parse(
      (await page.locator(`#${app.slug}-application-structured-data`).textContent()) ?? "{}",
    );
    const application = graph["@graph"].find(
      (entry: { "@type": string }) => entry["@type"] === "SoftwareApplication",
    );
    const breadcrumb = graph["@graph"].find(
      (entry: { "@type": string }) => entry["@type"] === "BreadcrumbList",
    );

    expect(application.name).toBe(app.name);
    expect(application.url).toBe(`${productIdentity.canonicalOrigin}/apps/${app.slug}`);
    expect(application.sameAs).toBe(app.origin.current);
    expect(application.featureList).toEqual(
      app.detail.stories.map(({ title }) => title),
    );
    expect(application).not.toHaveProperty("aggregateRating");
    expect(application).not.toHaveProperty("offers");
    expect(application).not.toHaveProperty("review");
    expect(breadcrumb.itemListElement).toHaveLength(2);
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
  expect(discoveryDestinations.some((destination) => destination.id === "instagram")).toBe(false);
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

test("apps route reflects centralized icon and trailer truth", async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.goto("/apps");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Pick your app.",
  );

  for (const app of apps) {
    const entry = page.locator(`#${app.slug}`);
    await expect(entry).toHaveAttribute("data-product-showcase", app.slug);
    await expect(entry.getByRole("img", { name: `${app.name} icon` })).toHaveAttribute(
      "src",
      app.display.icon.src,
    );
    await expect(
      entry.getByRole("img", { name: `${app.name} app preview` }),
    ).toHaveAttribute("src", app.display.poster.src);
    await expect(entry).toContainText(app.description);
    await expect(entry).toContainText(app.category);
    await expect(entry.getByRole("link", { name: `View ${app.name}` })).toHaveAttribute(
      "href",
      `/apps/${app.slug}`,
    );
    await expect(entry.locator("[data-review-placeholder]")).toHaveCount(0);

    await expect(entry).toContainText(app.status);
    await expect(entry.locator("video")).toHaveCount(0);
    await expect(entry.locator("details")).toHaveCount(0);

    for (const asset of [
      app.display.icon.src,
      app.display.poster.src,
      app.trailer.video.src,
      app.trailer.captionsSrc,
    ]) {
      const response = await request.get(asset);
      expect(response.ok(), `${asset} should be served`).toBe(true);
    }
  }

  await expect(page.locator("details")).toHaveCount(0);
  await expect(page.locator(".meta-chip")).toHaveCount(0);
  await expect(page.locator(".app-store-card__category")).toHaveCount(0);
  await expect(page.locator("[data-review-placeholder]")).toHaveCount(0);
  await expect(page.locator('img[src="/brand/trove-foxmark.png"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    `${productIdentity.canonicalOrigin}/brand/fawxzzy-banner-v2.png`,
  );
  await expect(page).toHaveTitle("Apps | Fawxzzy");
  await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
});

test("Home stays concise, Apps owns comparison, and detail routes own trailers", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/");
  await expect(page.locator("[data-app-card]")).toHaveCount(apps.length);
  await expect(page.locator("[data-product-showcase], video")).toHaveCount(0);

  await page.goto("/apps");
  const cards = page.locator("[data-product-showcase]");
  await expect(cards).toHaveCount(apps.length);
  for (const app of apps) {
    const card = page.locator(`#${app.slug}`);
    await expect(card.getByRole("img", { name: `${app.name} app preview` })).toBeVisible();
    await expect(card.locator("video")).toHaveCount(0);
    await expect(card.locator("details")).toHaveCount(0);

    await page.goto(`/apps/${app.slug}`);
    await expect(page.getByLabel(`${app.name} trailer`)).toBeVisible();
    await page.goto("/apps");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, selector] of [["/", "[data-app-card]"], ["/apps", "[data-product-showcase]"]] as const) {
    await page.goto(route);
    const routeCards = page.locator(selector);
    const mobileRects = await routeCards.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top };
      }),
    );
    expect(mobileRects[1].top).toBeGreaterThan(mobileRects[0].top);
    expect(mobileRects.every((rect) => rect.left >= 0 && rect.right <= 390)).toBe(true);
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  }
});

test("Wave 1 interactions retain 44px targets and reduced-motion restraint", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/apps");

  const targetHeights = await page
    .locator(".catalog-button, .site-footer a")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(Math.min(...targetHeights)).toBeGreaterThanOrEqual(44);

  const motion = await page.locator("[data-product-showcase]").first().evaluate((element) => {
    const styles = getComputedStyle(element);
    return { animation: styles.animationName, transition: styles.transitionDuration };
  });
  expect(motion.animation).toBe("none");
  expect(motion.transition).toBe("0s");
});

test("each app-detail trailer exposes its one-minute master from its explicit action", async ({ page }) => {
  test.setTimeout(60_000);

  for (const app of apps) {
    await page.goto(`/apps/${app.slug}`);
    const entry = page.locator(`[data-app-detail="${app.slug}"]`);
    const trailer = entry.getByLabel(`${app.name} trailer`);
    await entry.getByRole("button", { name: `Play ${app.name} trailer` }).click();
    await expect(trailer.locator("source")).toHaveAttribute("src", app.trailer.video.src);
    await expect.poll(
      () => trailer.evaluate((video: HTMLVideoElement) => video.duration),
      { message: `${app.name} trailer should remain a one-minute master`, timeout: 10_000 },
    ).toBeGreaterThanOrEqual(59.9);
    await expect.poll(
      () => trailer.evaluate((video: HTMLVideoElement) => video.duration),
      { message: `${app.name} trailer should not exceed the one-minute master`, timeout: 10_000 },
    ).toBeLessThanOrEqual(60.1);
    await expect(entry.locator('[data-playback-state="playing"]')).toBeVisible();

    await trailer.evaluate((video: HTMLVideoElement) => video.pause());
    await expect(entry.getByRole("button", { name: `Resume ${app.name} trailer` })).toBeVisible();
  }
});

for (const app of apps) {
  test(`${app.name} interrupted trailer attempts stay retryable without hiding genuine errors`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto(`/apps/${app.slug}`);

    const entry = page.locator(`[data-app-detail="${app.slug}"]`);
    const player = entry.locator(".trailer-player");
    const trailer = entry.getByLabel(`${app.name} trailer`);
    await trailer.evaluate((video: HTMLVideoElement) => {
      type ControlledVideo = HTMLVideoElement & { playbackMode?: "abort" | "success" | "error" };

      const controlledVideo = video as ControlledVideo;
      controlledVideo.playbackMode = "abort";
      controlledVideo.play = () => {
        if (controlledVideo.playbackMode === "error") {
          return Promise.reject(new DOMException("Media decode failed", "NotSupportedError"));
        }

        if (controlledVideo.playbackMode === "abort") {
          return Promise.reject(new DOMException("Playback was interrupted", "AbortError"));
        }

        return Promise.resolve();
      };
    });

    const playAction = entry.getByRole("button", { name: `Play ${app.name} trailer` });
    await playAction.click({ force: true });
    await expect(player).toHaveAttribute("data-playback-state", /^(idle|paused)$/);
    await expect(playAction).toBeVisible();
    await expect(entry).not.toContainText("This trailer could not play here.");

    await trailer.evaluate((video: HTMLVideoElement) => {
      (video as HTMLVideoElement & { playbackMode?: string }).playbackMode = "success";
    });
    await playAction.click({ force: true });
    await expect(player).toHaveAttribute("data-playback-state", "playing");

    await trailer.evaluate((video: HTMLVideoElement) => {
      video.dispatchEvent(new Event("pause"));
    });
    const resumeAction = entry.getByRole("button", { name: `Resume ${app.name} trailer` });
    await expect(resumeAction).toBeVisible();
    await trailer.evaluate((video: HTMLVideoElement) => {
      (video as HTMLVideoElement & { playbackMode?: string }).playbackMode = "error";
    });
    await resumeAction.click({ force: true });
    await expect(player).toHaveAttribute("data-playback-state", "error");
    await expect(entry).toContainText("This trailer could not play here.");
    const retryAction = entry.getByRole("button", { name: `Retry ${app.name} trailer` });
    await expect(retryAction).toBeVisible();

    await trailer.evaluate((video: HTMLVideoElement) => {
      (video as HTMLVideoElement & { playbackMode?: string }).playbackMode = "success";
    });
    await retryAction.click({ force: true });
    await expect(player).toHaveAttribute("data-playback-state", "playing");
  });
}

for (const app of apps) {
  test(`${app.name} has a dedicated public app-detail route`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/apps/${app.slug}`);

    await expect(page).toHaveTitle(`${app.name} | Fawxzzy`);
    await expect(page.locator(`[data-app-detail="${app.slug}"]`)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: app.name })).toBeVisible();
    await expect(page.getByRole("img", { name: `${app.name} icon` })).toHaveAttribute(
      "src",
      app.icon.src,
    );
    await expect(
      page.getByRole("img", { name: `${app.name} interaction walkthrough poster` }),
    ).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${productIdentity.canonicalOrigin}/apps/${app.slug}`,
    );
    await expect(page.getByText(app.description)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back home" })).toHaveAttribute("href", "/");
    await expect(page.getByText(app.status, { exact: true })).toBeVisible();

    for (const story of app.detail.stories) {
      const storySection = page.locator(`[data-product-story="${story.id}"]`);
      await expect(storySection).toBeVisible();
      await expect(storySection.getByRole("heading", { level: 2, name: story.title })).toBeVisible();
      await expect(storySection.getByText(story.description)).toBeVisible();
      for (const media of story.media) {
        const image = storySection.getByRole("img", { name: media.alt });
        await expect(image).toHaveAttribute("src", media.src);
        await expect(image).toHaveAttribute("loading", "lazy");
        await expect(storySection.getByText(media.caption)).toBeVisible();
      }
      if (story.media.length > 1) {
        const gallery = storySection.getByRole("region", { name: `${story.title} media gallery` });
        await expect(gallery).toHaveAttribute("tabindex", "0");
      }
    }

    if (app.detail.plannedDirection) {
      const planned = app.detail.plannedDirection;
      const plannedSection = page.locator(`[data-product-story="${planned.id}"]`);
      await expect(plannedSection).toBeVisible();
      await expect(plannedSection.getByText(planned.statusLabel)).toBeVisible();
      await expect(plannedSection.getByText("Planned concept · Not current gameplay")).toBeVisible();
    } else {
      await expect(page.locator(".app-detail-planned")).toHaveCount(0);
    }

    const openApp = page.getByRole("link", { name: `Open ${app.name}` });
    await expect(openApp).toHaveAttribute("href", app.origin.current);
    await expect(openApp).toHaveAttribute("target", "_blank");
    await expect(openApp).toHaveAttribute("rel", "noreferrer");
    await expect(openApp).toHaveAttribute("data-analytics-event", "app_launch");
    await expect(openApp).toHaveAttribute("data-analytics-app", app.slug);
    await expect(page.locator("body")).not.toContainText("&nearr;");

    await expect(page.locator(".app-screenshots-section")).toHaveCount(0);

    await expect(page.locator(`a[href="${app.origin.current}"]`)).toHaveCount(1);
    await expect(page.locator(".app-detail-cta, [data-review-placeholder]")).toHaveCount(0);

    const accent = await page.locator(`[data-app-detail="${app.slug}"]`).evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--product-from").trim(),
    );
    expect(accent).toBe(app.accent.from);

    const [copyBox, mediaBox] = await Promise.all([
      page.locator(".app-detail-hero__copy").boundingBox(),
      page.locator(".app-detail-hero__media").boundingBox(),
    ]);
    expect(copyBox).not.toBeNull();
    expect(mediaBox).not.toBeNull();

    if (copyBox && mediaBox) {
      if ((page.viewportSize()?.width ?? 0) > 880) {
        expect(mediaBox.x).toBeGreaterThan(copyBox.x + copyBox.width);
      } else {
        expect(mediaBox.y).toBeGreaterThan(copyBox.y + copyBox.height);
      }
    }

    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);

    const primaryMedia = page.locator(`#${app.slug}-trailer`);
    const trailer = primaryMedia.getByLabel(`${app.name} trailer`);
    await expect(primaryMedia.locator("details")).toHaveCount(0);
    await expect(trailer).toHaveAttribute("poster", app.trailer.poster.src);
    await expect(trailer.locator("source")).not.toHaveAttribute("src", /.+/);
    await expect(trailer.locator("track")).toHaveAttribute("src", app.trailer.captionsSrc);
    await page.getByRole("button", { name: `Play ${app.name} trailer` }).click();
    await expect(trailer.locator("source")).toHaveAttribute("src", app.trailer.video.src);
    await expect.poll(
      () => trailer.evaluate((video: HTMLVideoElement) => video.currentTime),
      { message: `${app.name} detail trailer should advance`, timeout: 10_000 },
    ).toBeGreaterThan(0.1);
    await trailer.evaluate((video: HTMLVideoElement) => video.pause());
    await expect(page.locator("body")).not.toContainText("No rating or count is implied today.");
    await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
  });
}

test("primary trailer playback is keyboard operable without a disclosure", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/apps/fitness");

  const playButton = page.getByRole("button", { name: "Play Fitness trailer" });
  await playButton.focus();
  await expect(playButton).toBeFocused();
  await page.keyboard.press("Enter");

  const trailer = page.getByLabel("Fitness trailer");
  await expect.poll(
    () => trailer.evaluate((video: HTMLVideoElement) => video.currentTime),
    { message: "keyboard-activated trailer should advance", timeout: 10_000 },
  ).toBeGreaterThan(0.1);
  await expect(page.locator("details")).toHaveCount(0);
});

for (const app of apps) {
  test(`${app.name} trailer defers media and isolates its byte-range request`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const mediaRequests: string[] = [];
    const recordMediaRequest = (request: Request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith(".mp4")) mediaRequests.push(pathname);
    };
    page.on("request", recordMediaRequest);

    await page.goto(`/apps/${app.slug}`, { waitUntil: "networkidle" });
    expect(mediaRequests, `${app.name} initial media requests`).toEqual([]);
    const trailer = page.getByLabel(`${app.name} trailer`);
    await expect(trailer.locator("source")).not.toHaveAttribute("src", /.+/);
    await expect(trailer).toHaveJSProperty("controls", false);

    await page.getByRole("button", { name: `Play ${app.name} trailer` }).click();
    await expect.poll(
      () => trailer.evaluate((video: HTMLVideoElement) => video.currentTime),
      { timeout: 10_000 },
    ).toBeGreaterThan(0.1);
    await expect(trailer.locator("source")).toHaveAttribute("src", app.trailer.video.src);
    await expect(trailer).toHaveJSProperty("controls", true);

    const activeSource = await trailer.evaluate(
      (video: HTMLVideoElement) => new URL(video.currentSrc).pathname,
    );
    expect(activeSource).toBe(app.trailer.video.src);
    await expect(page.locator("video")).toHaveCount(1);

    // Chromium reports native media requests through Playwright's page event.
    // WebKit still proves real playback and source isolation above; its native
    // media loader is intentionally verified through the explicit range probe.
    if (testInfo.project.name === "chromium") {
      expect(new Set(mediaRequests)).toEqual(new Set([app.trailer.video.src]));
      expect(
        mediaRequests.some((requestPath) =>
          apps.some(
            (candidate) =>
              candidate.slug !== app.slug && requestPath === candidate.trailer.video.src,
          ),
        ),
      ).toBe(false);
    }

    await trailer.evaluate((video: HTMLVideoElement) => video.pause());
    const rangeResponse = await page.request.get(app.trailer.video.src, {
      headers: { Range: "bytes=0-2047" },
    });
    expect(rangeResponse.status()).toBe(206);
    expect(rangeResponse.headers()["content-type"]).toContain("video/mp4");
    expect(rangeResponse.headers()["content-range"]).toMatch(/^bytes 0-2047\//);
    page.off("request", recordMediaRequest);
  });
}

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
    expect(await sha256ForPublicAsset(app.display.icon.src)).toBe(app.display.icon.sha256);
    expect(await sha256ForPublicAsset(app.display.poster.src)).toBe(app.display.poster.sha256);
    expect(await sha256ForPublicAsset(app.trailer.video.src)).toBe(app.trailer.video.sha256);
    expect(await sha256ForPublicAsset(app.trailer.poster.src)).toBe(
      app.trailer.poster.sha256,
    );
    for (const story of app.detail.stories) {
      for (const media of story.media) {
        expect(await sha256ForPublicAsset(media.src)).toBe(media.sha256);
      }
    }
    for (const media of app.detail.plannedDirection?.media ?? []) {
      expect(await sha256ForPublicAsset(media.src)).toBe(media.sha256);
    }
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

  expect(vercelConfig.redirects).toContainEqual({
    source: "/apps/fitness/preview",
    destination: "/apps/fitness#fitness-trailer",
    permanent: true,
  });
  expect(vercelConfig.redirects).toContainEqual({
    source: "/discover",
    destination: "/",
    permanent: true,
  });
  expect(vercelConfig.redirects).toContainEqual({
    source: "/trove",
    destination: "/apps",
    permanent: false,
  });
});

test("public routes load without browser errors or framework overlays", async ({ context }, testInfo) => {
  for (const route of [
    "/",
    "/apps",
    "/apps/fitness",
    "/apps/mazer",
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
  "/apps/fitness",
  "/apps/mazer",
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
    "/apps/fitness",
    "/apps/mazer",
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

test("storefront keeps the first choice close and catalog titles inside their cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const mobileGeometry = await page.evaluate(() => ({
    appsTop: document.querySelector("#apps")?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    heroHeight: document.querySelector(".storefront-hero")?.getBoundingClientRect().height ?? 0,
  }));
  expect(mobileGeometry.heroHeight).toBeLessThanOrEqual(500);
  expect(mobileGeometry.appsTop).toBeLessThanOrEqual(760);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/apps");
  const cardGeometry = await page.locator("[data-product-showcase]").evaluateAll((cards) =>
    cards.map((card) => {
      const cardRect = card.getBoundingClientRect();
      const headingRect = card.querySelector("h2")?.getBoundingClientRect();
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
    "/apps/fitness",
    "/apps/mazer",
    "/discover",
    "/account",
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
