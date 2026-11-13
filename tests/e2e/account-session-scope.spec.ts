import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { accountContract } from "../../src/config/account";
import {
  PORTAL_SIGN_OUT_SCOPES,
  signOutOfPortal,
  validatePortalSession,
} from "../../src/lib/auth/browser-adapter";

/**
 * FF-ACCOUNT-004 (W-2). These tests run the REAL supabase-js client (the exact pinned version the
 * portal ships) against a recording fetch stub, so they prove what the portal sends to the Auth
 * provider and how the SDK reacts to a revoked session. Nothing here reaches a live service and no
 * credential is real: the JWTs are unsigned fixtures the client only decodes for `exp`.
 */

const PROJECT_URL = "https://project.example.test";
const USER_ID = "7d1d3b52-0f5c-4f0e-9a39-3c5f7a8f3b11";

function fixtureJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.fixture-signature`;
}

function userRecord(email: string) {
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { username: "fawxzzy" },
    created_at: "2026-01-01T00:00:00Z",
  };
}

type Recorded = { body: string | null; method: string; path: string; token: string | null };
type Responder = (request: Recorded) => Response;

function createHarness(options: { expiresInSeconds?: number; responder: Responder }) {
  const store = new Map<string, string>();
  const requests: Recorded[] = [];
  const events: string[] = [];
  const expiresAt = Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 3600);
  const accessToken = fixtureJwt({ exp: expiresAt, sub: USER_ID, session_id: "session-1" });
  const stored = {
    access_token: accessToken,
    refresh_token: "fixture-refresh-token-1",
    expires_at: expiresAt,
    expires_in: options.expiresInSeconds ?? 3600,
    token_type: "bearer",
    user: userRecord("cached@example.test"),
  };
  store.set(accountContract.storageKey, JSON.stringify(stored));

  const client = createClient(PROJECT_URL, "sb_publishable_fixturefixturefixturefixture", {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
      storage: {
        getItem: (key) => store.get(key) ?? null,
        removeItem: (key) => { store.delete(key); },
        setItem: (key, value) => { store.set(key, value); },
      },
      storageKey: accountContract.storageKey,
    },
    global: {
      fetch: async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const headers = new Headers(init?.headers);
        const authorization = headers.get("authorization");
        const recorded: Recorded = {
          body: typeof init?.body === "string" ? init.body : null,
          method: (init?.method ?? "GET").toUpperCase(),
          path: `${url.pathname}${url.search}`,
          token: authorization?.startsWith("Bearer ") ? authorization.slice(7) : null,
        };
        requests.push(recorded);
        return options.responder(recorded);
      },
    },
  });
  client.auth.onAuthStateChange((event) => { events.push(event); });
  return { accessToken, client, events, requests, store };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });

const sessionNotFound = () =>
  json(403, {
    code: 403,
    error_code: "session_not_found",
    msg: "Session from session_id claim in JWT does not exist",
  });

test("portal sign-out scopes map the account page to every session and recovery to one", () => {
  expect(PORTAL_SIGN_OUT_SCOPES).toEqual({ everywhere: "global", "this-session": "local" });
});

test("signing out of the account page revokes every session for the user, not only this one", async () => {
  const harness = createHarness({
    responder: (request) =>
      request.path.startsWith("/auth/v1/logout") ? new Response(null, { status: 204 }) : json(404, {}),
  });
  await harness.client.auth.getSession();
  await signOutOfPortal(harness.client.auth, "everywhere");

  const logouts = harness.requests.filter((request) => request.path.startsWith("/auth/v1/logout"));
  expect(logouts.map((request) => `${request.method} ${request.path}`)).toEqual([
    "POST /auth/v1/logout?scope=global",
  ]);
  expect(logouts[0]?.token).toBe(harness.accessToken);
  expect(harness.store.has(accountContract.storageKey)).toBe(false);
  expect(harness.events).toContain("SIGNED_OUT");
});

test("the recovery session alone ends with the narrow scope", async () => {
  const harness = createHarness({
    responder: (request) =>
      request.path.startsWith("/auth/v1/logout") ? new Response(null, { status: 204 }) : json(404, {}),
  });
  await signOutOfPortal(harness.client.auth, "this-session");
  expect(harness.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "POST /auth/v1/logout?scope=local",
  ]);
  expect(harness.store.has(accountContract.storageKey)).toBe(false);
});

test("a sign-out that the provider cannot complete fails loudly and keeps the session", async () => {
  const harness = createHarness({ responder: () => json(502, { msg: "bad gateway" }) });
  await expect(signOutOfPortal(harness.client.auth, "everywhere")).rejects.toBeTruthy();
  expect(harness.store.has(accountContract.storageKey)).toBe(true);
  expect(harness.events).not.toContain("SIGNED_OUT");
});

test("signing out a session that another app already revoked is a success, not an error", async () => {
  // Access token still valid locally, but Fitness signed out everywhere: the provider says the
  // session no longer exists. The person is signed out, so the page must not report a failure.
  const harness = createHarness({ responder: () => sessionNotFound() });
  await signOutOfPortal(harness.client.auth, "everywhere");
  expect(harness.store.has(accountContract.storageKey)).toBe(false);
  expect(harness.events).toContain("SIGNED_OUT");
});

const refreshTokenRevoked = (request: Recorded) =>
  request.path.startsWith("/auth/v1/token")
    ? json(400, {
        error: "invalid_grant",
        error_code: "refresh_token_not_found",
        error_description: "Invalid Refresh Token: Refresh Token Not Found",
      })
    : json(404, {});

/** A page that loaded a live session whose access token then expired while another app revoked it. */
async function harnessWithExpiredRevokedSession() {
  const harness = createHarness({ responder: refreshTokenRevoked });
  await harness.client.auth.initialize();
  const stored = JSON.parse(harness.store.get(accountContract.storageKey) ?? "{}");
  stored.expires_at = Math.floor(Date.now() / 1000) - 30;
  harness.store.set(accountContract.storageKey, JSON.stringify(stored));
  return harness;
}

test("the SDK reports an error when signing out an expired, revoked session (why the helper exists)", async () => {
  const harness = await harnessWithExpiredRevokedSession();
  const { error } = await harness.client.auth.signOut({ scope: "global" });
  expect(error).toBeTruthy();
  expect(harness.requests.some((request) => request.path.startsWith("/auth/v1/token"))).toBe(true);
  expect(harness.store.has(accountContract.storageKey)).toBe(false);
});

test("signing out an expired session whose refresh token was revoked is a success", async () => {
  const harness = await harnessWithExpiredRevokedSession();
  await signOutOfPortal(harness.client.auth, "everywhere");
  expect(harness.store.has(accountContract.storageKey)).toBe(false);
  expect(harness.events).toContain("SIGNED_OUT");
});

test("revalidation keeps a live session and shows the provider's fresh account details", async () => {
  const harness = createHarness({
    responder: (request) =>
      request.path === "/auth/v1/user" ? json(200, userRecord("renamed@example.test")) : json(404, {}),
  });
  const session = await validatePortalSession(harness.client.auth);
  expect(session).toEqual({ displayName: "fawxzzy", email: "renamed@example.test", userId: USER_ID });
  expect(harness.store.has(accountContract.storageKey)).toBe(true);
  // It checks the access token it already holds; it never spends the refresh token.
  expect(harness.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /auth/v1/user",
  ]);
});

test("revalidation finds a session another app revoked and clears the local copy", async () => {
  const harness = createHarness({ responder: () => sessionNotFound() });
  expect(await validatePortalSession(harness.client.auth)).toBeNull();
  expect(harness.store.has(accountContract.storageKey)).toBe(false);
  expect(harness.events).toContain("SIGNED_OUT");
  expect(harness.requests.some((request) => request.path.startsWith("/auth/v1/token"))).toBe(false);
});

test("revalidation clears a session the provider rejects as unauthorized", async () => {
  const harness = createHarness({
    responder: (request) =>
      request.path === "/auth/v1/user"
        ? json(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" })
        : new Response(null, { status: 204 }),
  });
  expect(await validatePortalSession(harness.client.auth)).toBeNull();
  expect(harness.store.has(accountContract.storageKey)).toBe(false);
});

test("revalidation never signs anyone out because the provider or the network is unavailable", async () => {
  for (const responder of [
    () => json(503, { msg: "unavailable" }),
    () => { throw new TypeError("fetch failed"); },
  ] as Responder[]) {
    const harness = createHarness({ responder });
    const session = await validatePortalSession(harness.client.auth);
    expect(session).toEqual({ displayName: "fawxzzy", email: "cached@example.test", userId: USER_ID });
    expect(harness.store.has(accountContract.storageKey)).toBe(true);
    expect(harness.events).not.toContain("SIGNED_OUT");
  }
});

test("revalidation with no stored session reports signed out without any request", async () => {
  const harness = createHarness({ responder: () => json(500, {}) });
  harness.store.delete(accountContract.storageKey);
  expect(await validatePortalSession(harness.client.auth)).toBeNull();
  expect(harness.requests).toEqual([]);
});
