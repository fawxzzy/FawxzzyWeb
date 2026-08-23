import { apps } from "../src/data/apps.ts";

const catalogApps = apps.map((app) => ({
  name: app.name,
  origin: app.origin.current,
}));

async function assertRoute(baseUrl, path, expectedText) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}.`);
  }

  const html = await response.text();
  if (!html.includes(expectedText)) {
    throw new Error(`${path} did not include the expected Fawxzzy public-brand text.`);
  }

  return html;
}
export async function assertSiteSmoke(baseUrl) {
  const homeHtml = await assertRoute(
    baseUrl,
    "/",
    "Train. Play. Keep moving.",
  );
  if (homeHtml.includes("&amp;nearr;") || homeHtml.includes("&nearr;")) {
    throw new Error("Home route rendered a literal named entity in external action text.");
  }
  if (!homeHtml.includes('href="/apps"')) {
    throw new Error("Home route did not link directly to the canonical Apps page.");
  }
  if (!homeHtml.includes('/brand/fawxzzy-banner-v2-hero.webp')) {
    throw new Error("Home route did not render the optimized Fawxzzy hero derivative.");
  }
  if (homeHtml.includes('>Discover</a>')) {
    throw new Error("Home route still exposed a duplicate Discover navigation surface.");
  }
  if (homeHtml.includes('href="/newsletter"')) {
    throw new Error("Home route still linked to the retired newsletter archive.");
  }
  if (!homeHtml.includes('aria-label="Footer"')) {
    throw new Error("Home route did not render the shared site footer.");
  }
  const appsHtml = await assertRoute(
    baseUrl,
    "/apps",
    "How to install my apps",
  );
  for (const app of catalogApps) {
    if (!appsHtml.includes(`href="${app.origin}"`)) {
      throw new Error(`/apps did not link ${app.name} directly to ${app.origin}.`);
    }
    if (!appsHtml.includes(`aria-label="Open ${app.name} app"`)) {
      throw new Error(`/apps did not render the direct app-icon launch action for ${app.name}.`);
    }
    if (appsHtml.includes(`href="/apps/${app.name.toLowerCase()}"`)) {
      throw new Error(`/apps still rendered the retired ${app.name} detail route.`);
    }
  }
  for (const asset of [
    "/apps/fitness/storefront-icon.webp",
    "/apps/fitness/storefront-poster.webp",
    "/apps/mazer/storefront-icon.webp",
    "/apps/mazer/storefront-poster.webp",
  ]) {
    if (!appsHtml.includes(asset)) {
      throw new Error(`/apps did not render centralized catalog asset ${asset}.`);
    }
  }
  const disclosureCount = (appsHtml.match(/<details\b/g) ?? []).length;
  if (disclosureCount !== 0) {
    throw new Error(`/apps rendered ${disclosureCount} retired trailer disclosures.`);
  }
  const primaryTrailerCount = (appsHtml.match(/class="trailer-player"/g) ?? []).length;
  if (primaryTrailerCount !== 0) {
    throw new Error(`/apps rendered ${primaryTrailerCount} trailer players before a product was selected.`);
  }
  if (appsHtml.includes('/brand/trove-foxmark.png')) {
    throw new Error("The retired Trove hero image is still present on /apps.");
  }
  if ((appsHtml.match(/data-app-launcher=/g) ?? []).length !== catalogApps.length) {
    throw new Error("The Apps page did not render one launcher tile per app.");
  }
  if ((appsHtml.match(/data-review-placeholder=/g) ?? []).length !== 0) {
    throw new Error("The app catalog still advertises reviews that do not exist.");
  }
  if (!appsHtml.includes("How to install my apps")) {
    throw new Error("The app catalog did not render the brief installation guide.");
  }
  if (appsHtml.includes("Pick your app.") || appsHtml.includes("App catalog")) {
    throw new Error("The Apps page rendered retired catalog-introduction copy.");
  }
  if (!appsHtml.includes('aria-label="Footer"')) {
    throw new Error("The app catalog did not render the shared site footer.");
  }

  const discoverHtml = await assertRoute(
    baseUrl,
    "/discover",
    "Everything is together now.",
  );
  if (!discoverHtml.includes('data-compatibility-identity="discover"')) {
    throw new Error("Discover compatibility identity was not rendered.");
  }
  if (!discoverHtml.includes('href="/"')) {
    throw new Error("/discover did not point to canonical Home.");
  }
  if (discoverHtml.includes("data-app-card") || discoverHtml.includes("data-product-showcase")) {
    throw new Error("/discover duplicated product content instead of remaining lightweight.");
  }
  for (const retiredTarget of ["youtube.com", "x.com/", "snapchat.com", "twitch.tv", "cash.app", "link.me"]) {
    if (discoverHtml.includes(retiredTarget)) {
      throw new Error(`/discover still rendered retired destination ${retiredTarget}.`);
    }
  }

  const compatibilityHtml = await assertRoute(
    baseUrl,
    "/trove",
    "The app catalog has a shorter name",
  );
  if (!compatibilityHtml.includes('data-compatibility-identity="trove"')) {
    throw new Error("Trove compatibility identity was not rendered.");
  }

  const accountRoutes = [
    ["/login", ">Welcome<"],
    ["/account", "Your account."],
    ["/auth/confirm", "Account confirmation"],
    ["/auth/callback", "Secure sign-in"],
    ["/reset-password", "Password recovery"],
  ];
  for (const [path, expectedText] of accountRoutes) {
    const html = await assertRoute(baseUrl, path, expectedText);
    if (!html.includes("https://account.fawxzzy.com")) {
      throw new Error(`${path} did not carry the canonical shared-account origin.`);
    }
  }

  const healthResponse = await fetch(`${baseUrl}/healthz.json`);
  if (!healthResponse.ok) {
    throw new Error(`Health route returned ${healthResponse.status}.`);
  }

  const health = await healthResponse.json();
  if (
    health.status !== "ok" ||
    health.app !== "fawxzzyweb" ||
    health.accountPortalCapability !== "phase1-source" ||
    health.catalogCapability !== "trove"
  ) {
    throw new Error("Health payload did not match the FawxzzyWeb compatibility contract.");
  }

  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  if (!manifestResponse.ok) {
    throw new Error("Manifest route did not respond successfully.");
  }

  const manifest = await manifestResponse.json();
  if (
    manifest.name !== "Fawxzzy" ||
    manifest.short_name !== "Fawxzzy" ||
    manifest.start_url !== "/"
  ) {
    throw new Error("Manifest identity did not match the Fawxzzy public-brand contract.");
  }
}
