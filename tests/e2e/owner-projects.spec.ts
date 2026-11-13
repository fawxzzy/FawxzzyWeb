import { expect, test, type Page } from "@playwright/test";
import { readOwnerBoardSnapshot } from "../../src/server/projects/owner-board-file.mjs";

// Projects is the owner's private view. The static site holds no board data; these tests
// stand in for the server (the real handler is covered by tests/owner-projects-http.test.mjs)
// and prove the browser shows the tab and cards only when the server says "owner".
const snapshot = readOwnerBoardSnapshot();
const boards: Array<{ id: string; name: string; cards: Array<{ id: string; title: string }> }> = snapshot.boards;
const sampleCard = boards[1].cards[0];
const labels: Record<string, string> = { fitness: "Fawxzzy Fitness", mazer: "Mazer", trove: "Fawxzzy Web", "atlas-stack": "Atlas Stack" };
const BEARER = "Bearer local-session-oauth-token-1234567890";

type Reply = "owner" | "other-account" | "unavailable";

async function serverFixture(page: Page, reply: Reply) {
  const calls: string[] = [];
  const external: string[] = [];
  await page.route("https://**/*", (route) => {
    external.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  await page.route("**/api/projects/*", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.split("/").at(-1);
    calls.push(`${request.method()} ${endpoint}`);
    expect(request.headers().authorization).toBe(BEARER);
    expect(request.headers()["x-fawxzzy-projects"]).toBe("1");
    const headers = { "Cache-Control": "private, no-store, max-age=0" };
    if (reply === "owner") {
      return route.fulfill({ status: 200, headers, json: endpoint === "access" ? { owner: true } : snapshot });
    }
    if (reply === "other-account") return route.fulfill({ status: 403, headers, json: { error: "PROJECTS_ACCESS_DENIED" } });
    return route.fulfill({ status: 503, headers, json: { error: "PROJECTS_UNAVAILABLE" } });
  });
  return { calls, external };
}

const projectsLink = (page: Page) => page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Projects" });

test("signed out: no Projects tab, no board data, and no request to the owner endpoints", async ({ page }) => {
  const server = await serverFixture(page, "owner");
  await page.goto("/apps?auth_test=success");
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Apps", exact: true })).toBeVisible();
  await expect(projectsLink(page)).toHaveCount(0);

  // Signed-out visitors are sent to sign in; nothing about Projects is ever rendered.
  await page.goto("/projects?auth_test=success");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprojects$/u);
  await expect(page.getByRole("heading", { name: "Projects" })).toHaveCount(0);
  await expect(projectsLink(page)).toHaveCount(0);
  expect(server.calls).toEqual([]);
  expect(await page.content()).not.toContain(sampleCard.title);
});

test("a page with no account service (main site) never shows the tab and sends /projects to the account origin", async ({ page }) => {
  const server = await serverFixture(page, "owner");
  const requested: string[] = [];
  await page.route("https://account.fawxzzy.com/**", (route) => {
    requested.push(route.request().url());
    return route.abort();
  });
  await page.goto("/apps");
  await expect(projectsLink(page)).toHaveCount(0);
  await page.goto("/projects", { waitUntil: "commit" });
  await expect.poll(() => requested).toContain("https://account.fawxzzy.com/projects");
  expect(server.calls).toEqual([]);
});

test("signed in as another account: no tab, a neutral message, and no cards", async ({ page }) => {
  const server = await serverFixture(page, "other-account");
  await page.goto("/apps?auth_test=session");
  await expect.poll(() => server.calls.length).toBeGreaterThan(0);
  await expect(projectsLink(page)).toHaveCount(0);

  await page.goto("/projects?auth_test=session");
  // Indistinguishable from a page that does not exist.
  await expect(page.getByRole("heading", { name: "This page is not here." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Project boards" })).toHaveCount(0);
  expect(server.calls).toContain("GET board");
  expect(await page.content()).not.toContain(sampleCard.title);
});

test("a server outage shows the same neutral state, never cards or the tab", async ({ page }) => {
  await serverFixture(page, "unavailable");
  await page.goto("/projects?auth_test=session");
  await expect(page.getByRole("heading", { name: "This page is not here." })).toBeVisible();
  await expect(projectsLink(page)).toHaveCount(0);
});

test("the owner sees the tab and every board; the static page itself carries no cards", async ({ page, browserName }) => {
  async function activate(target: ReturnType<typeof page.getByRole>) {
    if (browserName !== "webkit") return target.click();
    await target.evaluate((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
    const box = await target.boundingBox();
    if (!box) throw new Error("Mobile target has no visible bounds");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }
  // The static HTML a signed-out visitor receives has neither the tab nor any card text.
  const staticHtml = await (await page.request.get("/projects")).text();
  for (const needle of [sampleCard.title, "FW-ANALYTICS-001", "lane-security-containment", "FF-MKT-001", "Project boards", "Projects is private"]) {
    expect(staticHtml).not.toContain(needle);
  }
  expect(staticHtml).not.toMatch(/<title>[^<]*Projects/u);

  const server = await serverFixture(page, "owner");
  await page.goto("/apps?auth_test=session");
  await expect(projectsLink(page)).toBeVisible();
  await expect(projectsLink(page)).toHaveAttribute("href", "/projects");

  await page.goto("/projects?auth_test=session");
  await expect(projectsLink(page)).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Board snapshot accepted", { exact: false })).toBeVisible();
  await expect(page.getByText("Only your account can see these boards.")).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Project boards" });
  await expect(navigation.getByRole("button")).toHaveCount(4);
  for (const board of boards) {
    const label = labels[board.id];
    await activate(navigation.getByRole("button", { name: `${label}, ${board.cards.length} cards` }));
    await expect(page.getByRole("heading", { name: label, level: 1 })).toBeVisible();
    // The page lists open and completed cards separately; the tab count is their sum.
    const open = await page.locator(".project-card").count();
    await activate(page.locator(".project-completed__toggle"));
    expect(await page.locator(".project-card").count()).toBe(board.cards.length);
    expect(open).toBeGreaterThan(0);
    await activate(page.locator(".project-completed__toggle"));
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // Nothing is hidden from the owner: cards the old public board withheld are in the snapshot.
  const everyId = boards.flatMap((board) => board.cards.map((card) => card.id));
  for (const shown of ["FW-ANALYTICS-001", "lane-security-containment", "FF-MKT-001"]) expect(everyId).toContain(shown);

  // A card opens its detail dialog and closes again.
  await activate(navigation.getByRole("button", { name: `Mazer, ${boards[1].cards.length} cards` }));
  await activate(page.locator(".project-card", { hasText: sampleCard.title }).first());
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: sampleCard.title })).toBeVisible();
  await expect(dialog.getByText("Accepted board snapshot", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(server.calls).toContain("GET access");
  expect(server.calls).toContain("GET board");
  expect(server.external).toEqual([]);
});

const HINT = "fawxzzy_owner_hint";
const hint = async (page: Page) => (await page.context().cookies()).find((cookie) => cookie.name === HINT)?.value;

test("the account site records the owner hint for the owner and clears it for everyone else", async ({ page }) => {
  await serverFixture(page, "owner");
  await page.goto("/apps?auth_test=session");
  await expect(projectsLink(page)).toBeVisible();
  await expect.poll(() => hint(page)).toBe("1");

  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  await other.addCookies([{ name: HINT, value: "1", url: "http://127.0.0.1:3210" }]);
  await serverFixture(otherPage, "other-account");
  await otherPage.goto("/apps?auth_test=session");
  await expect.poll(() => hint(otherPage)).toBeUndefined();
  await other.close();
});

test("signing in as the owner records the hint before leaving, and signing out clears it", async ({ page, browserName }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  // The sign-in scenario's test adapter issues its own bearer, so this route accepts any.
  await page.route("**/api/projects/access", (route) => route.fulfill({ status: 200, json: { owner: true } }));
  await page.goto("/login?auth_test=success");
  await page.getByLabel("Email or username").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("long-enough-password");
  await page.locator(".account-auth-dock").getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination")).toBeTruthy();
  expect(await hint(page)).toBe("1");

  await page.goto("/account?auth_test=session");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-sign-out-destination")).toBeTruthy();
  expect(await hint(page)).toBeUndefined();
});

test("main-site pages show a Projects link to the account site only while the owner hint is present", async ({ page, context }) => {
  const calls: string[] = [];
  const proxy = async (route: import("@playwright/test").Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) { calls.push(url.pathname); return route.abort(); }
    const response = await route.fetch({ url: `http://127.0.0.1:3210${url.pathname}${url.search}` });
    return route.fulfill({ response });
  };
  await page.route("https://fawxzzy.com/**", proxy);
  await page.route("https://account.fawxzzy.com/**", (route) => route.abort());
  await page.route("https://**/*", (route) => (new URL(route.request().url()).origin === "https://fawxzzy.com" ? proxy(route) : route.abort()));

  await page.goto("https://fawxzzy.com/apps");
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Apps", exact: true })).toBeVisible();
  await expect(projectsLink(page)).toHaveCount(0);

  await context.addCookies([{ name: HINT, value: "1", domain: "fawxzzy.com", path: "/", secure: true }]);
  await page.goto("https://fawxzzy.com/apps");
  await expect(projectsLink(page)).toHaveAttribute("href", "https://account.fawxzzy.com/projects");
  expect(calls).toEqual([]);
});
