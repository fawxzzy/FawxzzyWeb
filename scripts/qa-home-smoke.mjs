import { assertSiteSmoke } from "./assert-site-smoke.mjs";

const baseUrl =
  process.env.FAWXZZYWEB_BASE_URL ??
  process.env.TROVE_BASE_URL ??
  "http://127.0.0.1:3000";

assertSiteSmoke(baseUrl).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
