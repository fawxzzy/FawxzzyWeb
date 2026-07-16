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
    throw new Error(`${path} did not include the expected FawxzzyWeb contract text.`);
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

  const appsHtml = await assertRoute(baseUrl, "/apps", "Apps, grounded in their real homes.");
  for (const origin of appOrigins) {
    if (!appsHtml.includes(origin)) {
      throw new Error(`/apps did not include grounded app origin ${origin}.`);
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

  await assertRoute(baseUrl, "/apps/fitness/preview", "Layered screen slots");

  const healthResponse = await fetch(`${baseUrl}/healthz.json`);
  if (!healthResponse.ok) {
    throw new Error(`Health route returned ${healthResponse.status}.`);
  }

  const health = await healthResponse.json();
  if (
    health.status !== "ok" ||
    health.app !== "fawxzzyweb" ||
    health.catalogCapability !== "trove"
  ) {
    throw new Error("Health payload did not match the FawxzzyWeb compatibility contract.");
  }

  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  if (!manifestResponse.ok) {
    throw new Error("Manifest route did not respond successfully.");
  }

  const manifest = await manifestResponse.json();
  if (manifest.name !== "FawxzzyWeb" || manifest.start_url !== "/") {
    throw new Error("Manifest identity did not match the FawxzzyWeb root contract.");
  }
}
