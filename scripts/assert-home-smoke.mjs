export async function assertHomeSmoke(baseUrl) {
  const homeResponse = await fetch(`${baseUrl}/`);
  if (!homeResponse.ok) {
    throw new Error(`Home route returned ${homeResponse.status}.`);
  }

  const homeHtml = await homeResponse.text();
  if (!homeHtml.includes("Fawxzzy Trove")) {
    throw new Error("Home page smoke check did not render the Trove shell.");
  }

  const healthResponse = await fetch(`${baseUrl}/healthz.json`);
  if (!healthResponse.ok) {
    throw new Error(`Health route returned ${healthResponse.status}.`);
  }

  const health = await healthResponse.json();
  if (health.status !== "ok" || health.app !== "trove") {
    throw new Error("Health payload did not match the expected Trove contract.");
  }

  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  if (!manifestResponse.ok) {
    throw new Error("Manifest route did not respond successfully.");
  }
}
