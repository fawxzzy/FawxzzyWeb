const appOrigins = [
  "https://fawxzzy-fitness-local.vercel.app",
  "https://fawxzzy-mazer.vercel.app",
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
    "One home for the work, apps, and experiments.",
  );
  if (!homeHtml.includes('href="/apps"')) {
    throw new Error("Home route did not link to the canonical app catalog.");
  }
  if (!homeHtml.includes('/brand/fawxzzy-banner.png')) {
    throw new Error("Home route did not render the shared Fawxzzy brand artwork.");
  }
  if (!homeHtml.includes('href="/discover"')) {
    throw new Error("Home route did not link to the discovery hub.");
  }
  if (!homeHtml.includes('href="/account"')) {
    throw new Error("Home route did not link to the live in-project account surface.");
  }
  if (homeHtml.includes('href="https://account.fawxzzy.com/account"')) {
    throw new Error("Home route published the unattached shared-account origin.");
  }

  const appsHtml = await assertRoute(baseUrl, "/apps", "Apps, grounded in their real homes.");
  for (const origin of appOrigins) {
    if (!appsHtml.includes(origin)) {
      throw new Error(`/apps did not include grounded app origin ${origin}.`);
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
  if (appsHtml.includes("<details")) {
    throw new Error("The retired catalog preview dropdown is still present.");
  }
  if (appsHtml.includes('/brand/trove-foxmark.png')) {
    throw new Error("The retired Trove hero image is still present on /apps.");
  }

  const discoverHtml = await assertRoute(
    baseUrl,
    "/discover",
    "Apps, training, and community",
  );
  for (const target of [
    "https://fawxzzy-fitness-local.vercel.app",
    "https://buy.stripe.com/cNi9AL4a02Qf3T4dA02cg02",
    "https://discord.gg/tnnV7BNJ7h",
    "https://www.tiktok.com/@fukitzzzzz",
    "https://www.youtube.com/@fawxzzy",
  ]) {
    if (!discoverHtml.includes(target)) {
      throw new Error(`/discover did not include grounded destination ${target}.`);
    }
  }
  if (!discoverHtml.includes("Fawxzzy stores no intake or payment state")) {
    throw new Error("The Fitness intake ownership boundary was not rendered.");
  }

  const compatibilityHtml = await assertRoute(
    baseUrl,
    "/trove",
    "reversible compatibility surface",
  );
  if (!compatibilityHtml.includes('data-compatibility-identity="trove"')) {
    throw new Error("Trove compatibility identity was not rendered.");
  }

  await assertRoute(baseUrl, "/apps/fitness/preview", "Layered screen slots");

  const accountRoutes = [
    ["/login", "Your account starts here."],
    ["/account", "One identity. Clear boundaries."],
    ["/auth/confirm", "Confirm your account."],
    ["/auth/callback", "Finish signing in."],
    ["/reset-password", "Recover safely."],
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
