import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { accountContract } from "../../src/config/account";
import {
  MAZER_OAUTH_DENIAL_DESCRIPTION,
  MAZER_OAUTH_REDIRECT_URI,
  mazerSignInNoticeUrl,
  sanitizeMazerOAuthApprovalRedirect,
  sanitizeMazerOAuthDenialRedirect,
  type MazerSignInNotice,
} from "../../src/lib/auth/mazer-oauth";

// Negative tests for first-party consent removal (no consent card for Mazer) and device-level
// auto sign-in. The portal never sees PKCE: Supabase's authorization server holds the code challenge
// and checks the verifier at the token endpoint, so PKCE is covered here only as "request
// parameters are never trusted" (see docs/mazer-oauth-threat-model.md).

const state = "s".repeat(43);
const authorizationId = "authorization-id-1234567890";
const mazerDetails = {
  clientId: "local-mazer-oauth-client",
  clientName: "Mazer",
  redirectUri: MAZER_OAUTH_REDIRECT_URI,
  scope: "email",
  userId: "preview-user",
};

type GatewayOptions = {
  details?: Partial<typeof mazerDetails>;
  read?: { status: number } | { redirectUrl: string };
  approveRedirect?: string;
};

type GatewayLog = { posts: unknown[]; reads: number; decisions: number; deletes: number };

async function installGateway(context: BrowserContext, options: GatewayOptions = {}) {
  const log: GatewayLog = { posts: [], reads: 0, decisions: 0, deletes: 0 };
  let pending: { authGeneration: string } | null = null;
  await context.route("**/api/account/mazer-oauth-pending", async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "POST") {
      const body = request.postDataJSON() as { authGeneration: string };
      log.posts.push(body);
      pending = { authGeneration: body.authGeneration };
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "DELETE") {
      log.deletes += 1;
      pending = null;
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "PATCH") {
      if (!pending) {
        await route.fulfill({ status: 404 });
        return;
      }
      pending = { authGeneration: (request.postDataJSON() as { authGeneration: string }).authGeneration };
      await route.fulfill({ status: 204 });
      return;
    }
    if (!pending) {
      await route.fulfill({ status: 404 });
      return;
    }
    if (method === "PUT") {
      log.decisions += 1;
      pending = null;
      await route.fulfill({
        body: JSON.stringify({
          redirectUrl: options.approveRedirect ?? `${MAZER_OAUTH_REDIRECT_URI}?code=local-code&state=${state}`,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    log.reads += 1;
    const read = options.read;
    if (read && "status" in read) {
      await route.fulfill({ status: read.status });
      return;
    }
    await route.fulfill({
      body: JSON.stringify(
        read
          ? { kind: "redirect", redirectUrl: read.redirectUrl }
          : { kind: "authorization", details: { ...mazerDetails, ...options.details } },
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  return log;
}

async function expectBackToMazer(page: Page, notice: MazerSignInNotice) {
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    `${MAZER_OAUTH_REDIRECT_URI}?notice=${notice}`,
  );
  await expect(page.locator('[data-auth-surface="oauth-consent"]')).toHaveCount(0);
}

async function expectUnsafeFallback(page: Page) {
  const fallback = page.locator('[data-auth-surface="oauth"][data-auth-state="unsafe"]');
  await expect(fallback).toBeVisible();
  await expect(fallback.locator(".auth-dock__button")).toHaveAttribute("href", accountContract.productOrigins.mazer);
  await expect(page.locator('[data-auth-surface="oauth-consent"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to Mazer" })).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-oauth-redirect", /.+/);
}

test.describe("notice and redirect contract (unit)", () => {
  test("the notice destination is the constant Mazer origin with one closed key", () => {
    for (const notice of ["expired", "unavailable"] as const) {
      const url = new URL(mazerSignInNoticeUrl(notice));
      expect(url.origin).toBe(accountContract.productOrigins.mazer);
      expect(url.pathname).toBe("/");
      expect([...url.searchParams.keys()]).toEqual(["notice"]);
      expect(url.searchParams.get("notice")).toBe(notice);
      expect(url.hash).toBe("");
      // A notice can never be mistaken for an OAuth callback.
      expect(sanitizeMazerOAuthApprovalRedirect(url.href)).toBeNull();
      expect(sanitizeMazerOAuthDenialRedirect(url.href)).toBeNull();
    }
    // Anything outside the closed set collapses to `expired`; no caller value reaches the URL.
    expect(mazerSignInNoticeUrl("https://attacker.example/" as MazerSignInNotice)).toBe(
      `${MAZER_OAUTH_REDIRECT_URI}?notice=expired`,
    );
  });

  test("state handling: exactly one 43-character URL-safe state on the exact Mazer redirect", () => {
    const good = `${MAZER_OAUTH_REDIRECT_URI}?code=one-time&state=${state}`;
    expect(sanitizeMazerOAuthApprovalRedirect(good)).toBe(good);
    for (const hostile of [
      `${MAZER_OAUTH_REDIRECT_URI}?code=one-time`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=one-time&state=`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=one-time&state=${"s".repeat(42)}`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=one-time&state=${"s".repeat(44)}`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=one-time&state=${"s".repeat(42)}%2B`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=one-time&state=${state}&state=${state}`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=one&code=two&state=${state}`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=&state=${state}`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=one-time&state=${state}#fragment`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=${"c".repeat(4096)}&state=${state}`,
      `http://mazer.fawxzzy.com/?code=one-time&state=${state}`,
      `https://mazer.fawxzzy.com:8443/?code=one-time&state=${state}`,
      `https://user:pass@mazer.fawxzzy.com/?code=one-time&state=${state}`,
      `https://mazer.fawxzzy.com.attacker.example/?code=one-time&state=${state}`,
      `https://attacker.example/?next=https://mazer.fawxzzy.com/&code=one-time&state=${state}`,
      `https://mazer.fawxzzy.com//attacker.example/?code=one-time&state=${state}`,
      `${MAZER_OAUTH_REDIRECT_URI}?code=one-time&state=${state}&redirect_uri=https://attacker.example/`,
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(sanitizeMazerOAuthApprovalRedirect(hostile), String(hostile).slice(0, 80)).toBeNull();
    }
    const denial = `${MAZER_OAUTH_REDIRECT_URI}?error=access_denied&error_description=${encodeURIComponent(MAZER_OAUTH_DENIAL_DESCRIPTION)}`;
    expect(sanitizeMazerOAuthDenialRedirect(denial)).toBeNull();
    expect(sanitizeMazerOAuthDenialRedirect(`${denial}&state=${state}&state=${state}`)).toBeNull();
    expect(sanitizeMazerOAuthDenialRedirect(`${denial}&state=${state}`)).toBe(`${denial}&state=${state}`);
  });
});

test.describe("first-party consent removal (page)", () => {
  test("an already signed-in portal session authorizes silently: no sign-in, no card", async ({ context, page }) => {
    const log = await installGateway(context);
    const visited: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
    });
    await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
    await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
      `${MAZER_OAUTH_REDIRECT_URI}?code=local-code&state=${state}`,
    );
    expect(visited.every((pathname) => pathname === "/oauth/authorize")).toBe(true);
    await expect(page.locator('[data-auth-surface="oauth-consent"]')).toHaveCount(0);
    expect(log.decisions).toBe(1);
  });

  test("an unregistered client is rejected without a card, an approval, or a redirect", async ({ context, page }) => {
    const log = await installGateway(context, { details: { clientId: "some-other-client" } });
    await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
    await expectUnsafeFallback(page);
    expect(log.decisions).toBe(0);
    expect(log.deletes).toBeGreaterThan(0);
  });

  test("a third-party client gets no consent path, even when it calls itself Mazer", async ({ context, page }) => {
    const log = await installGateway(context, {
      details: {
        clientId: "third-party-client",
        clientName: "Mazer",
        redirectUri: "https://third-party.example/callback",
      },
    });
    await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
    await expectUnsafeFallback(page);
    await expect(page.locator("body")).not.toContainText("third-party.example");
    expect(log.decisions).toBe(0);
  });

  for (const [label, redirectUri] of [
    ["path", "https://mazer.fawxzzy.com/callback"],
    ["host lookalike", "https://mazer.fawxzzy.com.attacker.example/"],
    ["scheme", "http://mazer.fawxzzy.com/"],
    ["missing slash", "https://mazer.fawxzzy.com"],
  ] as const) {
    test(`a redirect URI mismatch (${label}) on the Mazer client is rejected`, async ({ context, page }) => {
      const log = await installGateway(context, { details: { redirectUri } });
      await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
      await expectUnsafeFallback(page);
      expect(log.decisions).toBe(0);
    });
  }

  test("a wider scope on the Mazer client is rejected", async ({ context, page }) => {
    const log = await installGateway(context, { details: { scope: "email profile" } });
    await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
    await expectUnsafeFallback(page);
    expect(log.decisions).toBe(0);
  });

  test("an expired or unknown request goes back to Mazer's sign-in with a notice", async ({ context, page }) => {
    const log = await installGateway(context, { read: { status: 404 } });
    await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
    await expectBackToMazer(page, "expired");
    expect(log.decisions).toBe(0);
  });

  test("a request started under another account goes back to Mazer's sign-in", async ({ context, page }) => {
    const log = await installGateway(context, { details: { userId: "someone-else" } });
    await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
    await expectBackToMazer(page, "expired");
    expect(log.decisions).toBe(0);
  });

  test("an account-service failure goes back to Mazer's sign-in as unavailable", async ({ context, page }) => {
    const log = await installGateway(context, { read: { status: 500 } });
    await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
    await expectBackToMazer(page, "unavailable");
    expect(log.decisions).toBe(0);
  });

  test("raw OAuth parameters (client, redirect, plain PKCE, state) without a provider request are never used", async ({ context, page }) => {
    const log = await installGateway(context);
    const hostile = new URLSearchParams({
      client_id: "local-mazer-oauth-client",
      redirect_uri: "https://attacker.example/",
      response_type: "code",
      code_challenge: "plain-verifier-value",
      code_challenge_method: "plain",
      state,
      auth_test: "session",
    });
    await page.goto(`/oauth/authorize?${hostile}`);
    await expectBackToMazer(page, "expired");
    expect(log.posts).toHaveLength(0);
    expect(log.decisions).toBe(0);
  });

  test("open-redirect parameters next to a valid request are ignored", async ({ context, page }) => {
    const log = await installGateway(context);
    const query = new URLSearchParams({
      authorization_id: authorizationId,
      redirect_uri: "https://attacker.example/",
      returnTo: "https://attacker.example/",
      next: "//attacker.example/",
      code_challenge_method: "plain",
      auth_test: "session",
    });
    await page.goto(`/oauth/authorize?${query}`);
    await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
      `${MAZER_OAUTH_REDIRECT_URI}?code=local-code&state=${state}`,
    );
    // Only the provider handle and the device generation are sent; nothing else from the URL.
    expect(log.posts).toHaveLength(1);
    expect(Object.keys(log.posts[0] as object).sort()).toEqual(["authGeneration", "authorizationId"]);
  });

  for (const [label, approveRedirect] of [
    ["another origin", `https://attacker.example/?code=stolen&state=${state}`],
    ["missing state", `${MAZER_OAUTH_REDIRECT_URI}?code=local-code`],
    ["duplicated state", `${MAZER_OAUTH_REDIRECT_URI}?code=local-code&state=${state}&state=${state}`],
    ["extra key", `${MAZER_OAUTH_REDIRECT_URI}?code=local-code&state=${state}&next=https://attacker.example/`],
  ] as const) {
    test(`an approval that comes back with ${label} is not followed`, async ({ context, page }) => {
      const log = await installGateway(context, { approveRedirect });
      await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
      await expectUnsafeFallback(page);
      expect(log.decisions).toBe(1);
    });
  }

  test("an already-approved redirect to another origin is not followed", async ({ context, page }) => {
    const log = await installGateway(context, { read: { redirectUrl: `https://attacker.example/?code=stolen&state=${state}` } });
    await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
    await expectUnsafeFallback(page);
    expect(log.decisions).toBe(0);
  });
});
