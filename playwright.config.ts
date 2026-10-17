import { defineConfig, devices } from "@playwright/test";

const testPort = process.env.FAWXZZYWEB_TEST_PORT ?? "3210";
if (!["3210", "4312"].includes(testPort)) {
  throw new Error("FAWXZZYWEB_TEST_PORT must be 3210 or 4312");
}
const testOrigin = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: testOrigin,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 14"] },
    },
  ],
  webServer: {
    command: `npm run start -- --host 127.0.0.1 --port ${testPort}`,
    url: `${testOrigin}/healthz.json`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
