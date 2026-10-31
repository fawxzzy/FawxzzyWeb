import { expect, test, type BrowserContext } from "@playwright/test";

const testPort = process.env.FAWXZZYWEB_TEST_PORT ?? "3210";
const accountOrigin = `http://127.0.0.1:${testPort}`;
const collector = "https://collector.invalid";
const hasCollector = process.env.NEXT_PUBLIC_FAWXZZY_ANALYTICS_URL === collector;

async function accountFixture(context: BrowserContext) {
  const events: unknown[] = [];
  const privateCalls: string[] = [];
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
  await context.route(`${accountOrigin}/api/operations/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    privateCalls.push(path);
    await route.fulfill({ status: 403, json: { error: "OPS_ACCESS_DENIED" } });
  });
  return { events, privateCalls };
}

function projectPath(signedIn: boolean) {
  return `/projects${signedIn ? "?auth_test=session" : "?auth_test=success"}`;
}

test("one signed-in Projects visit counts on the default board and board switches do not recount", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  await page.goto(projectPath(true));
  await expect.poll(() => fixture.events.length).toBe(1);
  expect(fixture.events).toEqual([{ event: "page_view", product: "web", route: "/projects" }]);
  expect(fixture.privateCalls).toEqual([]);
  await page.getByRole("navigation", { name: "Project boards" }).getByRole("button", { name: /Fawxzzy Web/u }).click();
  await expect.poll(() => fixture.privateCalls.length).toBeGreaterThan(0);
  const webBoardCalls = fixture.privateCalls.length;
  await page.getByRole("navigation", { name: "Project boards" }).getByRole("button", { name: /Fitness/u }).click();
  await expect.poll(() => fixture.privateCalls.length).toBe(webBoardCalls);
  expect(fixture.events).toHaveLength(1);
  await page.reload();
  await expect.poll(() => fixture.events.length).toBe(2);
  expect(fixture.events[1]).toEqual({ event: "page_view", product: "web", route: "/projects" });
});

test("a late sign-in on mounted signed-out Projects counts the view once", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  await page.goto("/projects?auth_test=success&late_sign_in=1");
  await page.getByRole("navigation", { name: "Project boards" }).getByRole("button", { name: /Fawxzzy Web/u }).click();

  const projects = page.getByRole("region", { name: "Private projects" });
  await expect(projects.getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(fixture.events).toEqual([]);
  await projects.getByRole("button", { name: "Complete local sign-in" }).click();
  await expect.poll(() => fixture.events.length).toBe(1);
  expect(fixture.events).toEqual([{ event: "page_view", product: "web", route: "/projects" }]);
});

test("signed-out account Projects does not emit a page view", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  await page.goto(projectPath(false));
  await page.getByRole("navigation", { name: "Project boards" }).getByRole("button", { name: /Fawxzzy Web/u }).click();
  await expect(page.getByRole("region", { name: "Private projects" }).getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(fixture.events).toEqual([]);
  expect(fixture.privateCalls).toEqual([]);
});

test("another account route does not emit a Projects event", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  await page.goto("/account?auth_test=session");
  await expect(page.getByRole("main")).toBeVisible();
  expect(fixture.events).toEqual([]);
  expect(fixture.privateCalls).toEqual([]);
});

test("signed-out Projects remains uncounted while switching boards", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  await page.goto(projectPath(false));
  await page.getByRole("navigation", { name: "Project boards" }).getByRole("button", { name: /Fawxzzy Web/u }).click();
  await expect(page.getByRole("region", { name: "Private projects" }).getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.getByRole("navigation", { name: "Project boards" }).getByRole("button", { name: /Fitness/u }).click();
  expect(fixture.events).toEqual([]);
  expect(fixture.privateCalls).toEqual([]);
});

test("signed-in Projects without an analytics endpoint emits no event", async ({ context, page }) => {
  test.skip(hasCollector, "requires the isolated build without a collector");
  const fixture = await accountFixture(context);
  await page.goto(projectPath(true));
  await expect(page.getByRole("navigation", { name: "Project boards" })).toBeVisible();
  expect(fixture.events).toEqual([]);
  expect(fixture.privateCalls).toEqual([]);
});

test("switching away discards a late private response without recounting the visit", async ({ context, page }) => {
  test.skip(!hasCollector, "requires the isolated dummy collector build");
  const fixture = await accountFixture(context);
  let releaseRead = () => {};
  const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  let readCount = 0;
  await context.route(`${accountOrigin}/api/operations/read`, async (route) => {
    readCount += 1;
    if (readCount === 1) {
      await heldRead;
      await route.fulfill({ status: 200, json: {
        health: "healthy", authoritative: true, actions_enabled: false,
        projection_revision: `sha256:${"a".repeat(64)}`,
        source_watermark: [{ producer_identity: "github-repository:1301080630", source_revision: "b".repeat(40) }],
        cards: [{
          stable_id: `card:${Buffer.from("github-repository:1301080630").toString("base64url")}:fixture`,
          title: "LATE_PRIVATE_CARD_MUST_NOT_RENDER", lifecycle: "review", owner_role: "fixture.owner",
          created_at: "2026-10-15T12:00:00Z", updated_at: "2026-10-15T12:00:00Z",
          dependency_ids: [], blocker_codes: [], evidence_handles: [], supersedes_id: null,
        }],
      } });
    } else {
      await route.fulfill({ status: 403, json: { error: "OPS_ACCESS_DENIED" } });
    }
  });
  await page.goto(projectPath(true));
  await expect.poll(() => fixture.events.length).toBe(1);
  const boards = page.getByRole("navigation", { name: "Project boards" });
  await boards.getByRole("button", { name: /Fawxzzy Web/u }).click();
  await expect.poll(() => readCount).toBe(1);
  await boards.getByRole("button", { name: /Fitness/u }).click();
  releaseRead();
  await boards.getByRole("button", { name: /Fawxzzy Web/u }).click();
  await expect(page.getByRole("region", { name: "Private projects" }).getByRole("status"))
    .toContainText("Private access is not available");
  await expect(page.getByText("LATE_PRIVATE_CARD_MUST_NOT_RENDER")).toHaveCount(0);
  expect(fixture.events).toHaveLength(1);
});
