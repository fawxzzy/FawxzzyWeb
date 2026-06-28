import { assertHomeSmoke } from "./assert-home-smoke.mjs";

const baseUrl = process.env.TROVE_BASE_URL ?? "http://127.0.0.1:3000";

assertHomeSmoke(baseUrl).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
