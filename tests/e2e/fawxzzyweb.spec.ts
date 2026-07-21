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
    "Software, fitness, games—and whatever I build next.",
  );
  await expect(page.getByRole("link", { name: "Fawxzzy home" })).toHaveAttribute("href", "/");
  await expect(page.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator(".site-nav__links a")).toHaveCount(3);
  await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText("Account");
  await expect(page.getByRole("link", { name: "Explore apps" })).toHaveAttribute(
    "href",
    "/apps",
  );
  await expect(page.getByRole("link", { name: "Read the build log", exact: true }).first()).toHaveAttribute(
    "href",
    "/newsletter",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    productIdentity.canonicalOrigin,
  );
  await expect(page.locator('img[src="/brand/fawxzzy-banner-v2.png"]')).toHaveAttribute(
    "alt",
    /Fawxzzy/,
  );

  await expect(page.getByRole("heading", { name: "Make useful tools more affordable." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build in public and improve from real use." })).toBeVisible();
  await expect(page.getByRole("heading", { name: /connected home for software/ })).toBeVisible();
  await expect(page.locator("[data-product-showcase]")).toHaveCount(apps.length);
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage account" })).toHaveAttribute(
    "href",
    "/account",
  );
});

test("discover route exposes centralized public destinations", async ({ page }) => {
  await page.goto("/discover");

  await expect(page).toHaveTitle("Discover | Fawxzzy");
  await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
  await expect(page.locator("body")).not.toContainText("LinkMe");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Build. Train. Create.",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${productIdentity.canonicalOrigin}/discover`,
  );

  for (const destination of discoveryDestinations) {
    const card = page.locator(`[data-destination-id="${destination.id}"]`);
    await expect(card).toContainText(destination.title);
    await expect(card).toContainText(destination.displayValue);

    if (destination.href && destination.action) {
      const link = page
        .locator(
          `a[data-destination-id="${destination.id}"], [data-destination-id="${destination.id}"] a`,
        )
        .first();
      await expect(link).toHaveAttribute("href", destination.href);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noreferrer");
    } else {
      await expect(card.locator("a")).toHaveCount(0);
    }
  }

  await expect(page.locator('[data-editorial-path="train"]')).toContainText(
    "Fitness owns the future intake replacement",
  );
  await expect(page.locator('[data-destination-id="youtube"]')).toHaveCount(1);
  await expect(page.locator('[data-destination-id="playstation"]')).toContainText(
    "PSN: fawxzzy",
  );
  await expect(page.locator("[data-editorial-path]")).toHaveCount(3);
  await expect(page.locator("[data-current-work]")).toHaveCount(apps.length);
  for (const app of apps) {
    await expect(page.locator(`[data-current-work="${app.slug}"]`)).toContainText(app.latestUpdate);
  }
  await expect(
    page.getByRole("heading", { level: 2, name: "Find Fawxzzy in the places you already use." }),
  ).toBeVisible();
  expect(discoveryDestinations.some((destination) => destination.href?.includes("link.me"))).toBe(
    false,
  );
  expect(discoveryDestinations.some((destination) => destination.id === "instagram")).toBe(false);
  await expect(page.getByRole("link", { name: "View the newsletter" })).toHaveAttribute(
    "href",
    "/newsletter",
  );
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
});

test("newsletter route provides a truthful owned archive surface", async ({ page }) => {
  await page.goto("/newsletter");

  await expect(page).toHaveTitle("Building Fawxzzy Weekly | Fawxzzy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Building Fawxzzy weekly.");
  await expect(page.getByRole("status")).toContainText(/no email address is collected/i);
  await expect(page.locator("[data-editorial-topic]")).toHaveCount(4);
  await expect(page.locator('[data-archive-state="empty"]')).toContainText(
    "No issues are public yet.",
  );
  await expect(page.locator("body")).not.toContainText("Issue 001");
  await expect(page.locator("body")).not.toContainText("Next issue");
  await expect(page.locator('form, input[type="email"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${productIdentity.canonicalOrigin}/newsletter`,
  );
});

test("editorial pages keep clear mobile hierarchy and interaction contracts", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const route of ["/discover", "/newsletter"]) {
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
        .locator(".editorial-text-link, .editorial-directory__item, .catalog-button, .site-footer a")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      expect(Math.min(...targetHeights), `${route} at ${width}px`).toBeGreaterThanOrEqual(44);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/discover");
  const motion = await page.locator(".editorial-directory__item").first().evaluate((element) => {
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
    "Software and games, shown in motion.",
  );

  for (const app of apps) {
    const entry = page.locator(`#${app.slug}`);
    await expect(entry).toHaveAttribute("data-product-showcase", app.slug);
    await expect(entry.getByRole("img", { name: `${app.name} icon` })).toHaveAttribute(
      "src",
      app.icon.src,
    );
    await expect(
      entry.getByRole("img", { name: `${app.name} interaction walkthrough poster` }),
    ).toHaveAttribute("src", app.trailer.poster.src);
    await expect(entry).toContainText(app.tagline);
    await expect(entry).toContainText(app.status);
    await expect(entry).toContainText(app.category);
    await expect(entry).toContainText(app.latestUpdate);
    await expect(entry.getByRole("link", { name: `Explore ${app.name}` })).toHaveAttribute(
      "href",
      `/apps/${app.slug}`,
    );
    await expect(entry.locator("[data-review-placeholder]")).toHaveCount(0);

    const disclosure = entry.locator("details");
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(disclosure.getByText(`Watch ${app.name} in motion`)).toBeVisible();
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");

    const trailer = page.getByLabel(`${app.name} trailer`);
    await expect(trailer).toBeVisible();
    await expect(trailer).toHaveAttribute("controls", "");
    await expect(trailer).toHaveAttribute("preload", "none");
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

    // WebKit can retain an active native video-control layout during the
    // collapse transition. The user-facing playback suite still exercises
    // ordinary clicks; this metadata/asset assertion only needs the native
    // disclosure state reset before proceeding to the next catalog item.
    await disclosure.locator("summary").click({ force: true });
  }

  await expect(page.locator("details")).toHaveCount(apps.length);
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

test("Wave 1 Home and Apps compose as editorial and media-led page families", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  for (const route of ["/", "/apps"]) {
    await page.goto(route);
    const grid = page.locator(".product-showcase-grid, .catalog-stack").first();
    const cards = grid.locator("[data-product-showcase]");
    await expect(cards).toHaveCount(apps.length);

    const desktopRects = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width };
      }),
    );
    expect(desktopRects[0].top).toBeCloseTo(desktopRects[1].top, 0);
    expect(desktopRects[1].left).toBeGreaterThan(desktopRects[0].left);
    expect(Math.min(...desktopRects.map((rect) => rect.width))).toBeGreaterThan(450);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/apps"]) {
    await page.goto(route);
    const cards = page.locator("[data-product-showcase]");
    const mobileRects = await cards.evaluateAll((elements) =>
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
    .locator(".catalog-button, .trailer-disclosure > summary, .site-footer a")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(Math.min(...targetHeights)).toBeGreaterThanOrEqual(44);

  const motion = await page.locator("[data-product-showcase]").first().evaluate((element) => {
    const styles = getComputedStyle(element);
    return { animation: styles.animationName, transition: styles.transitionDuration };
  });
  expect(motion.animation).toBe("none");
  expect(motion.transition).toBe("0s");
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
    await expect.poll(
      () => trailer.evaluate((video: HTMLVideoElement) => video.duration),
      { message: `${app.name} trailer should remain a one-minute master`, timeout: 10_000 },
    ).toBeGreaterThanOrEqual(59.9);
    await expect.poll(
      () => trailer.evaluate((video: HTMLVideoElement) => video.duration),
      { message: `${app.name} trailer should not exceed the one-minute master`, timeout: 10_000 },
    ).toBeLessThanOrEqual(60.1);
    await expect(disclosure.locator('[data-playback-state="playing"]')).toBeVisible();

    await trailer.evaluate((video: HTMLVideoElement) => video.pause());
    await expect(page.getByRole("button", { name: `Resume ${app.name} trailer` })).toBeVisible();
  }
});

test("closing a trailer pauses only that disclosure and reopening stays paused", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/apps");

  const fitnessDisclosure = page.locator("#fitness-trailer");
  const mazerDisclosure = page.locator("#mazer-trailer");
  await fitnessDisclosure.locator("summary").click();
  await mazerDisclosure.locator("summary").click();

  const fitnessTrailer = page.getByLabel("Fitness trailer");
  const mazerTrailer = page.getByLabel("Mazer trailer");

  await page.evaluate(() => {
    for (const slug of ["fitness", "mazer"]) {
      const video = document.querySelector<HTMLVideoElement>(`#${slug}-trailer video`);

      if (!video) {
        throw new Error(`${slug} trailer is missing`);
      }

      const pause = video.pause.bind(video);
      video.dataset.pauseCalls = "0";
      video.pause = () => {
        video.dataset.pauseCalls = String(Number(video.dataset.pauseCalls) + 1);
        pause();
      };
    }
  });

  await page.getByRole("button", { name: "Play Fitness trailer" }).click();
  await expect.poll(
    () => fitnessTrailer.evaluate((video: HTMLVideoElement) => video.currentTime),
    { message: "Fitness trailer should advance before collapse", timeout: 10_000 },
  ).toBeGreaterThan(0.1);

  await fitnessDisclosure.locator("summary").click();
  await expect(fitnessDisclosure).not.toHaveAttribute("open", "");
  await expect.poll(
    () => fitnessTrailer.evaluate((video: HTMLVideoElement) => video.paused),
    { message: "collapsed Fitness trailer should pause" },
  ).toBe(true);
  await expect(fitnessTrailer).toHaveAttribute("data-pause-calls", "1");
  await expect(mazerTrailer).toHaveAttribute("data-pause-calls", "0");
  await expect(mazerDisclosure).toHaveAttribute("open", "");

  const collapsedTime = await fitnessTrailer.evaluate(
    (video: HTMLVideoElement) => video.currentTime,
  );
  await fitnessDisclosure.locator("summary").click();
  await expect(fitnessDisclosure).toHaveAttribute("open", "");
  await expect.poll(
    () => fitnessTrailer.evaluate((video: HTMLVideoElement) => video.paused),
    { message: "reopened Fitness trailer should remain paused" },
  ).toBe(true);
  await expect(page.getByRole("button", { name: "Resume Fitness trailer" })).toBeVisible();
  expect(
    await fitnessTrailer.evaluate((video: HTMLVideoElement) => video.currentTime),
  ).toBeCloseTo(collapsedTime, 1);
});

test("native trailer controls resynchronize state after a disclosure pause", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/apps");

  const disclosure = page.locator("#fitness-trailer");
  const trailer = page.getByLabel("Fitness trailer");
  await disclosure.locator("summary").click();
  await page.getByRole("button", { name: "Play Fitness trailer" }).click();
  await expect.poll(
    () => trailer.evaluate((video: HTMLVideoElement) => video.currentTime),
    { message: "Fitness trailer should advance before collapse", timeout: 10_000 },
  ).toBeGreaterThan(0.1);

  await disclosure.locator("summary").click();
  await disclosure.locator("summary").click();
  await expect(page.getByRole("button", { name: "Resume Fitness trailer" })).toBeVisible();

  await trailer.evaluate(async (video: HTMLVideoElement) => {
    await video.play();
  });
  await expect(disclosure.locator('[data-playback-state="playing"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume Fitness trailer" })).toHaveCount(0);
  await expect(disclosure.locator(".trailer-player__status")).toHaveText("Trailer playing.");
});

for (const app of apps) {
  test(`${app.name} interrupted trailer attempts stay retryable without hiding genuine errors`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/apps");

    const disclosure = page.locator(`#${app.slug}-trailer`);
    const trailer = page.getByLabel(`${app.name} trailer`);
    const retryableAction = page.getByRole("button", {
      name: new RegExp(`^(Play|Resume) ${app.name} trailer$`),
    });
    const setDisclosureOpen = async (open: boolean) => {
      const isOpen = (await disclosure.getAttribute("open")) !== null;

      if (isOpen !== open) {
        await disclosure.locator("summary").click({ force: true });
      }

      if (open) {
        await expect(disclosure).toHaveAttribute("open", "");
      } else {
        await expect(disclosure).not.toHaveAttribute("open", "");
        await expect(disclosure.locator(".trailer-player")).toHaveAttribute(
          "data-playback-state",
          /^(idle|paused|ended|error)$/,
        );
      }
    };

    await setDisclosureOpen(true);
    await trailer.evaluate((video: HTMLVideoElement) => {
      type ControlledVideo = HTMLVideoElement & {
        rejectPendingPlay?: () => void;
        playbackMode?: "pending" | "abort" | "success" | "error";
      };

      const controlledVideo = video as ControlledVideo;
      controlledVideo.playbackMode = "pending";
      controlledVideo.play = () => {
        if (controlledVideo.playbackMode === "pending") {
          return new Promise<void>((_resolve, reject) => {
            controlledVideo.rejectPendingPlay = () =>
              reject(new DOMException("Playback was interrupted", "AbortError"));
          });
        }

        if (controlledVideo.playbackMode === "error") {
          return Promise.reject(new DOMException("Media decode failed", "NotSupportedError"));
        }

        if (controlledVideo.playbackMode === "abort") {
          return Promise.reject(new DOMException("Playback was interrupted", "AbortError"));
        }

        return Promise.resolve();
      };
    });

    await page.getByRole("button", { name: `Play ${app.name} trailer` }).click({ force: true });
    await expect(disclosure.locator('[data-playback-state="loading"]')).toBeVisible();

    await setDisclosureOpen(false);
    await setDisclosureOpen(true);
    await expect(retryableAction).toBeVisible();

    await trailer.evaluate((video: HTMLVideoElement) => {
      (video as HTMLVideoElement & { playbackMode?: string }).playbackMode = "success";
    });
    await retryableAction.click({ force: true });
    await expect(disclosure.locator('[data-playback-state="playing"]')).toBeVisible();

    await trailer.evaluate((video: HTMLVideoElement) => {
      const controlledVideo = video as HTMLVideoElement & { rejectPendingPlay?: () => void };
      controlledVideo.rejectPendingPlay?.();
    });
    await expect(disclosure.locator('[data-playback-state="playing"]')).toBeVisible();
    await expect(disclosure).not.toContainText("This trailer could not play here.");

    await setDisclosureOpen(false);
    await setDisclosureOpen(true);
    await trailer.evaluate((video: HTMLVideoElement) => {
      (video as HTMLVideoElement & { playbackMode?: string }).playbackMode = "abort";
    });
    await retryableAction.click({ force: true });
    await expect(disclosure.locator(".trailer-player")).toHaveAttribute(
      "data-playback-state",
      /^(idle|paused)$/,
    );
    await expect(retryableAction).toBeVisible();

    await trailer.evaluate((video: HTMLVideoElement) => {
      (video as HTMLVideoElement & { playbackMode?: string }).playbackMode = "success";
    });
    await retryableAction.click({ force: true });
    await expect(disclosure.locator('[data-playback-state="playing"]')).toBeVisible();

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await setDisclosureOpen(false);
      await setDisclosureOpen(true);
      await expect(retryableAction).toBeVisible();
      await retryableAction.click({ force: true });
      await expect(disclosure.locator('[data-playback-state="playing"]')).toBeVisible();
    }

    await setDisclosureOpen(false);
    await setDisclosureOpen(true);
    await trailer.evaluate((video: HTMLVideoElement) => {
      (video as HTMLVideoElement & { playbackMode?: string }).playbackMode = "error";
    });
    await retryableAction.click({ force: true });
    await expect(disclosure.locator('[data-playback-state="error"]')).toBeVisible();
    await expect(disclosure).toContainText("This trailer could not play here.");
    await expect(page.getByRole("button", { name: `Retry ${app.name} trailer` })).toBeVisible();

    await setDisclosureOpen(false);
    await setDisclosureOpen(true);
    await expect(disclosure.locator('[data-playback-state="error"]')).toBeVisible();
    await expect(page.getByRole("button", { name: `Retry ${app.name} trailer` })).toBeVisible();

    await trailer.evaluate((video: HTMLVideoElement) => {
      (video as HTMLVideoElement & { playbackMode?: string }).playbackMode = "success";
    });
    await page.getByRole("button", { name: `Retry ${app.name} trailer` }).click({ force: true });
    await expect(disclosure.locator('[data-playback-state="playing"]')).toBeVisible();

    await setDisclosureOpen(false);
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
    ).toHaveAttribute("src", app.trailer.poster.src);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${productIdentity.canonicalOrigin}/apps/${app.slug}`,
    );
    await expect(page.getByText(app.description)).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: app.detail.headline }),
    ).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(app.detail.capabilities.length);

    for (const capability of app.detail.capabilities) {
      await expect(page.getByRole("heading", { level: 3, name: capability.title })).toBeVisible();
      await expect(page.getByText(capability.description)).toBeVisible();
    }

    await expect(page.getByRole("heading", { name: app.latestUpdate })).toBeVisible();
    await expect(page.getByText(app.detail.statusSummary)).toBeVisible();

    const openApp = page.getByRole("link", { name: `Open ${app.name}` });
    await expect(openApp).toHaveAttribute("href", app.origin.current);
    await expect(openApp).toHaveAttribute("target", "_blank");
    await expect(openApp).toHaveAttribute("rel", "noreferrer");

    await expect(page.locator(".app-screenshots-section")).toHaveCount(0);

    const launchApp = page.getByRole("link", { name: `Launch ${app.name}` });
    await expect(launchApp).toHaveAttribute("href", app.origin.current);
    await expect(page.locator(".app-detail-cta").getByRole("link", { name: "All apps" })).toHaveAttribute(
      "href",
      "/apps",
    );

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
    await expect(page.locator("body")).toContainText(
      `Verified ${app.name} feedback, when it is ready.`,
    );
    await expect(page.locator("body")).toContainText("No rating or count is implied today.");
    await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
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

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect.poll(
    () => trailer.evaluate((video: HTMLVideoElement) => video.paused),
    { message: "keyboard-collapsed trailer should pause" },
  ).toBe(true);

  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect.poll(
    () => trailer.evaluate((video: HTMLVideoElement) => video.paused),
    { message: "keyboard-reopened trailer should remain paused" },
  ).toBe(true);
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

test("the retired Fitness screenshot-board URL has a permanent trailer redirect", async () => {
  const vercelConfig = JSON.parse(await readFile(resolve(process.cwd(), "vercel.json"), "utf8"));

  expect(vercelConfig.redirects).toContainEqual({
    source: "/apps/fitness/preview",
    destination: "/apps/fitness#fitness-trailer",
    permanent: true,
  });
});

test("public routes load without browser errors or framework overlays", async ({ context }, testInfo) => {
  for (const route of [
    "/",
    "/apps",
    "/apps/fitness",
    "/apps/mazer",
    "/discover",
    "/newsletter",
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
  "/newsletter",
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
    "/newsletter",
    "/trove",
  ];
  const destinations = [
    ["Apps", "/apps"],
    ["Discover", "/discover"],
    ["Newsletter", "/newsletter"],
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

      expect(geometry.brandBottom, `${route} at ${width}px`).toBeLessThanOrEqual(
        geometry.linksTop + 1,
      );
      expect(geometry.linksLeft).toBeGreaterThanOrEqual(geometry.navLeft);
      expect(geometry.linksRight).toBeLessThanOrEqual(geometry.navRight);
      expect(geometry.linksScrollWidth).toBeLessThanOrEqual(geometry.linksClientWidth);
      expect(geometry.targetsInsideNav).toBe(true);
      expect(geometry.minimumTargetHeight).toBeGreaterThanOrEqual(44);
      await expect(primaryNav.locator('a[aria-current="page"]')).toHaveCount(1);
    }
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/newsletter");
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
    "/newsletter",
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
