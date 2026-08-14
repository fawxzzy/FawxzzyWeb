const catalogApps = [
  {
    name: "Fitness",
    origin: "https://fawxzzy-fitness-local.vercel.app",
    path: "/apps/fitness",
  },
  {
    name: "Mazer",
    origin: "https://fawxzzy-mazer.vercel.app",
    path: "/apps/mazer",
  },
];

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
    "Focused software, presented clearly.",
  );
  if (!homeHtml.includes('href="/apps"')) {
    throw new Error("Home route did not link to the canonical app catalog.");
  }
  if (!homeHtml.includes('/brand/fawxzzy-banner-v2.png')) {
    throw new Error("Home route did not render the approved V2 Fawxzzy banner.");
  }
  if (!homeHtml.includes('href="/discover"')) {
    throw new Error("Home route did not link to the discovery hub.");
  }
  if (homeHtml.includes('href="/newsletter"')) {
    throw new Error("Home route still linked to the retired newsletter archive.");
  }
  if (!homeHtml.includes('aria-label="Footer"')) {
    throw new Error("Home route did not render the shared site footer.");
  }
  if (homeHtml.includes('>Account</a>')) {
    throw new Error("Primary navigation exposed Account instead of the approved Apps and Discover links.");
  }

  const appsHtml = await assertRoute(
    baseUrl,
    "/apps",
    "Apps built to be used.",
  );
  for (const app of catalogApps) {
    if (!appsHtml.includes(`href="${app.path}"`)) {
      throw new Error(`/apps did not link ${app.name} to ${app.path}.`);
    }
    if (appsHtml.includes(app.origin)) {
      throw new Error(`/apps bypassed the ${app.name} detail route with a direct origin link.`);
    }

    const detailHtml = await assertRoute(baseUrl, app.path, app.name);
    if (!detailHtml.includes(app.origin)) {
      throw new Error(`${app.path} did not include grounded app origin ${app.origin}.`);
    }
    if (!detailHtml.includes('class="trailer-player"') || detailHtml.includes("<details")) {
      throw new Error(`${app.path} did not render one primary trailer without a disclosure.`);
    }
  }
  for (const asset of [
    "/apps/fitness/icon.png",
    "/apps/fitness/trailer.mp4",
    "/apps/mazer/icon.png",
    "/apps/mazer/trailer.mp4",
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
  if (primaryTrailerCount !== catalogApps.length) {
    throw new Error(`/apps rendered ${primaryTrailerCount} primary trailers instead of ${catalogApps.length}.`);
  }
  if (appsHtml.includes('/brand/trove-foxmark.png')) {
    throw new Error("The retired Trove hero image is still present on /apps.");
  }
  if ((appsHtml.match(/data-product-showcase=/g) ?? []).length !== catalogApps.length) {
    throw new Error("The app catalog did not render one visual showcase per app.");
  }
  if ((appsHtml.match(/data-review-placeholder=/g) ?? []).length !== 0) {
    throw new Error("The app catalog still advertises reviews that do not exist.");
  }
  if (!appsHtml.includes('aria-label="Footer"')) {
    throw new Error("The app catalog did not render the shared site footer.");
  }

  const discoverHtml = await assertRoute(
    baseUrl,
    "/discover",
    "Apps here. The build on TikTok.",
  );
  if (!discoverHtml.includes("https://www.tiktok.com/@fukitzzzzz")) {
    throw new Error("/discover did not include the canonical TikTok destination.");
  }
  for (const retiredTarget of ["youtube.com", "x.com/", "snapchat.com", "twitch.tv", "cash.app", "link.me"]) {
    if (discoverHtml.includes(retiredTarget)) {
      throw new Error(`/discover still rendered retired destination ${retiredTarget}.`);
    }
  }

  const compatibilityHtml = await assertRoute(
    baseUrl,
    "/trove",
    "reversible compatibility surface",
  );
  if (!compatibilityHtml.includes('data-compatibility-identity="trove"')) {
    throw new Error("Trove compatibility identity was not rendered.");
  }

  const accountRoutes = [
    ["/login", "Sign in to Fawxzzy."],
    ["/account", "One identity. Clear boundaries."],
    ["/auth/confirm", "Confirm your account."],
    ["/auth/callback", "Finishing sign-in."],
    ["/reset-password", "Recover your account."],
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
