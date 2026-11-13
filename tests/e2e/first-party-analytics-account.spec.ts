import { expect, test, type BrowserContext } from "@playwright/test";
import { readOwnerBoardSnapshot } from "../../src/server/projects/owner-board-file.mjs";

const testPort = process.env.FAWXZZYWEB_TEST_PORT ?? "3210";
const accountOrigin = `http://127.0.0.1:${testPort}`;
const collector = "https://collector.invalid";
const hasCollector = process.env.NEXT_PUBLIC_FAWXZZY_ANALYTICS_URL === collector;
const snapshot = readOwnerBoardSnapshot();

// The owner endpoints are stubbed (the real handler is covered by tests/owner-projects-http.test.mjs).
async function accountFixture(context: BrowserContext, owner = true) {
  const events: unknown[] = [];
  const ownerCalls: string[] = [];
  await context.route(`${collector}/**`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": accountOrigin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
      return;
    }
    if (route.request().method() !== "POST") {
      await route.fulfill({ status: 405, headers: { "access-control-allow-origin": accountOrigin } });
      return;
    }
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 204, headers: { "access-control-allow-origin": accountOrigin } });
  });
  await context.route(`${accountOrigin}/api/projects/*`, async (route) => {
    const endpoint = new URL(route.request().url()).pathname.split("/").at(-1);
    ownerCalls.push(endpoint ?? "");
    if (!owner) return route.fulfill({ status: 403, json: { error: "PROJECTS_ACCESS_DENIED" } });
    return route.fulfill({ status: 200, json: endpoint === "access" ? { owner: true } : snapshot });
  });
  return { events, ownerCalls };
}

function projectPath(signedIn: boolean) {
  return `/projects${signedIn ? "?auth_test=session" : "?auth_test=success"}`;
}

test("one owner Projects visit counts once the board loads and board switches do not recount", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  await page.goto(projectPath(true));
  await expect.poll(() => fixture.events.length).toBe(1);
  expect(fixture.events).toEqual([{ event: "page_view", product: "web", route: "/projects" }]);
  const boardCalls = fixture.ownerCalls.length;
  const boards = page.getByRole("navigation", { name: "Project boards" });
  await boards.getByRole("button", { name: /Fawxzzy Web/u }).click();
  await boards.getByRole("button", { name: /Fitness/u }).click();
  expect(fixture.ownerCalls.length).toBe(boardCalls);
  expect(fixture.events).toHaveLength(1);
  await page.reload();
  await expect.poll(() => fixture.events.length).toBe(2);
  expect(fixture.events[1]).toEqual({ event: "page_view", product: "web", route: "/projects" });
});

test("signed-out Projects does not emit a page view and asks the server for nothing", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  await page.goto(projectPath(false));
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprojects$/u);
  expect(fixture.events).toEqual([]);
  expect(fixture.ownerCalls).toEqual([]);
});

test("a signed-in account that is not the owner emits no Projects event", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context, false);
  await page.goto(projectPath(true));
  await expect(page.getByRole("heading", { name: "This page is not here." })).toBeVisible();
  expect(fixture.events).toEqual([]);
});

test("another account route does not emit a Projects event", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  await page.goto("/account?auth_test=session");
  await expect(page.getByRole("main")).toBeVisible();
  expect(fixture.events).toEqual([]);
});

test("owner Projects without an analytics endpoint emits no event", async ({ context, page }) => {
  test.skip(hasCollector, "requires the isolated build without a collector");
  const fixture = await accountFixture(context);
  await page.goto(projectPath(true));
  await expect(page.getByRole("navigation", { name: "Project boards" })).toBeVisible();
  expect(fixture.events).toEqual([]);
});
