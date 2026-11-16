import { defineConfig, devices } from "@playwright/test";

const testPort = process.env.FAWXZZYWEB_TEST_PORT ?? "3210";
if (!["3210", "4312"].includes(testPort)) {
  throw new Error("FAWXZZYWEB_TEST_PORT must be 3210 or 4312");
}
const testOrigin = `http://127.0.0.1:${testPort}`;

// CI splits the e2e run across parallel jobs (see .github/workflows/ci.yml). These two specs hold most of the
// wall time, so they get their own jobs and everything else runs together. Selection is by construction:
// "slow" = exactly these files, "fast" = every other file, unset = all files (local default). A new spec lands
// in "fast" automatically, so no test can be dropped by the split.
const slowSpecs = [/account-no-scroll\.spec\.ts$/, /account-portal\.spec\.ts$/];
const e2eGroup = process.env.E2E_GROUP || undefined;
if (e2eGroup !== undefined && !["slow", "fast"].includes(e2eGroup)) {
  throw new Error("E2E_GROUP must be unset, slow or fast");
}

export default defineConfig({
  testDir: "./tests/e2e",
  ...(e2eGroup === "slow" ? { testMatch: slowSpecs } : {}),
  ...(e2eGroup === "fast" ? { testIgnore: slowSpecs } : {}),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Specs are file-isolated (per-test context + auth_test fakes, no shared server state), so CI runs files on
  // PLAYWRIGHT_WORKERS (default 2) workers against the one server. Tests inside a file stay in order
  // (fullyParallel false). Local runs stay at 1 unless PLAYWRIGHT_WORKERS is set.
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? 2 : 1)),
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
