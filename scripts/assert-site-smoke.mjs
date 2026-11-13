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
  // Fawxzzy has no home page. Vercel redirects `/` to Apps before the file is served; this
  // static fallback must still answer and hand visitors on to Apps.
  const rootHtml = await assertRoute(baseUrl, "/", "Opening Apps.");
  if (!rootHtml.includes('http-equiv="refresh" content="0;url=/apps"')) {
    throw new Error("The root fallback did not ask the browser to continue to Apps.");
  }
  if (!rootHtml.includes('data-compatibility-identity="home"')) {
    throw new Error("The root fallback did not render its compatibility identity.");
  }
  if (!rootHtml.includes('href="/apps"')) {
    throw new Error("The root fallback did not link directly to the canonical Apps page.");
  }
  for (const retired of [
    "Built by Fawxzzy.",
    "Creator. Builder. Fitness. Gamer.",
    "/brand/fawxzzy-banner-v2-hero.webp",
    "creator-profile",
    "storefront-hero",
  ]) {
    if (rootHtml.includes(retired)) {
      throw new Error(`The root fallback still rendered retired Home content: ${retired}.`);
    }
  }
  if (rootHtml.includes("data-app-card") || rootHtml.includes("data-app-launcher")) {
    throw new Error("The root fallback duplicated the app catalog instead of pointing to it.");
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
  if (!appsHtml.includes('href="https://account.fawxzzy.com/account"')) {
    throw new Error("The app catalog did not link to the canonical Fawxzzy account.");
  }
  if (appsHtml.includes(">Home</a>") || appsHtml.includes(">Discover</a>")) {
    throw new Error("The shared navigation or footer still exposed a retired Home or Discover link.");
  }
  if (appsHtml.includes('href="/newsletter"')) {
    throw new Error("The app catalog still linked to the retired newsletter archive.");
  }
  const footerHtml = appsHtml.slice(appsHtml.indexOf('aria-label="Footer"'));
  const footerNavHtml = footerHtml.slice(0, footerHtml.indexOf("</nav>"));
  const footerLinks = [...footerNavHtml.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((match) => match[1]);
  if (JSON.stringify(footerLinks) !== JSON.stringify(["Apps", "Account"])) {
    throw new Error(`The shared footer exposed unexpected links: ${footerLinks.join(", ")}.`);
  }

  const discoverHtml = await assertRoute(
    baseUrl,
    "/discover",
    "Everything is together now.",
  );
  if (!discoverHtml.includes('data-compatibility-identity="discover"')) {
    throw new Error("Discover compatibility identity was not rendered.");
  }
  if (!discoverHtml.includes('href="/apps"')) {
    throw new Error("/discover did not point to the canonical Apps page.");
  }
  if (discoverHtml.includes("data-app-card") || discoverHtml.includes("data-product-showcase")) {
    throw new Error("/discover duplicated product content instead of remaining lightweight.");
  }
  const externalDiscoverLinks = [...discoverHtml.matchAll(/<a [^>]*href="(https?:[^"]+)"/g)]
    .map((match) => match[1])
    .filter((href) => !href.startsWith("https://account.fawxzzy.com/"));
  if (externalDiscoverLinks.length > 0) {
    throw new Error(`/discover rendered retired external destinations: ${externalDiscoverLinks.join(", ")}.`);
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
    ["/account", ">Account<"],
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
    manifest.start_url !== "/apps"
  ) {
    throw new Error("Manifest identity did not match the Fawxzzy public-brand contract.");
  }
}
