import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPublicKeyAdmission,
  validatePublicClientKey,
} from "../../supabase/functions/username-password-signin/public-key.mjs";
import { resolveUsernameSignInRpc } from "../../supabase/functions/username-password-signin/rpc-response.mjs";
import {
  resolveSystemStateSemantics,
  systemStateVariants,
} from "../../src/components/system/system-state";
import {
  accountContract,
  accountConfirmUrl,
  accountExperienceContexts,
  accountRecoveryUrl,
  accountUrls,
  classifyRuntimeOrigin,
  isLiveAccountAdapterOrigin,
  resolveAccountAuthIntent,
  resolveAccountExperienceContext,
} from "../../src/config/account";
import {
  sanitizeContextReturnTarget,
  sanitizePostAuthReturnTarget,
  sanitizeReturnTarget,
} from "../../src/config/account-return";
import {
  callbackReceiptKey,
  callbackStateMatches,
  confirmationStateMatches,
  parseCallbackPayload,
  parseConfirmPayload,
  parseRecoveryPayload,
} from "../../src/lib/auth/callback-contract";
import {
  scheduleCooldownTicks,
  scheduleDeferredAttempt,
  type CooldownScheduler,
  type DeferredScheduler,
} from "../../src/lib/auth/client-lifecycle";
import { resolvePortalAuthAdapter } from "../../src/lib/auth/browser-adapter";
import { isUsernameTakenError } from "../../src/lib/auth/errors";
import { AUTH_COPY, authNotice, type AuthMessageId } from "../../src/lib/auth/copy-matrix";
import { signInFailure, signUpFailure } from "../../src/lib/auth/auth-outcomes";
import { validatePassword } from "../../src/lib/auth/password-policy";
import { isBrowserSafeSupabasePublicKey } from "../../src/lib/auth/supabase-public-key.mjs";
import {
  MAZER_OAUTH_PENDING_COOKIE,
  MAZER_OAUTH_DENIAL_DESCRIPTION,
  isValidMazerAuthorizationId,
  normalizeMazerOAuthProviderResult,
  parsePendingMazerOAuthAuthorization,
  sanitizeMazerOAuthApprovalRedirect,
  sanitizeMazerOAuthDenialRedirect,
} from "../../src/lib/auth/mazer-oauth";
import {
  DELETE as deletePendingMazerOAuth,
  GET as getPendingMazerOAuth,
  PATCH as patchPendingMazerOAuth,
  POST as postPendingMazerOAuth,
  PUT as putPendingMazerOAuth,
} from "../../api/account/mazer-oauth-pending";
import {
  humanAccountServices,
  normalizeServiceRegistrationReadModel,
  resolveServiceRegistrationPresentation,
  serviceRegistrationDispositions,
  sourceOnlyServiceRegistrationCapability,
} from "../../src/lib/account/service-registration";
import { apps } from "../../src/data/apps";
import { productIdentity } from "../../src/config/product";
import { legalCenter } from "../../src/config/legal";
import sitemap from "../../src/app/sitemap";

const accountRoutes = [
  ["/login", `Sign in | ${productIdentity.publicName}`],
  ["/account", `Account | ${productIdentity.publicName}`],
  ["/auth/confirm", `Confirm account | ${productIdentity.publicName}`],
  ["/auth/callback", `Account handoff | ${productIdentity.publicName}`],
  ["/reset-password", `Reset password | ${productIdentity.publicName}`],
] as const;

const legalRoutes = [
  ["/privacy", `Privacy Policy | ${productIdentity.publicName}`, "platform-privacy"],
  ["/terms", `Terms of Service | ${productIdentity.publicName}`, "platform-terms"],
  ["/legal/mazer/privacy", `Mazer Privacy Policy | ${productIdentity.publicName}`, "mazer-privacy"],
  ["/legal/mazer/terms", `Mazer Terms of Service | ${productIdentity.publicName}`, "mazer-terms"],
] as const;

const oauthState = "s".repeat(43);

test.beforeEach(async ({ context }) => {
  let pending: {
    authorizationId: string;
    authGeneration: string;
    expiresAt: number;
  } | null = null;
  await context.route("**/api/account/mazer-oauth-pending", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        authorizationId: string;
        authGeneration: string;
      };
      pending = { ...body, expiresAt: Date.now() + 15 * 60 * 1000 };
      await route.fulfill({ status: 204 });
      return;
    }
    if (request.method() === "DELETE") {
      pending = null;
      await route.fulfill({ status: 204 });
      return;
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as { authGeneration: string };
      if (!pending) {
        await route.fulfill({ status: 404 });
        return;
      }
      pending = { ...pending, authGeneration: body.authGeneration };
      await route.fulfill({ status: 204 });
      return;
    }
    if (!pending) {
      await route.fulfill({ status: 404 });
      return;
    }
    const token = request.headers().authorization ?? "";
    const authGeneration = request.headers()["x-fawxzzy-auth-generation"];
    if (!token.startsWith("Bearer local-") || authGeneration !== pending.authGeneration) {
      await route.fulfill({ status: 401 });
      return;
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as {
        action: "approve" | "deny";
        authGeneration: string;
      };
      if (body.authGeneration !== pending.authGeneration) {
        await route.fulfill({ status: 401 });
        return;
      }
      const redirectUrl = token.includes("oauth-hostile")
        ? "https://attacker.example.test/?code=stolen"
        : body.action === "approve"
          ? `${accountContract.productOrigins.mazer}/?code=local-code&state=${oauthState}`
          : `${accountContract.productOrigins.mazer}/?error=access_denied&error_description=${encodeURIComponent(MAZER_OAUTH_DENIAL_DESCRIPTION)}&state=${oauthState}`;
      pending = null;
      await route.fulfill({
        body: JSON.stringify({ redirectUrl }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (token.includes("oauth-auto")) {
      pending = null;
      await route.fulfill({
        body: JSON.stringify({
          kind: "redirect",
          redirectUrl: `${accountContract.productOrigins.mazer}/?code=local-auto-code&state=${oauthState}`,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        kind: "authorization",
        details: {
          clientId: "local-mazer-oauth-client",
          clientName: "Mazer",
          redirectUri: `${accountContract.productOrigins.mazer}/`,
          scope: "email",
          userId: "preview-user",
        },
      }),
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      status: 200,
    });
  });
});

test("auth surfaces derive public branding from product identity", () => {
  const sources = [
    "../../src/app/login/page.tsx",
    "../../src/app/account/page.tsx",
    "../../src/app/auth/callback/page.tsx",
    "../../src/app/auth/confirm/page.tsx",
  ];

  for (const sourcePath of sources) {
    const source = readFileSync(path.resolve(process.cwd(), "tests/e2e", sourcePath), "utf8");
    expect(source).toContain("productIdentity.publicName");
    expect(source).not.toMatch(/["'`]Fawxzzy(?: account| apps)?[."'`<]/);
  }
  // Auth Surface v2: the portal screens take their product name from the presentation registry
  // and their words from the copy matrix, so they never hard-code the brand either.
  for (const sourcePath of [
    "src/components/account/account-portal.tsx",
    "src/components/account/auth-surface.tsx",
    "src/components/account/auth-status.tsx",
  ]) {
    expect(readFileSync(path.resolve(process.cwd(), sourcePath), "utf8")).not.toMatch(/["'`]Fawxzzy(?: account| apps)?[."'`<]/);
  }
});

test("auth-family documentation locks Fitness structure and product-owned theming", () => {
  const contract = readFileSync(
    path.resolve(process.cwd(), "docs/auth-surface-family.md"),
    "utf8",
  );

  expect(contract).toContain("Fitness is the canonical structural reference");
  expect(contract).toContain("Product theme may change; screen structure may not");
  expect(contract).toContain("Username is the public display name");
  expect(contract).toContain("gameplay, simulation, announcements, and ambient motion are halted");
  expect(contract).not.toContain("Desktop: split identity and credentials layout");
  expect(contract).not.toContain("one short supporting sentence");
});

test("one presentation registry renders every product with exact consumer adoption", () => {
  expect(resolveAccountExperienceContext("website")).toEqual(accountExperienceContexts.website);
  expect(resolveAccountExperienceContext("fitness")).toEqual(accountExperienceContexts.fitness);
  expect(resolveAccountExperienceContext("mazer")).toEqual(accountExperienceContexts.mazer);
  expect(resolveAccountExperienceContext("unknown")).toEqual(accountExperienceContexts.website);
  expect(accountExperienceContexts.website.consumerIntegration).toBe("active");
  expect(accountExperienceContexts.fitness.consumerIntegration).toBe("active");
  expect(accountExperienceContexts.mazer.consumerIntegration).toBe("pending");
  expect(accountExperienceContexts.fitness.legalLinks).toEqual([
    { href: "https://fitness.fawxzzy.com/privacy", label: "Privacy" },
    { href: "https://fitness.fawxzzy.com/terms", label: "Terms" },
  ]);
  expect(accountExperienceContexts.website.legalLinks).toEqual([
    { href: "https://fawxzzy.com/privacy", label: "Privacy" },
    { href: "https://fawxzzy.com/terms", label: "Terms" },
  ]);
  expect(accountExperienceContexts.mazer.legalLinks).toEqual([
    { href: "https://fawxzzy.com/legal/mazer/privacy", label: "Privacy" },
    { href: "https://fawxzzy.com/legal/mazer/terms", label: "Terms" },
  ]);
  expect(accountRecoveryUrl("website")).toBe(accountUrls.recovery);
  expect(accountRecoveryUrl("fitness")).toBe(
    "https://account.fawxzzy.com/reset-password?recovery=1&app=fitness",
  );
  expect(accountRecoveryUrl("mazer")).toBe(
    "https://account.fawxzzy.com/reset-password?recovery=1&app=mazer",
  );
  expect(accountConfirmUrl("website")).toBe(accountUrls.confirm);
  expect(accountConfirmUrl("fitness")).toBe(
    "https://account.fawxzzy.com/auth/confirm?app=fitness&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
  );
  expect(accountConfirmUrl("mazer")).toBe(
    "https://account.fawxzzy.com/auth/confirm?app=mazer&returnTo=https%3A%2F%2Fmazer.fawxzzy.com%2F",
  );
  expect(accountRecoveryUrl("mazer", "/oauth/authorize")).toBe(
    "https://account.fawxzzy.com/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize",
  );
  expect(accountConfirmUrl("mazer", undefined, "/oauth/authorize")).toBe(
    "https://account.fawxzzy.com/auth/confirm?app=mazer&returnTo=%2Foauth%2Fauthorize",
  );
});

test("Mazer OAuth accepts only one bounded expiring authorization carrier", () => {
  const authorizationId = "authorization-id-1234567890";
  const authGeneration = "a".repeat(64);
  expect(parsePendingMazerOAuthAuthorization({
    authorizationId,
    authGeneration,
    expiresAt: 901_000,
  }, 1_001)).toEqual({
    authorizationId,
    authGeneration,
    expiresAt: 901_000,
  });
  expect(parsePendingMazerOAuthAuthorization({
    authorizationId,
    authGeneration,
    expiresAt: 901_000,
  }, 901_000)).toBeNull();
  expect(parsePendingMazerOAuthAuthorization({
    authorizationId: "short",
    authGeneration,
    expiresAt: 2_000,
  }, 1_000)).toBeNull();
  expect(isValidMazerAuthorizationId("short")).toBe(false);
  expect(isValidMazerAuthorizationId(authorizationId)).toBe(true);
});

test("Mazer OAuth normalizes provider details and validates decision-specific redirects", () => {
  const authorizationId = "authorization-id-1234567890";
  expect(normalizeMazerOAuthProviderResult({
    authorization_id: authorizationId,
    client: { id: "local-mazer-oauth-client", name: "Mazer" },
    redirect_uri: "https://mazer.fawxzzy.com/",
    scope: "email",
    user: { id: "preview-user" },
  }, authorizationId)).toMatchObject({
    kind: "authorization",
    details: { userId: "preview-user" },
  });
  expect(JSON.stringify(normalizeMazerOAuthProviderResult({
    authorization_id: authorizationId,
    client: { id: "local-mazer-oauth-client", name: "Mazer" },
    redirect_uri: "https://mazer.fawxzzy.com/",
    scope: "email",
    user: { id: "preview-user" },
  }, authorizationId))).not.toContain(authorizationId);
  expect(sanitizeMazerOAuthApprovalRedirect(
    `https://mazer.fawxzzy.com/?code=one-time&state=${oauthState}`,
  )).toBe(`https://mazer.fawxzzy.com/?code=one-time&state=${oauthState}`);
  expect(sanitizeMazerOAuthDenialRedirect(
    `https://mazer.fawxzzy.com/?error=access_denied&error_description=${encodeURIComponent(MAZER_OAUTH_DENIAL_DESCRIPTION)}&state=${oauthState}`,
  )).toBe(
    `https://mazer.fawxzzy.com/?error=access_denied&error_description=${encodeURIComponent(MAZER_OAUTH_DENIAL_DESCRIPTION)}&state=${oauthState}`,
  );
  for (const hostile of [
    "https://attacker.example.test/?code=one-time",
    "https://mazer.fawxzzy.com/path?code=one-time",
    "https://mazer.fawxzzy.com/?access_token=secret",
    "https://mazer.fawxzzy.com/?code=one&error=two",
    `https://mazer.fawxzzy.com/?code=one-time&state=${oauthState}&error_description=nope`,
    "https://mazer.fawxzzy.com/?code=one-time&state=short",
  ]) {
    expect(sanitizeMazerOAuthApprovalRedirect(hostile)).toBeNull();
    expect(sanitizeMazerOAuthDenialRedirect(hostile)).toBeNull();
  }
});

test("Mazer pending carrier is Secure, HttpOnly, host-only, bounded, and single-valued", async () => {
  const authorizationId = "authorization-id-1234567890";
  const authGeneration = "a".repeat(64);
  const stored = await postPendingMazerOAuth(new Request(
    "https://account.fawxzzy.com/api/account/mazer-oauth-pending",
    {
      body: JSON.stringify({ authorizationId, authGeneration }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://account.fawxzzy.com",
      },
      method: "POST",
    },
  ));
  expect(stored.status).toBe(204);
  const setCookie = stored.headers.get("set-cookie");
  expect(setCookie).toContain(`${MAZER_OAUTH_PENDING_COOKIE}=`);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Lax");
  expect(setCookie).toContain("Path=/");
  expect(setCookie).toContain("Max-Age=900");
  expect(setCookie).not.toContain("Domain=");

  const cookiePair = setCookie?.split(";", 1)[0] ?? "";
  const accessToken = `${"a".repeat(32)}.${"b".repeat(32)}.${"c".repeat(32)}`;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  const upstreamCalls: Array<{ body: string | null; method: string; url: string }> = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bxtcuhkotumitoqtrcej.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_local_test_key";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    upstreamCalls.push({ body: typeof init?.body === "string" ? init.body : null, method, url });
    if (method === "GET") {
      return Response.json({
        authorization_id: authorizationId,
        client: { id: "local-mazer-oauth-client", name: "Mazer" },
        redirect_uri: "https://mazer.fawxzzy.com/",
        scope: "email",
        user: { id: "preview-user" },
      });
    }
    const action = JSON.parse(String(init?.body)) as { action: "approve" | "deny" };
    return Response.json({
      redirect_url: action.action === "approve"
        ? `https://mazer.fawxzzy.com/?code=one-time&state=${oauthState}`
        : `https://mazer.fawxzzy.com/?error=access_denied&error_description=${encodeURIComponent(MAZER_OAUTH_DENIAL_DESCRIPTION)}&state=${oauthState}`,
    });
  };
  try {
    const rebound = await patchPendingMazerOAuth(new Request(
      "https://account.fawxzzy.com/api/account/mazer-oauth-pending",
      {
        body: JSON.stringify({ authGeneration }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookiePair,
          Origin: "https://account.fawxzzy.com",
        },
        method: "PATCH",
      },
    ));
    expect(rebound.status).toBe(204);

    const read = await getPendingMazerOAuth(new Request(
      "https://account.fawxzzy.com/api/account/mazer-oauth-pending",
      { headers: {
        Authorization: `Bearer ${accessToken}`,
        Cookie: cookiePair,
        "X-Fawxzzy-Auth-Generation": authGeneration,
      } },
    ));
    expect(read.status).toBe(200);
    const browserPayload = await read.json();
    expect(browserPayload).toMatchObject({
      kind: "authorization",
      details: { clientName: "Mazer", userId: "preview-user" },
    });
    expect(JSON.stringify(browserPayload)).not.toContain(authorizationId);
    expect(upstreamCalls[0]).toMatchObject({
      method: "GET",
      url: `https://bxtcuhkotumitoqtrcej.supabase.co/auth/v1/oauth/authorizations/${authorizationId}`,
    });

    const approved = await putPendingMazerOAuth(new Request(
      "https://account.fawxzzy.com/api/account/mazer-oauth-pending",
      {
        body: JSON.stringify({ action: "approve", authGeneration }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Cookie: cookiePair,
          Origin: "https://account.fawxzzy.com",
          "X-Fawxzzy-Auth-Generation": authGeneration,
        },
        method: "PUT",
      },
    ));
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toEqual({
      redirectUrl: `https://mazer.fawxzzy.com/?code=one-time&state=${oauthState}`,
    });
    expect(approved.headers.get("set-cookie")).toContain("Max-Age=0");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }

  const duplicate = await getPendingMazerOAuth(new Request(
    "https://account.fawxzzy.com/api/account/mazer-oauth-pending",
    { headers: { Cookie: `${cookiePair}; ${cookiePair}` } },
  ));
  expect(duplicate.status).toBe(400);
  expect(duplicate.headers.get("set-cookie")).toContain("Max-Age=0");

  const cleared = deletePendingMazerOAuth(new Request(
    "https://account.fawxzzy.com/api/account/mazer-oauth-pending",
    {
      headers: { Origin: "https://account.fawxzzy.com" },
      method: "DELETE",
    },
  ));
  expect(cleared.status).toBe(204);
  expect(cleared.headers.get("set-cookie")).toContain("Max-Age=0");

  const crossOrigin = await postPendingMazerOAuth(new Request(
    "https://account.fawxzzy.com/api/account/mazer-oauth-pending",
    {
      body: JSON.stringify({ authorizationId, authGeneration }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://mazer.fawxzzy.com",
      },
      method: "POST",
    },
  ));
  expect(crossOrigin.status).toBe(403);
  expect(crossOrigin.headers.get("set-cookie")).toBeNull();

  const expiredValue = Buffer.from(JSON.stringify({
    authorizationId,
    authGeneration,
    expiresAt: Date.now() - 1,
  }), "utf8").toString("base64url");
  const expired = await getPendingMazerOAuth(new Request(
    "https://account.fawxzzy.com/api/account/mazer-oauth-pending",
    { headers: { Cookie: `${MAZER_OAUTH_PENDING_COOKIE}=${expiredValue}` } },
  ));
  expect(expired.status).toBe(404);
  expect(expired.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("Vercel packages the Mazer pending function as an ES module", () => {
  const packageManifest = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
    type?: string;
  };
  const functionSource = readFileSync(
    path.resolve("api/account/mazer-oauth-pending.ts"),
    "utf8",
  );
  expect(packageManifest.type).toBe("module");
  expect(functionSource).toContain('from "node:buffer"');
  expect(functionSource).toContain('from "../../src/lib/auth/mazer-oauth.js"');
  expect(functionSource).not.toContain('from "../../src/lib/auth/mazer-oauth";');
});

test("Mazer OAuth is the only internal product return target", () => {
  const mazer = accountExperienceContexts.mazer;
  const fitness = accountExperienceContexts.fitness;
  expect(sanitizePostAuthReturnTarget("/oauth/authorize", mazer)).toBe("/oauth/authorize");
  expect(sanitizePostAuthReturnTarget("/oauth/authorize", fitness)).toBe(
    "https://fitness.fawxzzy.com/",
  );
  expect(sanitizePostAuthReturnTarget("/oauth/authorize?authorization_id=private", mazer)).toBe(
    "https://mazer.fawxzzy.com/",
  );
});

test("Projects return stays on the account origin only for website sign-in", () => {
  const website = accountExperienceContexts.website;
  const fitness = accountExperienceContexts.fitness;
  expect(sanitizeReturnTarget("/projects")).toBe("/projects");
  expect(sanitizeReturnTarget("/projects?token=secret")).toBe("/account");
  expect(sanitizePostAuthReturnTarget("/projects", website)).toBe("/projects");
  expect(sanitizePostAuthReturnTarget("/projects", fitness)).toBe("https://fitness.fawxzzy.com/");
});

const utilityRoutes = accountRoutes;

const syntheticPublishableKey = `sb_publishable_${"a-b_".repeat(5)}ab_${"c-d_".repeat(2)}`;

function encodeSyntheticJwtPart(value: object) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function syntheticLegacyKey(role: "anon" | "service_role") {
  return [
    encodeSyntheticJwtPart({ alg: "HS256", typ: "JWT" }),
    encodeSyntheticJwtPart({ exp: 4_102_444_800, iss: "supabase", role }),
    Buffer.from("synthetic-signature", "utf8").toString("base64url"),
  ].join(".");
}

test("shared system-state variants have deterministic status semantics", () => {
  const assertive = new Set([
    "unauthorized",
    "invalid",
    "expired",
    "recoverable-error",
    "terminal-error",
  ]);

  expect(systemStateVariants).toEqual([
    "loading",
    "pending",
    "success",
    "empty",
    "unavailable",
    "unauthorized",
    "invalid",
    "expired",
    "recoverable-error",
    "terminal-error",
  ]);

  for (const variant of systemStateVariants) {
    expect(resolveSystemStateSemantics(variant)).toEqual({
      busy: variant === "loading" || variant === "pending",
      live: assertive.has(variant) ? "assertive" : "polite",
      role: assertive.has(variant) ? "alert" : "status",
    });
  }
});

test("account origins and exact redirects are centralized", () => {
  expect(accountContract.canonicalOrigin).toBe("https://account.fawxzzy.com");
  expect(accountUrls.confirm).toBe("https://account.fawxzzy.com/auth/confirm");
  expect(accountUrls.callback).toBe("https://account.fawxzzy.com/auth/callback");
  expect(accountUrls.recovery).toBe(
    "https://account.fawxzzy.com/reset-password?recovery=1",
  );
  expect(accountContract.productOrigins).toEqual({
    fitness: "https://fitness.fawxzzy.com",
    mazer: "https://mazer.fawxzzy.com",
  });
  expect(classifyRuntimeOrigin("http://127.0.0.1:3210")).toBe("local-test");
  expect(classifyRuntimeOrigin("https://fawxzzyweb-example.vercel.app")).toBe("preview");
  expect(classifyRuntimeOrigin("https://account.fawxzzy.com.evil.test")).toBe("foreign");
});

test("shared human services inherit centralized current and canonical origins", () => {
  const currentOrigin = (slug: "fitness" | "mazer") =>
    apps.find((app) => app.slug === slug)?.origin.current;
  expect(humanAccountServices.map((service) => service.id)).toEqual(["fitness", "mazer"]);
  expect(humanAccountServices).toEqual([
    expect.objectContaining({
      canonicalDestination: accountContract.productOrigins.fitness,
      currentDestination: currentOrigin("fitness"),
      id: "fitness",
    }),
    expect.objectContaining({
      canonicalDestination: accountContract.productOrigins.mazer,
      currentDestination: currentOrigin("mazer"),
      id: "mazer",
    }),
  ]);
});

test("service registration normalization preserves every explicit disposition", () => {
  for (const disposition of serviceRegistrationDispositions) {
    const input =
      disposition === "unavailable"
        ? { status: "unavailable" }
        : disposition === "unknown"
          ? { status: "available", version: 0 }
          : {
              services: humanAccountServices.map((service) => ({
                disposition,
                serviceId: service.id,
              })),
              status: "available",
              version: 1,
            };
    const snapshot = normalizeServiceRegistrationReadModel(input);
    expect(snapshot.services.map((service) => service.disposition), disposition).toEqual([
      disposition,
      disposition,
    ]);
  }
});

test("absent, partial, duplicate, and malformed service readback fails closed as a whole", () => {
  const absent = normalizeServiceRegistrationReadModel(null);
  expect(absent.capability).toBe("unavailable");
  expect(absent.services.every((service) => service.disposition === "unavailable")).toBe(true);

  const partial = normalizeServiceRegistrationReadModel({
    services: [{ disposition: "active", serviceId: "fitness" }],
    status: "available",
    version: 1,
  });
  expect(partial.capability).toBe("unknown");
  expect(partial.services.every((service) => service.disposition === "unknown")).toBe(true);

  for (const malformed of [
    { services: "active", status: "available", version: 1 },
    {
      services: [
        { disposition: "active", serviceId: "fitness" },
        { disposition: "not_registered", serviceId: "fitness" },
      ],
      status: "available",
      version: 1,
    },
    {
      services: [
        { disposition: "active", serviceId: "fitness" },
        { disposition: "active", serviceId: "mazer" },
        { disposition: "active", serviceId: "unsupported" },
      ],
      status: "available",
      version: 1,
    },
    {
      services: [
        { disposition: "active", serviceId: "fitness" },
        { disposition: "active", serviceId: "mazer" },
        null,
      ],
      status: "available",
      version: 1,
    },
  ]) {
    const snapshot = normalizeServiceRegistrationReadModel(malformed);
    expect(snapshot.capability, JSON.stringify(malformed)).toBe("unknown");
    expect(
      snapshot.services.every((service) => service.disposition === "unknown"),
      JSON.stringify(malformed),
    ).toBe(true);
  }
});

test("source-only service capability and foreign origins remain fail closed", () => {
  expect(sourceOnlyServiceRegistrationCapability).toEqual({
    adapter: null,
    availability: "unavailable",
  });
  for (const origin of [
    "https://account.fawxzzy.com",
    "https://fawxzzy.com",
    "https://fawxzzyweb-example.vercel.app",
  ]) {
    const snapshot = resolveServiceRegistrationPresentation({
      origin,
      search: "?services_test=active",
    });
    expect(snapshot.capability, origin).toBe("unavailable");
    expect(snapshot.services.every((service) => service.disposition === "unavailable")).toBe(
      true,
    );
  }
});

test("live account adapters resolve only on the canonical account or bounded local origins", () => {
  for (const allowed of [
    "https://account.fawxzzy.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3210",
    "http://127.0.0.1:3210",
  ]) {
    expect(isLiveAccountAdapterOrigin(allowed), allowed).toBe(true);
  }

  for (const denied of [
    "https://fawxzzy.com",
    "https://www.fawxzzy.com",
    "https://fawxzzyweb-example.vercel.app",
    "https://account.fawxzzy.com.evil.test",
    "http://localhost:4000",
    "http://127.0.0.1:4000",
  ]) {
    expect(isLiveAccountAdapterOrigin(denied), denied).toBe(false);
    let configReads = 0;
    let adapterCreations = 0;
    const resolution = resolvePortalAuthAdapter(
      { origin: denied, search: "" },
      {
        createLiveAdapter() {
          adapterCreations += 1;
          throw new Error("Denied origins must not create an adapter.");
        },
        readPublicConfig() {
          configReads += 1;
          return {
            publishableKey: "sb_publishable_test",
            url: "https://example.supabase.co",
          };
        },
      },
    );
    expect(resolution.status, denied).toBe("setup-pending");
    expect(configReads, denied).toBe(0);
    expect(adapterCreations, denied).toBe(0);
  }
});

test("public Supabase key admission fails closed before live adapter creation", () => {
  const legacyAnonymous = syntheticLegacyKey("anon");
  const rejected = [
    `sb_secret_${"c".repeat(22)}_${"d".repeat(8)}`,
    syntheticLegacyKey("service_role"),
    " ",
    "unsupported-public-value",
    "not.a.jwt",
  ];

  expect(isBrowserSafeSupabasePublicKey(syntheticPublishableKey)).toBe(true);
  expect(isBrowserSafeSupabasePublicKey(legacyAnonymous)).toBe(true);

  for (const publishableKey of rejected) {
    let adapterCreations = 0;
    const resolution = resolvePortalAuthAdapter(
      { origin: "http://127.0.0.1:3210", search: "" },
      {
        createLiveAdapter() {
          adapterCreations += 1;
          throw new Error("Rejected public configuration must not create a client.");
        },
        readPublicConfig() {
          return { publishableKey, url: "https://synthetic-project.supabase.co" };
        },
      },
    );

    expect(isBrowserSafeSupabasePublicKey(publishableKey)).toBe(false);
    expect(resolution.status).toBe("setup-pending");
    expect(adapterCreations).toBe(0);
    if (resolution.status === "setup-pending") {
      expect(resolution.reason).toBe(
        "Shared account services are not connected on this deployment yet.",
      );
    }
  }
});

test("return targets fail closed unless they exactly match the contract", () => {
  for (const allowed of [
    "/account",
    "/projects",
    "/reset-password?recovery=1",
    "https://fawxzzy.com/",
    "https://fitness.fawxzzy.com/",
    "https://mazer.fawxzzy.com/",
    "https://fawxzzy-fitness-local.vercel.app/",
    "https://fawxzzy-mazer.vercel.app/",
    "https://fitness.fawxzzy.com/session/abc?returnTo=%2Ftoday",
  ]) {
    expect(sanitizeReturnTarget(allowed)).toBe(allowed);
  }

  for (const rejected of [
    "//evil.test/account",
    "/account?access_token=secret",
    "/reset-password?recovery=1&code=secret",
    "/login",
    "/projects?private=1",
    "https://user@example.com/",
    "https://fitness.fawxzzy.com.evil.test/",
    "https://fitness.fawxzzy.com/?code=secret",
    "https://fitness.fawxzzy.com/#access_token=secret",
    "https://fitness.fawxzzy.com/session?id_token=secret",
    "https://fitness.fawxzzy.com/session?session=secret",
    "https://fitness.fawxzzy.com/session?jwt=secret",
    "https://fitness.fawxzzy.com/session?api_key=secret",
    "https://fitness.fawxzzy.com/session?ID_TOKEN=secret",
    "https://fitness.fawxzzy.com/session?%69d_token=secret",
    "https://fitness.fawxzzy.com/session?returnTo=%2Ftoday%3Fjwt%3Dsecret",
    "http://fitness.fawxzzy.com/",
    "https://evil.test/",
  ]) {
    expect(sanitizeReturnTarget(rejected), rejected).toBe("/account");
  }
});

test("context return targets stay on the selected product origin", () => {
  const fitness = resolveAccountExperienceContext("fitness");
  expect(
    sanitizeContextReturnTarget(
      "https://fitness.fawxzzy.com/session/abc?returnTo=%2Ftoday",
      fitness,
    ),
  ).toBe("https://fitness.fawxzzy.com/session/abc?returnTo=%2Ftoday");
  expect(sanitizeContextReturnTarget("https://mazer.fawxzzy.com/", fitness)).toBe(
    "https://fitness.fawxzzy.com/",
  );
  expect(sanitizeContextReturnTarget("https://fitness.fawxzzy.com/?code=secret", fitness)).toBe(
    "https://fitness.fawxzzy.com/",
  );
});

test("password policy distinguishes login from account-changing actions without truncation", () => {
  expect(validatePassword("short", "login")).toEqual({ valid: true });
  expect(validatePassword("short", "signup").valid).toBe(false);
  expect(validatePassword("1234567890", "signup")).toEqual({ valid: true });
  expect(validatePassword("x".repeat(129), "reset")).toEqual({ valid: true });
  expect(validatePassword("x".repeat(512), "change")).toEqual({ valid: true });
});

test("safe messages are deterministic and non-enumerating", () => {
  const text = (id: AuthMessageId) => authNotice(id).text;
  // A wrong password never says whether the email or username exists.
  expect(text("signin.wrong")).toBe("Wrong email, username or password. Try again.");
  expect(text("signin.wrong")).not.toMatch(/exists|registered|no account/i);
  expect(signInFailure({ status: 400, code: "invalid_credentials" })).toBe("signin.wrong");
  expect(text("signin.throttled")).not.toBe(text("signin.wrong"));
  // A failed sign-up never reads as completion.
  expect(signUpFailure({ status: 500, code: "unexpected_failure" })).toBe("page.crash");
  expect(text("page.crash")).not.toMatch(/complete|created|registered|exists|already/i);
  // Signed out, the reset answer is one line for every address.
  expect(text("reset.sentany")).toBe("If that account exists, we sent a reset link to its email.");
  expect(text("reset.sentany")).not.toContain("@");
});

test("Strict Mode probe cleanup reschedules each auth-link operation exactly once", () => {
  for (const operation of ["confirm", "callback"] as const) {
    const pending = new Map<number, () => void>();
    let nextHandle = 0;
    const scheduler: DeferredScheduler = {
      clear(handle) {
        pending.delete(handle as number);
      },
      schedule(callback) {
        const handle = ++nextHandle;
        pending.set(handle, callback);
        return handle;
      },
    };
    const state = { started: false };
    let providerOperations = 0;

    const cleanupProbe = scheduleDeferredAttempt(
      state,
      () => {
        providerOperations += 1;
      },
      scheduler,
    );
    cleanupProbe();
    expect(state.started, `${operation} probe must remain retryable`).toBe(false);
    expect(pending.size, `${operation} probe timer must be canceled`).toBe(0);

    const cleanupEffectiveAttempt = scheduleDeferredAttempt(
      state,
      () => {
        providerOperations += 1;
      },
      scheduler,
    );
    for (const callback of [...pending.values()]) callback();
    pending.clear();
    expect(state.started, `${operation} effective attempt must launch`).toBe(true);
    expect(providerOperations, `${operation} provider operation count`).toBe(1);

    scheduleDeferredAttempt(
      state,
      () => {
        providerOperations += 1;
      },
      scheduler,
    );
    for (const callback of [...pending.values()]) callback();
    cleanupEffectiveAttempt();
    expect(providerOperations, `${operation} must not duplicate after launch`).toBe(1);
    expect(pending.size, `${operation} cleanup must leave no timer`).toBe(0);
  }
});

test("deferred auth-link cleanup prevents an unmounted attempt from launching", () => {
  const pending = new Map<number, () => void>();
  const scheduler: DeferredScheduler = {
    clear(handle) {
      pending.delete(handle as number);
    },
    schedule(callback) {
      pending.set(1, callback);
      return 1;
    },
  };
  const state = { started: false };
  let providerOperations = 0;
  const cleanup = scheduleDeferredAttempt(
    state,
    () => {
      providerOperations += 1;
    },
    scheduler,
  );

  cleanup();
  for (const callback of pending.values()) callback();
  expect(providerOperations).toBe(0);
  expect(state.started).toBe(false);
  expect(pending.size).toBe(0);
});

test("cooldown ticks terminate at expiry and unmount cleanup cancels pending work", () => {
  let clock = 1_000;
  let nextHandle = 0;
  let clears = 0;
  const pending = new Map<number, () => void>();
  const scheduler: CooldownScheduler = {
    clear(handle) {
      clears += 1;
      pending.delete(handle as number);
    },
    now() {
      return clock;
    },
    schedule(callback) {
      const handle = ++nextHandle;
      pending.set(handle, callback);
      return handle;
    },
  };
  const ticks: Array<{ clock: number; expired: boolean }> = [];
  const cleanup = scheduleCooldownTicks(
    2_000,
    (nextClock, expired) => ticks.push({ clock: nextClock, expired }),
    scheduler,
  );

  clock = 1_250;
  for (const callback of [...pending.values()]) callback();
  clock = 2_000;
  for (const callback of [...pending.values()]) callback();
  expect(ticks).toEqual([
    { clock: 1_250, expired: false },
    { clock: 2_000, expired: true },
  ]);
  expect(pending.size).toBe(0);
  expect(clears).toBe(1);

  clock = 3_000;
  for (const callback of [...pending.values()]) callback();
  cleanup();
  expect(ticks).toHaveLength(2);
  expect(clears).toBe(1);

  const unmountCleanup = scheduleCooldownTicks(4_000, () => {
    throw new Error("An unmounted cooldown must not tick.");
  }, scheduler);
  expect(pending.size).toBe(1);
  unmountCleanup();
  expect(pending.size).toBe(0);
  expect(clears).toBe(2);
});

test("confirm and callback parsers accept only the expected one-time material", () => {
  expect(accountConfirmUrl("fitness", "browser-state")).toBe(
    "https://account.fawxzzy.com/auth/confirm?app=fitness&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F&state=browser-state",
  );
  const confirm = parseConfirmPayload(
    new URL(
      "https://account.fawxzzy.com/auth/confirm?token_hash=hash&type=signup&state=browser-state&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
    ),
  );
  expect(confirm).toEqual({
    returnTo: "https://fitness.fawxzzy.com/",
    state: "browser-state",
    tokenHash: "hash",
    type: "signup",
  });
  expect(parseConfirmPayload(new URL("https://account.fawxzzy.com/auth/confirm?type=bad"))).toBeNull();

  const callback = parseCallbackPayload(
    new URL("https://account.fawxzzy.com/auth/callback?code=code&state=state"),
  );
  expect(callback).toEqual({ code: "code", returnTo: "/account", state: "state" });
  expect(
    parseCallbackPayload(
      new URL("https://account.fawxzzy.com/auth/callback?code=code&state=state#access_token=secret"),
    ),
  ).toBeNull();
  expect(callbackStateMatches("same", "same")).toBe(true);
  expect(callbackStateMatches("same", "other")).toBe(false);
  expect(confirmationStateMatches("same", "same")).toBe(true);
  expect(confirmationStateMatches("same", null)).toBe(false);
  expect(callbackReceiptKey("stable-code")).toBe(callbackReceiptKey("stable-code"));

  expect(
    parseRecoveryPayload(
      new URL("https://account.fawxzzy.com/reset-password?recovery=1&code=one-time"),
    ),
  ).toEqual({ code: "one-time" });
  expect(
    parseRecoveryPayload(
      new URL("https://account.fawxzzy.com/reset-password?recovery=1"),
    ),
  ).toEqual({ code: null });
  expect(
    parseRecoveryPayload(
      new URL(
        "https://account.fawxzzy.com/reset-password?recovery=1&code=one-time#access_token=secret",
      ),
    ),
  ).toBeNull();
});

const LINK_ROUTES = new Set<string>(["/auth/confirm", "/auth/callback"]);
const dockButton = (page: Page) => page.locator(".auth-dock__button");
const noticeOf = (page: Page, id: AuthMessageId) => page.locator(`[data-notice-id="${id}"]`);
const fieldFrame = (page: Page, inputId: string) =>
  page.locator(".auth-field").filter({ has: page.locator(`#${inputId}`) });
const postAuthDestination = (page: Page) =>
  page.locator("html").getAttribute("data-post-auth-destination");

/** Callback and confirm never stay on screen: without link material they replace themselves with sign in. */
async function gotoSettled(page: Page, route: string) {
  await page.goto(route);
  if (LINK_ROUTES.has(route.split("?")[0])) await page.waitForURL(/\/login(\?|$)/);
}

test("all account routes carry account canonical metadata and setup-pending state", async ({ page }) => {
  for (const [route, title] of accountRoutes) {
    if (LINK_ROUTES.has(route)) {
      // The link pages move on at once, so their metadata is read from the served document.
      const html = await (await page.request.get(route)).text();
      expect(html).toContain(`<title>${title}</title>`);
      expect(html).toContain(`href="${accountContract.canonicalOrigin}${route}"`);
      expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
      await gotoSettled(page, route);
      // No link material and no service: sign in, with the service reason in the notice slot.
      await expect(page).toHaveURL(/\/login$/);
      await expect(noticeOf(page, "signin.unavailable")).toBeVisible();
      continue;
    }
    await page.goto(route);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${accountContract.canonicalOrigin}${route}`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('[data-system-state="unavailable"]')).toHaveCount(0);
    await expect(noticeOf(page, "signin.unavailable")).toContainText(authNotice("signin.unavailable").text);
    await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
    await expect(page.getByRole("navigation", { name: "Account" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  }
});

test("utility Auth routes use one focused task shell", async ({ page }) => {
  for (const [route] of utilityRoutes) {
    await gotoSettled(page, route);
    await expect(page.getByRole("navigation", { name: "Account" })).toHaveCount(0);
    await expect(page.locator(".account-utility-layout > .auth-surface")).toHaveCount(1);
    await expect(page.locator(".account-hero--utility")).toHaveCount(0);
    await expect(page.locator('main[data-auth-family="fawxzzy"]')).toHaveAttribute(
      "data-auth-product",
      "website",
    );
    await expect(page.locator('main[data-auth-layout="focused-split"]')).toBeVisible();
  }
});

test("login follows the shared Fawxzzy auth anatomy without overstating availability", async ({
  page,
}) => {
  await page.goto("/login");
  const surface = page.locator('[data-auth-surface="credentials"]');
  await expect(surface).toBeVisible();
  await expect(surface.locator(".auth-app-icon")).toBeVisible();
  await expect(surface.locator(".auth-kicker")).toHaveText("Fawxzzy");
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByLabel("Email or username")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show password" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("preview-me");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toBeVisible();
  await expect(dockButton(page)).toHaveText("Sign in");
  await expect(dockButton(page)).toBeDisabled();
  await expect(noticeOf(page, "signin.unavailable")).toBeVisible();
});

test("utility forms preserve password-manager and autofill semantics", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  const loginForm = page.locator("form");
  await expect(loginForm.getByLabel("Email or username")).toHaveAttribute("autocomplete", "username");
  await expect(loginForm.getByLabel("Password", { exact: true })).toHaveAttribute(
    "autocomplete",
    "current-password",
  );

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(loginForm.getByLabel("Username")).toHaveAttribute("autocomplete", "username");
  await expect(loginForm.getByLabel("Password", { exact: true })).toHaveAttribute(
    "autocomplete",
    "new-password",
  );

  await page.goto("/reset-password?auth_test=success");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
});

test("utility shell stays usable without overflow at 320px and 360px", async ({ page }) => {
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [route] of utilityRoutes) {
      await gotoSettled(page, route);
      const geometry = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.scrollWidth, `${route} at ${width}px`).toBeLessThanOrEqual(
        geometry.clientWidth,
      );
    }
  }
});

test("public navigation exposes the shared account host without duplicating auth", async ({
  page,
}) => {
  await page.goto("/apps");
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation.getByRole("link", { name: "Home", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Apps", exact: true })).toHaveAttribute(
    "href",
    "/apps",
  );
  // Projects is the owner's private tab: a signed-out visitor never sees it.
  await expect(navigation.getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Account", exact: true })).toHaveAttribute(
    "href",
    accountUrls.account,
  );
  await expect(navigation.locator("a")).toHaveCount(3);
});

test("login accepts a legacy short password and maps adapter errors safely", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=success");
  const form = page.locator("form");
  await form.getByLabel("Email or username").fill("legacy@example.test");
  await form.getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  // Success leaves for the destination; it never stops on a success message.
  await expect.poll(() => postAuthDestination(page)).toBeTruthy();
  await expect(page.locator("#auth-notice")).toHaveCount(0);
  await expect(dockButton(page)).toBeDisabled();

  // A different person on the same device: the remembered name is not reused.
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/login?auth_test=error");
  await page.locator("form").getByLabel("Email or username").fill("unknown@example.test");
  await page.locator("form").getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  const notice = page.locator('[data-notice-id="signin.wrong"][role="alert"]');
  await expect(notice).toHaveText(authNotice("signin.wrong").text);
  // The dock only says what it does; the reason lives in the notice slot.
  await expect(dockButton(page)).toHaveText("Sign in");
});

test("auth text-link rows use one fixed, vertically centered bar geometry", async ({ page }) => {
  await page.goto("/login?auth_test=success");

  const linkBar = page.locator(".auth-links .auth-bar");
  const legalBar = page.locator(".auth-legal .auth-bar");
  await expect(linkBar).toHaveCount(1);
  await expect(legalBar).toHaveCount(1);
  await expect(linkBar).toHaveCSS("width", "2px");
  await expect(linkBar).toHaveCSS("height", "15px");
  await expect(legalBar).toHaveCSS("width", "2px");
  await expect(legalBar).toHaveCSS("height", "13px");
  await expect(page.locator(".auth-field__toggle svg")).toHaveCSS("width", "22px");
  await expect(page.locator(".auth-links")).toContainText("Create account");
  await expect(page.locator(".auth-links")).toContainText("Reset password");

  const centreOffset = async (bar: typeof linkBar, link: ReturnType<Page["locator"]>) => {
    const barBox = await bar.boundingBox();
    const linkBox = await link.boundingBox();
    expect(barBox).not.toBeNull();
    expect(linkBox).not.toBeNull();
    return Math.abs(barBox!.y + barBox!.height / 2 - (linkBox!.y + linkBox!.height / 2));
  };
  expect(await centreOffset(linkBar, page.locator(".auth-links").getByRole("button", { name: "Create account" }))).toBeLessThanOrEqual(1);
  expect(await centreOffset(legalBar, page.locator(".auth-legal").getByRole("link", { name: "Privacy" }))).toBeLessThanOrEqual(1);
  const websiteLegalBox = await page.locator(".auth-legal").boundingBox();

  await page.goto("/login?auth_test=success&app=fitness");
  const fitnessLegal = page.locator(".auth-legal");
  await expect(fitnessLegal.locator(".auth-bar")).toHaveCount(1);
  expect(await centreOffset(fitnessLegal.locator(".auth-bar"), fitnessLegal.getByRole("link", { name: "Privacy" }))).toBeLessThanOrEqual(1);
  const fitnessLegalBox = await fitnessLegal.boundingBox();
  // Every product puts its legal row in the same place.
  expect(Math.round(fitnessLegalBox!.y)).toBe(Math.round(websiteLegalBox!.y));
});

test("auth entry uses one stable frame and remembers the returning username as a locked field", async ({ page }) => {
  await page.goto("/login?auth_test=success");

  const surface = page.locator('.auth-surface[data-auth-surface="credentials"]');
  await expect(surface).toHaveCSS("position", "relative");
  await expect(surface).toHaveCSS("display", "flex");
  await expect(surface.locator(".auth-body")).toHaveCSS("display", "flex");

  const form = page.locator("form");
  await form.getByLabel("Email or username").fill("fawxzzy");
  await form.getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  await expect.poll(() => postAuthDestination(page)).toBeTruthy();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const remembered = page.locator("#account-email");
  await expect(remembered).toHaveValue("fawxzzy");
  await expect(remembered).toHaveAttribute("readonly", "");
  await expect(fieldFrame(page, "account-email")).toHaveAttribute("data-locked", "true");
  await expect(page.getByLabel("Username")).toHaveValue("fawxzzy");
  // No username under the title: the identity lives only in the locked field.
  await expect(page.locator(".auth-head")).not.toContainText("fawxzzy");
  await expect(page.locator(".auth-links").getByRole("button")).toHaveText(["Not you?"]);

  await page.goto("/login?auth_test=session&app=fitness");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.locator("#account-email")).toHaveValue("fawxzzy");

  await page.getByRole("button", { name: "Not you?" }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByLabel("Email or username")).toHaveValue("");
  // The cleared field takes focus so the next person can type at once.
  await expect(page.getByLabel("Email or username")).toBeFocused();
  await expect(page.locator(".auth-field[data-locked]")).toHaveCount(0);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
});

test("auth fields use the canonical v2 text and spacing contract", async ({ page }) => {
  // Full sizes apply above 760px of height; shorter screens get the compact set.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login?auth_test=success");

  for (const id of ["account-email", "account-password"]) {
    const field = page.locator(`#${id}`);
    await expect(field).toHaveCSS("font-size", "17px");
    await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(field).toHaveCSS("padding-left", "48px");
    await expect(field).toHaveCSS("padding-right", "48px");
    await expect(field).toHaveCSS("text-align", "center");
    await expect(fieldFrame(page, id)).toHaveCSS("height", "60px");
    await expect(fieldFrame(page, id)).toHaveCSS("border-radius", "22px");
  }
  // Sentence-case labels.
  await expect(page.locator(".auth-field label")).toHaveText(["Email or username", "Password"]);
});

test("every account surface shares the head, fields, notice slot, links and dock order", async ({ page }) => {
  const surfaces = [
    { path: "/login?auth_test=success", surface: "credentials", signup: false },
    { path: "/login?auth_test=success", surface: "credentials", signup: true },
    { path: "/reset-password?auth_test=success", surface: "recovery", signup: false },
    { path: "/account?auth_test=session", surface: "account-status", signup: false },
  ] as const;

  for (const { path, signup, surface } of surfaces) {
    await page.goto(path);
    if (signup) await page.getByRole("button", { name: "Create account" }).click();
    const card = page.locator(`[data-auth-surface="${surface}"]`);
    await expect(card.locator(".auth-field").first()).toBeVisible();
    const box = async (selector: string) => {
      const value = await card.locator(selector).last().boundingBox();
      expect(value, `${surface} ${selector}`).not.toBeNull();
      return value!;
    };
    const head = await box(".auth-head");
    const firstField = (await card.locator(".auth-field").first().boundingBox())!;
    const lastField = await box(".auth-field");
    const slot = await box("[data-auth-slot]");
    const links = await box(".auth-links");
    const legal = await box(".auth-legal");
    const dock = await box(".auth-dock__button");
    const label = `${surface}${signup ? " (sign-up)" : ""}`;
    expect(head.y + head.height, `${label} head/fields`).toBeLessThanOrEqual(firstField.y + 1);
    expect(lastField.y + lastField.height, `${label} fields/slot`).toBeLessThanOrEqual(slot.y + 1);
    expect(slot.y + slot.height, `${label} slot/links`).toBeLessThanOrEqual(links.y + 1);
    expect(links.y + links.height, `${label} links/legal`).toBeLessThanOrEqual(legal.y + 1);
    expect(legal.y + legal.height, `${label} legal/dock`).toBeLessThanOrEqual(dock.y + 1);
    expect(dock.y + dock.height, `${label} dock in view`).toBeLessThanOrEqual(page.viewportSize()!.height);
    // The intro text is centred.
    await expect(card.locator(".auth-title")).toHaveCSS("text-align", "center");

    for (const field of await card.locator("input").all()) {
      await expect(field).toHaveCSS("padding-left", "48px");
      await expect(field).toHaveCSS("padding-right", "48px");
      await expect(field).toHaveCSS("text-align", "center");
      await expect(field).toHaveCSS("touch-action", "auto");
    }
  }
});

test("password fields expose exactly one product reveal control", async ({ page }) => {
  const surfaces = [
    "/login?auth_test=success",
    "/login?auth_test=success&app=fitness",
    "/login?auth_test=success&app=mazer",
    "/reset-password?recovery=1&auth_test=session",
  ];

  for (const path of surfaces) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Show password" }).first()).toBeVisible();
    const toggles = page.locator(".auth-field__toggle");
    const count = await toggles.count();
    expect(count).toBeGreaterThan(0);
    for (const toggle of await toggles.all()) {
      const frame = toggle.locator("xpath=..");
      await expect(frame.locator("input")).toHaveCount(1);
      await expect(frame.locator(".auth-field__toggle")).toHaveCount(1);
      expect(await frame.locator("input").evaluate((input) => (input as HTMLInputElement).type)).toBe(
        "password",
      );
    }
  }
});

test("auth inputs preserve native caret placement after editing", async ({ page }) => {
  await page.goto("/login?auth_test=success&app=fitness");
  const identifier = page.getByLabel("Email or username");
  await identifier.fill("fawxzzy.user");

  const selection = await identifier.evaluate((node) => {
    const input = node as HTMLInputElement;
    input.focus();
    input.setSelectionRange(7, 7);
    return {
      end: input.selectionEnd,
      start: input.selectionStart,
      value: input.value,
    };
  });

  expect(selection).toEqual({ end: 7, start: 7, value: "fawxzzy.user" });
  await page.keyboard.insertText("-");
  await expect(identifier).toHaveValue("fawxzzy-.user");
});

test("required-field feedback is one notice that says what is missing and outlines the fields", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  const identifier = page.getByLabel("Email or username");
  await dockButton(page).click();

  const notice = noticeOf(page, "signin.empty");
  await expect(notice).toHaveAttribute("role", "alert");
  await expect(notice).toHaveText(authNotice("signin.empty").text);
  await expect(page.locator("#auth-notice")).toHaveCount(1);
  await expect(fieldFrame(page, "account-email")).toHaveAttribute("data-invalid", "true");
  await expect(fieldFrame(page, "account-password")).toHaveAttribute("data-invalid", "true");
  await expect(fieldFrame(page, "account-email")).toHaveCSS("border-color", /rgba?\(255, 107, 120/);
  await expect(identifier).toHaveAttribute("aria-describedby", "auth-notice");
  await expect(identifier).toBeFocused();
  // The dock never carries the problem.
  await expect(dockButton(page)).toHaveText("Sign in");

  await identifier.fill("fawxzzy");
  await expect(fieldFrame(page, "account-email")).not.toHaveAttribute("data-invalid", "true");
  await expect(page.locator("#auth-notice")).toHaveCount(0);
});

test("signup names the first rule a field breaks, one notice at a time", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  await page.getByRole("button", { name: "Create account" }).click();
  const form = page.locator("form");
  await form.getByLabel("Username").fill("a b");
  await form.getByLabel("Email").fill("not-an-email");
  await form.getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  await expect(noticeOf(page, "signup.userinvalid")).toHaveText(authNotice("signup.userinvalid").text);
  await expect(form.getByLabel("Username")).toBeFocused();
  await expect(fieldFrame(page, "account-username")).toHaveAttribute("data-invalid", "true");

  await form.getByLabel("Username").fill("new-player");
  await dockButton(page).click();
  await expect(noticeOf(page, "signup.emailinvalid")).toBeVisible();
  await form.getByLabel("Email").fill("new@example.test");
  await dockButton(page).click();
  await expect(noticeOf(page, "signup.pwshort")).toHaveText(authNotice("signup.pwshort").text);
  await expect(page.locator("#auth-notice")).toHaveCount(1);
});

test("signup carries no leaderboard note and no identity under the title", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/leaderboard/i);
  await expect(page.locator("#account-username-note")).toHaveCount(0);
  await expect(page.getByLabel("Username")).not.toHaveAttribute("aria-describedby", /.+/);
  await expect(page.locator(".auth-head")).not.toContainText(/@|new-player/);
});

test("a username lockout shows its own message while email sign-in is unaffected", async ({ page }) => {
  await page.goto("/login?auth_test=login-throttled");
  const form = page.locator("form");
  await form.getByLabel("Email or username").fill("fawxzzy");
  await form.getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  await expect(page.locator('[data-notice-id="signin.throttled"][role="alert"]')).toHaveText(
    authNotice("signin.throttled").text,
  );
  await expect(noticeOf(page, "signin.wrong")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-post-auth-destination", /.+/);

  await page.goto("/login?auth_test=login-throttled");
  await form.getByLabel("Email or username").fill("legacy@example.test");
  await form.getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  await expect.poll(() => postAuthDestination(page)).toBeTruthy();
});

test("reset request says what is missing before any provider call", async ({ page }) => {
  await page.goto("/reset-password?auth_test=success");
  const email = page.getByLabel("Email");
  await expect(email).toBeEnabled();
  await dockButton(page).click();
  await expect(noticeOf(page, "signup.emailinvalid")).toHaveText(authNotice("signup.emailinvalid").text);
  await expect(email).toBeFocused();
  await email.fill("nope");
  await dockButton(page).click();
  await expect(noticeOf(page, "signup.emailinvalid")).toBeVisible();
  await expect(fieldFrame(page, "account-reset-email")).toHaveAttribute("data-invalid", "true");
});

test("field focus follows the field frame without drawing a second input outline", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  const identifier = page.getByLabel("Email or username");
  const identifierFrame = fieldFrame(page, "account-email");

  await identifier.focus();

  await expect(identifier).toHaveCSS("outline-style", "none");
  await expect(identifierFrame).toHaveCSS("border-width", "1px");
  await expect(identifierFrame).toHaveCSS("box-shadow", /rgba?\(/);

  await page.emulateMedia({ forcedColors: "active" });
  await expect(identifierFrame).toHaveCSS("outline-style", "solid");
  await expect(identifierFrame).toHaveCSS("outline-width", "2px");
  await expect(identifierFrame).toHaveCSS("outline-offset", "2px");
});

test("registered contexts swap product presentation without changing auth authority", async ({ page }) => {
  await page.goto("/login?auth_test=success&app=fitness");
  const card = page.locator('.auth-surface[data-auth-product="fitness"]');
  await expect(card).toBeVisible();
  await expect(card.locator(".auth-kicker")).toHaveText("Fitness");
  await expect(card.locator('.auth-app-icon[data-auth-icon="fitness"]')).toBeVisible();
  const legal = page.locator('.auth-legal[aria-label="Fitness legal"]');
  await expect(legal).toBeVisible();
  await expect(legal.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "https://fitness.fawxzzy.com/privacy",
  );
  await expect(legal.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "https://fitness.fawxzzy.com/terms",
  );
  await expect(legal.locator(".auth-bar")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Reset password" })).toHaveAttribute(
    "href",
    "/reset-password?app=fitness",
  );

  await page.goto("/login?auth_test=success&app=unknown");
  await expect(page.locator('.auth-surface[data-auth-product="website"]')).toBeVisible();
  await expect(page.locator('.auth-legal[aria-label="Fawxzzy legal"]')).toBeVisible();

  await page.goto("/login?auth_test=success&app=mazer&app=fitness");
  await expect(page.locator('.auth-surface[data-auth-product="website"]')).toBeVisible();
});

test("account status keeps the selected presentation context and safe login path", async ({ page }) => {
  await page.goto("/account?auth_test=success&app=mazer");
  await expect(page).toHaveURL(/\/login\?app=mazer$/);
  await expect(page.locator('[data-auth-surface="credentials"][data-auth-product="mazer"]')).toBeVisible();
});

test("account status does not offer sign in before session loading settles", async ({ page }) => {
  await page.goto("/account?auth_test=session-pending");
  const status = page.locator('[data-auth-surface="account-status"][data-auth-state="checking"]');
  await expect(status).toBeVisible();
  await expect(status.getByRole("heading", { name: "Checking your account…" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(dockButton(page)).toHaveCount(0);
});

test("account status exits checking when account service configuration is unavailable", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page.locator('[data-auth-surface="account-status"][data-auth-state="unavailable"]')).toBeVisible();
  await expect(noticeOf(page, "signin.unavailable")).toBeVisible();
  await expect(dockButton(page)).toHaveText("Sign out");
  await expect(dockButton(page)).toBeDisabled();
  await expect(page.getByText("Checking your account…")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("keyboard-height signup viewports keep every field and action rail visible without scrolling", async ({
  page,
}) => {
  for (const height of [560, 500]) {
    await page.setViewportSize({ width: 390, height });
    await page.goto("/login?auth_test=success");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-safe-top", "20px");
      document.documentElement.style.setProperty("--app-safe-bottom", "34px");
    });
    await page.getByRole("button", { name: "Create account" }).click();
    const bodyBox = await page.locator(".auth-body").boundingBox();
    const linksBox = await page.locator(".auth-links").boundingBox();
    const dockBox = await page.locator(".auth-dock").boundingBox();
    expect(bodyBox).not.toBeNull();
    expect(linksBox).not.toBeNull();
    expect(dockBox).not.toBeNull();

    for (const field of await page.locator(".auth-body input").all()) {
      await field.focus();
      const fieldBox = await field.boundingBox();
      expect(fieldBox, `${height}px field`).not.toBeNull();
      expect(fieldBox!.y, `${height}px field top`).toBeGreaterThanOrEqual(bodyBox!.y - 1);
      expect(fieldBox!.y + fieldBox!.height, `${height}px field bottom`).toBeLessThanOrEqual(
        bodyBox!.y + bodyBox!.height + 1,
      );
      expect(await page.evaluate(() => window.scrollY), `${height}px window scroll`).toBe(0);
    }

    const viewportState = await page.evaluate(() => ({
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
    }));
    expect(viewportState.documentScrollHeight, `${height}px document height`).toBeLessThanOrEqual(
      viewportState.documentClientHeight,
    );
    expect(bodyBox!.y + bodyBox!.height, `${height}px body/links`).toBeLessThanOrEqual(linksBox!.y + 1);
    expect(linksBox!.y + linksBox!.height, `${height}px links/dock`).toBeLessThanOrEqual(dockBox!.y + 1);
    expect(dockBox!.y + dockBox!.height, `${height}px dock`).toBeLessThanOrEqual(height);
  }
});

test("signup enforces ten characters and accepts long passwords", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=success");
  await page.getByRole("button", { name: "Create account" }).click();
  const form = page.locator("form");
  await form.getByLabel("Username").fill("new-player");
  await form.getByLabel("Email").fill("new@example.test");
  await form.getByLabel("Password", { exact: true }).fill("x".repeat(9));
  await dockButton(page).click();
  await expect(noticeOf(page, "signup.pwshort")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-post-auth-destination", /.+/);
  await form.getByLabel("Password", { exact: true }).fill("x".repeat(129));
  await dockButton(page).click();
  await expect.poll(() => postAuthDestination(page)).toBeTruthy();
  await expect(page.locator("#auth-notice")).toHaveCount(0);
});

test("the intent key opens sign-up only for one exact `signup` value", () => {
  expect(resolveAccountAuthIntent(["signup"])).toBe("signup");
  for (const raw of [
    [],
    [""],
    ["login"],
    ["SIGNUP"],
    ["Signup"],
    [" signup"],
    ["signup "],
    ["signup", "signup"],
    ["signup", "login"],
    ["login", "signup"],
    ["<script>alert(1)</script>"],
  ]) {
    expect(resolveAccountAuthIntent(raw), JSON.stringify(raw)).toBe("login");
  }
});

test("intent=signup opens Create account on the portal and the form still switches to sign-in", async ({
  browserName,
  page,
}) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  await page.goto("/login?intent=signup&auth_test=success", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("type", "email");
  await expect(dockButton(page)).toHaveText("Create account");
  // The toggle is the way back; the person's choice is not overridden by the address.
  await page.locator(".auth-links").getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toHaveCount(0);
  await page.locator(".auth-links").getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  // Opening on the sign-up form after hydration must not raise a hydration or framework error.
  expect(errors).toEqual([]);
});

for (const query of [
  "",
  "&intent=login",
  "&intent=SIGNUP",
  "&intent=signup&intent=login",
  "&intent=%3Cscript%3E",
]) {
  test(`an unrecognised intent (${query || "none"}) opens sign-in`, async ({ page }) => {
    await page.goto(`/login?auth_test=success${query}`);
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await expect(page.getByLabel("Username", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Email or username")).toBeVisible();
  });
}

test("intent=signup from Fitness keeps the secure handoff and the plain-language guidance", async ({
  browserName,
  page,
}) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto(
    "/login?app=fitness&intent=signup&auth_test=success&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2Ftoday",
  );
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.locator('.auth-surface[data-auth-product="fitness"]')).toBeVisible();
  // Guidance still names what a field left empty needs, before any provider call.
  await dockButton(page).click();
  await expect(noticeOf(page, "signup.userinvalid")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-post-auth-destination", /.+/);
  // The handoff and return path are the ordinary Fitness sign-up ones.
  await page.getByLabel("Username", { exact: true }).fill("new.fitness.user");
  await page.getByLabel("Email", { exact: true }).fill("new.fitness.user@example.test");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple");
  await dockButton(page).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-post-auth-destination",
    "https://fitness.fawxzzy.com/today",
  );
});

test("intent=signup never widens the return allowlist", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto(
    "/login?app=fitness&intent=signup&auth_test=success&returnTo=https%3A%2F%2Fattacker.example.test%2F",
  );
  // The form swaps from sign-in to sign-up on hydration; wait for it before typing into it.
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("new.fitness.user");
  await page.getByLabel("Email", { exact: true }).fill("new.fitness.user@example.test");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple");
  await dockButton(page).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-post-auth-destination",
    "https://fitness.fawxzzy.com/",
  );
});

test("a session-bearing signup without product context continues like sign-in", async ({
  browserName,
  page,
}) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=success");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Username").fill("new-player");
  await page.getByLabel("Email").fill("new@example.test");
  await page.getByLabel("Password", { exact: true }).fill("long-enough-password");
  await dockButton(page).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination"))
    .toBe("https://fawxzzy.com/?signedIn=1");
  await expect(page.locator("body")).not.toContainText("session is available");
  await expect(page.locator("#auth-notice")).toHaveCount(0);
});

test("a session-bearing signup honours the Projects return target", async ({ page }) => {
  await page.goto("/login?auth_test=success&returnTo=%2Fprojects");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Username").fill("new-player");
  await page.getByLabel("Email").fill("new@example.test");
  await page.getByLabel("Password", { exact: true }).fill("long-enough-password");
  await dockButton(page).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination"))
    .toBe("/projects");
});

test("a session-bearing Fitness signup completes the secure consumer handoff", async ({ page }) => {
  await page.goto("/login?app=fitness&auth_test=success&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2Ftoday");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Username").fill("new.fitness.user");
  await page.getByLabel("Email").fill("new.fitness.user@example.test");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple");
  await dockButton(page).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-post-auth-destination",
    "https://fitness.fawxzzy.com/today",
  );
  // A signup that carries a session continues; it never stops on a success message.
  await expect(page.locator("#auth-notice")).toHaveCount(0);
});

test("a Fitness signup never reports success when its consumer handoff fails", async ({ page }) => {
  await page.goto("/login?app=fitness&auth_test=fitness-handoff-error");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Username").fill("new.fitness.user");
  await page.getByLabel("Email").fill("new.fitness.user@example.test");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery-staple");
  await dockButton(page).click();
  await expect(page.locator('[data-notice-id="signin.callback"][role="alert"]')).toHaveText(
    authNotice("signin.callback").text,
  );
  await expect(page.locator("html")).not.toHaveAttribute("data-post-auth-destination", /.+/);
});

test("signup validation stops before the provider call", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=signup-existing");
  await page.getByRole("button", { name: "Create account" }).click();
  const form = page.locator("form");
  const password = form.getByLabel("Password", { exact: true });
  const submit = dockButton(page);
  await form.getByLabel("Username").fill("existing-player");
  await form.getByLabel("Email").fill("existing@example.test");
  await password.fill("too-short");
  await submit.click();

  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(noticeOf(page, "signup.pwshort")).toHaveText(authNotice("signup.pwshort").text);
  // The provider was never asked, so its "email already has an account" answer never shows.
  await expect(noticeOf(page, "signup.emailexists")).toHaveCount(0);
  await expect(page.locator("#auth-notice")).toHaveCount(1);
  await expect(submit).toBeEnabled();
});

test("every provider signup rejection names its own cause and never reads as success", async ({
  context,
  page,
}) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const rejections: { scenario: string; diagnostic: string; id: AuthMessageId }[] = [
    { scenario: "signup-existing", diagnostic: "User already registered", id: "signup.emailexists" },
    { scenario: "signup-weak-password", diagnostic: "known to be weak", id: "signup.pwweak" },
    { scenario: "signup-rate-limit", diagnostic: "Too many requests", id: "signup.rate" },
    {
      scenario: "signup-network",
      diagnostic: "fetch failed at the deterministic provider boundary",
      id: "signin.offline",
    },
    {
      scenario: "signup-unknown",
      diagnostic: "Malformed provider detail must never reach the interface",
      id: "page.crash",
    },
    // A generic database failure has no named cause (reported gap) and is not claimed to be a taken username.
    { scenario: "signup-database-error", diagnostic: "Database error saving new user", id: "page.crash" },
    { scenario: "signup-username-taken", diagnostic: "ACCOUNT_USERNAME_TAKEN", id: "signup.taken" },
  ];

  for (const { diagnostic, id, scenario } of rejections) {
    await page.goto(`/login?auth_test=${scenario}`);
    await page.getByRole("button", { name: "Create account" }).click();
    const form = page.locator("form");
    await form.getByLabel("Username").fill("test-player");
    await form.getByLabel("Email").fill(`${scenario}@example.test`);
    await form.getByLabel("Password", { exact: true }).fill("long-enough-password");
    await dockButton(page).click();

    const notice = page.locator("#auth-notice");
    await expect(notice, scenario).toHaveAttribute("data-notice-id", id);
    await expect(notice).toHaveAttribute("data-notice-kind", "error");
    await expect(notice).toHaveAttribute("role", "alert");
    await expect(notice.locator(".auth-notice__text")).toContainText(authNotice(id).text);
    // The dock only ever says what it does.
    await expect(dockButton(page)).toHaveText("Create account");
    await expect(page.locator("body")).not.toContainText("account request is complete");
    await expect(page.locator("body")).not.toContainText("session is available");
    await expect(page.locator("html")).not.toHaveAttribute("data-post-auth-destination", /.+/);
    // The way back to sign-in stays one tap away.
    await expect(page.locator(".auth-links").getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(diagnostic);
  }
  expect(await context.cookies()).toEqual([]);
});

test("a taken username outlines the username field and nothing else is disclosed", async ({
  browserName,
  page,
}) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/login?auth_test=signup-username-taken");
    await page.getByRole("button", { name: "Create account" }).click();
    const form = page.locator("form");
    const username = form.getByLabel("Username");
    await username.fill("taken-player");
    await form.getByLabel("Email").fill("someone@example.test");
    await form.getByLabel("Password", { exact: true }).fill("long-enough-password");
    await dockButton(page).click();

    const notice = noticeOf(page, "signup.taken");
    await expect(notice).toHaveText(authNotice("signup.taken").text);
    await expect(notice).toBeInViewport();
    await expect(fieldFrame(page, "account-username")).toHaveAttribute("data-invalid", "true");
    await expect(fieldFrame(page, "account-email")).not.toHaveAttribute("data-invalid", "true");
    await expect(username).toHaveAttribute("aria-invalid", "true");
    await expect(username).toHaveAttribute("aria-describedby", "auth-notice");
    await expect(username).toBeFocused();
    await expect(page.locator("html")).not.toHaveAttribute("data-post-auth-destination", /.+/);
    await expect(page.locator("body")).not.toContainText("ACCOUNT_USERNAME_TAKEN");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Editing the username clears the flag and the notice.
    await username.fill("another-player");
    await expect(page.locator("#auth-notice")).toHaveCount(0);
    await expect(username).not.toHaveAttribute("aria-invalid", "true");
  }
});

test("email-duplicate and generic database rejections never flag the username", async ({
  browserName,
  page,
}) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [scenario, id] of [
    ["signup-existing", "signup.emailexists"],
    ["signup-database-error", "page.crash"],
  ] as const) {
    await page.goto(`/login?auth_test=${scenario}`);
    await page.getByRole("button", { name: "Create account" }).click();
    const form = page.locator("form");
    await form.getByLabel("Username").fill("test-player");
    await form.getByLabel("Email").fill(`${scenario}@example.test`);
    await form.getByLabel("Password", { exact: true }).fill("long-enough-password");
    await dockButton(page).click();
    await expect(noticeOf(page, id)).toBeVisible();
    await expect(noticeOf(page, "signup.taken")).toHaveCount(0);
    await expect(form.getByLabel("Username")).not.toHaveAttribute("aria-invalid", "true");
    if (id === "signup.emailexists") {
      await expect(fieldFrame(page, "account-email")).toHaveAttribute("data-invalid", "true");
      // The inline action takes the person to sign in.
      await noticeOf(page, id).getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    }
  }
});

test("username-taken detection reads only the provider error text", () => {
  expect(isUsernameTakenError(new Error("ACCOUNT_USERNAME_TAKEN"))).toBe(true);
  expect(isUsernameTakenError({ message: "hook returned 409: ACCOUNT_USERNAME_TAKEN" })).toBe(true);
  expect(isUsernameTakenError({ msg: "x", code: "ACCOUNT_USERNAME_TAKEN" })).toBe(true);
  expect(isUsernameTakenError("ACCOUNT_USERNAME_TAKEN")).toBe(true);
  expect(isUsernameTakenError(new Error("Database error saving new user"))).toBe(false);
  expect(isUsernameTakenError(new Error("User already registered"))).toBe(false);
  expect(isUsernameTakenError({ detail: "ACCOUNT_USERNAME_TAKEN" })).toBe(false);
  expect(isUsernameTakenError(null)).toBe(false);
  expect(isUsernameTakenError(undefined)).toBe(false);
  expect(authNotice("signup.taken").text).toBe("That username is taken. Try another.");
});

test("account status copies the compact Mazer hierarchy without unfinished service copy", async ({
  context,
  page,
}) => {
  await page.goto("/account?auth_test=session");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue("fawxzzy");
  await expect(page.getByLabel("Username", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("preview.user@example.test");
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.locator("body")).not.toContainText("Canonical global username");
  await expect(page.locator("body")).not.toContainText("Immutable global user number");
  await expect(page.locator("body")).not.toContainText("Connections are coming soon");
  await expect(page.locator("body")).not.toContainText("Open your apps");
  await expect(page.getByRole("link", { name: "Reset password" })).toHaveAttribute(
    "href",
    "/reset-password",
  );
  // Projects is reached through the owner-only nav tab, not a link in this panel.
  await expect(page.locator("[data-account-projects-links]")).toHaveCount(0);
  expect(await context.cookies()).toEqual([]);

  await expect(page.getByText(AUTH_COPY.lead.account)).toBeVisible();
  await expect(page.locator(".auth-field[data-locked]")).toHaveCount(2);
  const linksBox = await page.locator(".auth-links").boundingBox();
  const dockBox = await dockButton(page).boundingBox();
  expect(linksBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(linksBox!.y + linksBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  // The page picks its own destination (the website) and the session-lost redirect stays out of it.
  await expect(page.locator("html")).toHaveAttribute(
    "data-sign-out-destination",
    `${accountContract.publicHubOrigin}/?signedOut=1`,
  );
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/\/account\?auth_test=session$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-session-lost-redirect", /.+/);
});

// MAZER-ACCT-023: SIGNED_OUT arrives before adapter.signOut() resolves. The "session lost"
// redirect to /login must not run ahead of the product origin the page sends the person to.
test("account sign-out from Mazer heads for Mazer, never the login page", async ({ page }) => {
  await page.goto("/account?auth_test=session&app=mazer");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-sign-out-destination",
    `${accountContract.productOrigins.mazer}/`,
  );
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/\/account\?auth_test=session&app=mazer$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-session-lost-redirect", /.+/);
});

test("the account page signs out everywhere, the recovery session only itself", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/account?auth_test=session");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-sign-out-scope", "everywhere");

  // Choosing a new password ends the throw-away recovery session, not the person's apps.
  await page.goto("/reset-password?recovery=1&auth_test=success&code=one-time-code");
  await expect(page.locator("form").getByLabel("New password", { exact: true })).toBeVisible();
  await page.locator("form").getByLabel("New password", { exact: true }).fill("correct-horse-battery-staple");
  await page.getByLabel("Confirm password").fill("correct-horse-battery-staple");
  await dockButton(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-sign-out-scope", "this-session");
});

test("a session another app ended is found on load and sends the person to sign in", async ({ page }) => {
  await page.goto("/account?auth_test=session-revoked-elsewhere&app=fitness");
  await expect(page).toHaveURL(/\/login\?app=fitness$/);
});

/** Dispatches the page events the account page revalidates on, in a controlled way. */
async function fireReturnEvent(
  page: import("@playwright/test").Page,
  kind: "focus" | "visible" | "hidden" | "restored" | "navigated",
) {
  await page.evaluate((eventKind) => {
    if (eventKind === "focus") {
      window.dispatchEvent(new Event("focus"));
    } else if (eventKind === "visible" || eventKind === "hidden") {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => eventKind,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      delete (document as unknown as Record<string, unknown>).visibilityState;
    } else {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: eventKind === "restored" }));
    }
  }, kind);
}

const sessionValidations = (page: import("@playwright/test").Page) =>
  page.locator("html").getAttribute("data-session-validations");

test("the account page revalidates on focus, return and page restore, at most once per interval", async ({ page }) => {
  await page.clock.install();
  await page.goto("/account?auth_test=session");
  await expect.poll(() => sessionValidations(page)).toBe("1");

  // Focus, visibility and page-restore fire together on a return: still one check in the interval.
  await fireReturnEvent(page, "focus");
  await fireReturnEvent(page, "visible");
  await fireReturnEvent(page, "restored");
  expect(await sessionValidations(page)).toBe("1");

  await page.clock.fastForward(30_000);
  await fireReturnEvent(page, "focus");
  await expect.poll(() => sessionValidations(page)).toBe("2");

  await page.clock.fastForward(30_000);
  await fireReturnEvent(page, "hidden"); // leaving the tab is not a return
  expect(await sessionValidations(page)).toBe("2");
  await fireReturnEvent(page, "visible");
  await expect.poll(() => sessionValidations(page)).toBe("3");

  await page.clock.fastForward(30_000);
  await fireReturnEvent(page, "navigated"); // pageshow without bfcache is a normal load
  expect(await sessionValidations(page)).toBe("3");
  await fireReturnEvent(page, "restored");
  await expect.poll(() => sessionValidations(page)).toBe("4");
});

test("a session another app ends while this tab is away is found when the person returns", async ({ page }) => {
  await page.clock.install();
  await page.goto("/account?auth_test=session-revoked-on-return");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect.poll(() => sessionValidations(page)).toBe("1");
  await expect(page).toHaveURL(/\/account\?auth_test=session-revoked-on-return$/);
  await page.clock.fastForward(30_000);
  await fireReturnEvent(page, "visible");
  await expect(page).toHaveURL(/\/login$/);
});

test("a failed session check never signs the person out", async ({ page }) => {
  await page.clock.install();
  await page.goto("/account?auth_test=session-validation-unavailable");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect.poll(() => sessionValidations(page)).toBe("1");
  await page.clock.fastForward(30_000);
  await fireReturnEvent(page, "visible");
  await expect.poll(() => sessionValidations(page)).toBe("2");
  // Let the rejected check's promise handlers run (a message-channel task is not faked by the clock).
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    }),
  );
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/account\?auth_test=session-validation-unavailable$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-session-lost-redirect", /.+/);
});

test("the provider's fresh account details are applied even when the SDK announces a session event during the check", async ({ page }) => {
  await page.goto("/account?auth_test=session-refreshed-on-check");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("renamed.user@example.test");
});

test("a session lost without this page signing out still redirects to login", async ({ page }) => {
  await page.goto("/account?auth_test=session-expires&app=mazer");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?app=mazer$/);
});

test("successful website login records the canonical public destination", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  await page.getByLabel("Email or username").fill("fawxzzy");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination"))
    .toBe("https://fawxzzy.com/?signedIn=1");
});

test("Projects sign-in returns to the same account-origin page", async ({ page }) => {
  await page.goto("/login?auth_test=success&returnTo=%2Fprojects");
  await page.getByLabel("Email or username").fill("fawxzzy");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination"))
    .toBe("/projects");
});

test("contextual login records only a closed product continuation", async ({ page }) => {
  const accepted = encodeURIComponent(
    "https://fitness.fawxzzy.com/session/abc?returnTo=%2Ftoday",
  );
  await page.goto(`/login?app=fitness&auth_test=success&returnTo=${accepted}`);
  await page.getByLabel("Email or username").fill("fawxzzy");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await dockButton(page).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination"))
    .toBe("https://fitness.fawxzzy.com/entry");
});

for (const [name, returnTo] of [
  ["wrong-origin", "https://mazer.fawxzzy.com/"],
  ["token-bearing", "https://fitness.fawxzzy.com/session?id_token=secret"],
] as const) {
  test(`contextual login fails ${name} continuation closed to the product root`, async ({ page }) => {
    await page.goto(
      `/login?app=fitness&auth_test=success&returnTo=${encodeURIComponent(returnTo)}`,
    );
    await page.getByLabel("Email or username").fill("fawxzzy");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await dockButton(page).click();
    await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination"))
      .toBe("https://fitness.fawxzzy.com/");
  });
}

test("username login and autofill styling remain explicit source contracts", async () => {
  const adapterSource = readFileSync(path.resolve("src/lib/auth/browser-adapter.ts"), "utf8");
  const functionSource = readFileSync(path.resolve("supabase/functions/username-password-signin/index.ts"), "utf8");
  const functionConfig = readFileSync(path.resolve("supabase/config.toml"), "utf8");
  const migrationSource = readFileSync(
    path.resolve("supabase/migrations/20260826163000_account_username_signin_index.sql"),
    "utf8",
  );
  const responseMigrationSource = readFileSync(
    path.resolve("supabase/migrations/20260827053000_account_username_signin_rpc_response.sql"),
    "utf8",
  );
  const apiSchemaMigrationSource = readFileSync(
    path.resolve("supabase/migrations/20260827094500_account_username_signin_api_schema.sql"),
    "utf8",
  );
  const styleSource = readFileSync(path.resolve("src/styles/page-families/auth-surface.css"), "utf8");
  const accountPortalContract = readFileSync(
    path.resolve("docs/shared-account-portal-phase1.md"),
    "utf8",
  );
  expect(adapterSource).toContain('/functions/v1/username-password-signin');
  expect(adapterSource).toContain("client.auth.setSession");
  expect(functionConfig).toContain("verify_jwt = false");
  expect(functionConfig).toContain('schemas = ["mazer", "fitness", "account_api"]');
  expect(functionSource).toContain('await isAcceptedPublicKey(requestKey)');
  expect(functionSource).toContain('/auth/v1/settings');
  expect(functionSource).toContain('headers: { apikey: candidate }');
  expect(functionSource).not.toContain('Authorization: `Bearer ${requestKey}`');
  expect(functionSource).toContain("resolveUsernameSignIn");
  expect(functionSource).not.toContain("listUsers");
  expect(functionSource).toContain("00000000-0000-0000-0000-000000000000");
  expect(functionSource).toContain('Invalid credentials');
  expect(migrationSource).toContain("normalized_username text not null unique");
  expect(migrationSource).toContain("refresh_username_signin_candidate");
  expect(migrationSource).toContain("conflicting_user.id <> candidate_user.id");
  expect(migrationSource).toContain("where claim_count = 1");
  expect(migrationSource).toContain("pg_advisory_xact_lock");
  expect(migrationSource).toContain("order by candidate");
  expect(migrationSource.indexOf("pg_advisory_xact_lock")).toBeLessThan(
    migrationSource.indexOf("delete from account_private.username_signin_index"),
  );
  expect(migrationSource).toContain("after insert or update or delete on auth.users");
  expect(migrationSource).not.toContain("select id, lower(trim(raw_user_meta_data ->> 'username'))\nfrom auth.users");
  expect(migrationSource).toContain("current_count > 10");
  expect(migrationSource).toContain("client_count > 30");
  expect(migrationSource).toContain("global_count > 500");
  expect(migrationSource).toContain("delete from account_private.username_signin_attempts");
  expect(migrationSource).toContain("grant execute on function public.account_resolve_username_signin");
  expect(responseMigrationSource).toContain("returns table (resolved_user_id uuid)");
  expect(responseMigrationSource).toContain("return query");
  expect(responseMigrationSource).toContain("grant execute on function public.account_resolve_username_signin_v2");
  expect(responseMigrationSource).not.toContain("returns uuid");
  expect(apiSchemaMigrationSource).toContain("create schema if not exists account_api");
  expect(apiSchemaMigrationSource).toContain("function account_api.account_resolve_username_signin_v2");
  expect(apiSchemaMigrationSource).toContain("from public.account_resolve_username_signin_v2");
  expect(apiSchemaMigrationSource).toContain("grant execute on function account_api.account_resolve_username_signin_v2");
  expect(apiSchemaMigrationSource).toContain("to service_role");
  expect(apiSchemaMigrationSource).toContain("revoke all on schema account_api from public, anon, authenticated");
  expect(accountPortalContract).toContain(
    "Production activation must likewise add `account_api` to the",
  );
  expect(accountPortalContract).toContain(
    "existing exposed-schema setting before the Edge Function is activated",
  );
  expect(styleSource).toContain('input:-webkit-autofill');
  expect(styleSource).not.toContain("::-webkit-credentials-auto-fill-button");
  expect(styleSource).not.toContain("::-webkit-contacts-auto-fill-button");
});

test("username resolver transport requests a plural response and fails closed on malformed shapes", async () => {
  const serviceRole = "service-role-fixture";
  const url = "https://project.example.test";
  const args = {
    p_attempt_key: "a".repeat(64),
    p_client_attempt_key: "b".repeat(64),
    p_normalized_username: "fawxzzy",
  };
  const resolved = "adc7ca28-7271-5599-826f-fd7e4477b542";
  let request: { input?: string; init?: RequestInit } = {};
  const fetchImpl = async (input: string, init?: RequestInit) => {
    request = { input, init };
    return new Response(JSON.stringify([{ resolved_user_id: resolved }]), { status: 200 });
  };

  await expect(resolveUsernameSignInRpc({ args, fetchImpl, serviceRole, url })).resolves.toBe(resolved);
  expect(request.input).toBe(`${url}/rest/v1/rpc/account_resolve_username_signin_v2`);
  expect(request.init?.headers).toMatchObject({
    Accept: "application/json",
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
  });
  expect(request.init?.body).toBe(JSON.stringify(args));
  expect(request.init?.redirect).toBe("error");
  expect(request.init?.headers).toMatchObject({
    "Accept-Profile": "account_api",
    "Content-Profile": "account_api",
  });

  const respond = (body: unknown, status = 200) => async () =>
    new Response(JSON.stringify(body), { status });
  const postgresCanonicalUuid = "01890f8a-7b3c-7def-f123-abcdefabcdef";
  await expect(resolveUsernameSignInRpc({
    args,
    fetchImpl: respond([{ resolved_user_id: postgresCanonicalUuid }], 200),
    serviceRole,
    url,
  })).resolves.toBe(postgresCanonicalUuid);

  for (const fetchResponse of [
    respond([], 200),
    respond([{ resolved_user_id: resolved }, { resolved_user_id: resolved }], 200),
    respond({ resolved_user_id: resolved }, 200),
    respond([{ resolved_user_id: "not-a-uuid" }], 200),
    respond({ message: "not acceptable" }, 406),
    async () => { throw new Error("network detail must not escape"); },
  ]) {
    await expect(resolveUsernameSignInRpc({ args, fetchImpl: fetchResponse, serviceRole, url }))
      .resolves.toBeNull();
  }
});

test("runtime key admission accepts only canonical public key classes", async () => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const legacyAnon = `${encode({ alg: "HS256" })}.${encode({ role: "anon" })}.signature`;
  const legacyService = `${encode({ alg: "HS256" })}.${encode({ role: "service_role" })}.signature`;
  const known = new Set(["sb_publishable_known", legacyAnon]);
  let validations = 0;
  const canonicalProject = async (key: string) => {
    validations += 1;
    return key === "sb_publishable_remote";
  };

  expect(await validatePublicClientKey("sb_publishable_known", known, canonicalProject)).toBe(true);
  expect(await validatePublicClientKey(legacyAnon, known, canonicalProject)).toBe(true);
  expect(await validatePublicClientKey("sb_publishable_remote", known, canonicalProject)).toBe(true);
  expect(await validatePublicClientKey("sb_publishable_cross_project", known, canonicalProject)).toBe(false);
  expect(await validatePublicClientKey("sb_secret_privileged", known, canonicalProject)).toBe(false);
  expect(await validatePublicClientKey(legacyService, known, canonicalProject)).toBe(false);
  expect(await validatePublicClientKey("not-a-key", known, canonicalProject)).toBe(false);
  expect(validations).toBe(2);
  await expect(validatePublicClientKey("sb_publishable_error", known, async () => {
    throw new Error("settings unavailable");
  })).resolves.toBe(false);
});

test("runtime key admission caches success and bounds pre-lookup project validation", async () => {
  let currentTime = 1_000;
  let validations = 0;
  const admit = createPublicKeyAdmission({
    cacheTtlMs: 100,
    maxCacheEntries: 2,
    maxRemoteValidations: 2,
    now: () => currentTime,
    windowMs: 1_000,
  });
  const validate = async (key: string) => {
    validations += 1;
    return key === "sb_publishable_active";
  };

  expect(await admit("sb_publishable_active", new Set(), validate)).toBe(true);
  expect(await admit("sb_publishable_active", new Set(), validate)).toBe(true);
  expect(validations).toBe(1);

  expect(await admit("sb_publishable_invalid_one", new Set(), validate)).toBe(false);
  expect(await admit("sb_publishable_invalid_two", new Set(), validate)).toBe(false);
  expect(validations).toBe(2);

  currentTime += 1_000;
  expect(await admit("sb_publishable_invalid_two", new Set(), validate)).toBe(false);
  expect(validations).toBe(3);

  currentTime += 101;
  expect(await admit("sb_publishable_active", new Set(), validate)).toBe(true);
  expect(validations).toBe(4);
});

test("serialized duplicate username reconciliation keeps both users and restores unique claims", async () => {
  const claims = new Map<string, string>();
  const index = new Map<string, string>();
  const lockTails = new Map<string, Promise<void>>();

  const withCandidateLock = async (candidate: string, operation: () => Promise<void>) => {
    const previous = lockTails.get(candidate) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    lockTails.set(candidate, previous.then(() => current));
    await previous;
    try {
      await operation();
    } finally {
      release();
    }
  };
  const reconcileWhileLocked = (candidate: string) => {
    index.delete(candidate);
    const owners = [...claims].filter(([, claim]) => claim === candidate);
    if (owners.length === 1) index.set(candidate, owners[0][0]);
  };
  const withCandidateLocks = async (
    candidates: string[],
    operation: () => Promise<void>,
    offset = 0,
  ): Promise<void> => {
    if (offset === candidates.length) return operation();
    return withCandidateLock(
      candidates[offset],
      () => withCandidateLocks(candidates, operation, offset + 1),
    );
  };
  const setClaim = async (userId: string, candidate: string) => {
    const oldCandidate = claims.get(userId);
    const candidates = [...new Set([oldCandidate, candidate].filter(Boolean) as string[])].sort();
    await withCandidateLocks(candidates, async () => {
      claims.set(userId, candidate);
      for (const changedCandidate of candidates) reconcileWhileLocked(changedCandidate);
    });
  };

  await Promise.all([
    setClaim("user-a", "shared"),
    setClaim("user-b", "shared"),
  ]);
  expect([...claims.keys()].sort()).toEqual(["user-a", "user-b"]);
  expect(index.has("shared")).toBe(false);

  await setClaim("user-b", "other");
  expect(index.get("shared")).toBe("user-a");
  expect(index.get("other")).toBe("user-b");
});

test("recovery exchanges PKCE before exposing the password form", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  // Signed out, the answer never says whether an account uses the address.
  await page.goto("/reset-password?auth_test=success");
  await expect(page.getByLabel("Email")).toBeEnabled();
  await page.getByLabel("Email").fill("private@example.test");
  await dockButton(page).click();
  await expect(page.locator('[data-notice-id="reset.sentany"][role="status"]')).toHaveText(
    authNotice("reset.sentany").text,
  );
  await expect(page.locator("body")).not.toContainText("private@example.test");
  await expect(dockButton(page)).toHaveText(/^Resend in 0:\d\d$/);
  await expect(dockButton(page)).toBeDisabled();

  // A provider that cannot send gets its own line, never the success line.
  await page.goto("/reset-password?auth_test=error");
  await expect(page.getByLabel("Email")).toBeEnabled();
  await page.getByLabel("Email").fill("private@example.test");
  await dockButton(page).click();
  await expect(noticeOf(page, "reset.sendfail")).toBeVisible();

  // While the one-time code is exchanged the form is there, but nothing can be typed or saved.
  await page.goto("/reset-password?recovery=1&auth_test=pending&code=pending-code");
  await expect(page.getByRole("heading", { name: "New password" })).toBeVisible();
  await expect(page.locator("form").getByLabel("New password", { exact: true })).toBeDisabled();
  await expect(dockButton(page)).toHaveText("Save password");
  await expect(dockButton(page)).toBeDisabled();

  // A dead link lands on the request form with the reason in the notice slot.
  await page.goto("/reset-password?recovery=1&auth_test=error&code=failed-code");
  await expect(noticeOf(page, "reset.invalid")).toHaveText(authNotice("reset.invalid").text);
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator("form").getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/reset-password\?recovery=1$/);

  await page.goto("/reset-password?recovery=1&auth_test=success&token=blocked");
  await expect(noticeOf(page, "reset.invalid")).toBeVisible();
  await expect(page.locator("form").getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/reset-password\?recovery=1$/);

  await page.goto("/reset-password?recovery=1&auth_test=success");
  await expect(noticeOf(page, "reset.expired")).toHaveText(authNotice("reset.expired").text);
  await expect(page.locator("form").getByLabel("New password", { exact: true })).toHaveCount(0);
  await page.getByLabel("Email").fill("private@example.test");
  // Typing the address is the next step; the old reason clears.
  await expect(page.locator("#auth-notice")).toHaveCount(0);

  await page.goto("/reset-password?recovery=1&auth_test=success&code=one-time-code");
  await expect(page).toHaveURL(/\/reset-password\?recovery=1$/);
  const password = "x".repeat(129);
  const submit = dockButton(page);
  await expect(page.locator("form").getByLabel("New password", { exact: true })).toBeEnabled();
  await page.locator("form").getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill("y".repeat(129));
  await submit.click();
  await expect(page.getByLabel("Confirm password")).toHaveAttribute("aria-invalid", "true");
  await expect(noticeOf(page, "reset.mismatch")).toHaveText(authNotice("reset.mismatch").text);
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveText("Save password");

  await page.getByLabel("Confirm password").fill(password);
  await submit.click();
  // Saved: the person lands on sign in with the saved line.
  await expect(page.locator("html")).toHaveAttribute("data-reset-destination", /^\/login\?notice=resetdone/);

  await page.goto("/reset-password?recovery=1&auth_test=session");
  await expect(page.locator("form").getByLabel("New password", { exact: true })).toBeVisible();
});

test("confirmation is browser-bound, one-time, and works from a new tab", async ({ context, page }) => {
  await page.goto("/apps");
  await page.evaluate((key) => window.localStorage.setItem(key, "fitness-confirm-state"), accountContract.confirmationStateKey);
  const confirmationPage = await context.newPage();
  await confirmationPage.goto(
    "/auth/confirm?app=fitness&auth_test=success&token_hash=private-hash&type=signup&state=fitness-confirm-state&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
  );
  await expect(confirmationPage.locator('[data-auth-surface="confirm"]')).toBeVisible();
  await expect(confirmationPage.locator("html")).toHaveAttribute("data-link-outcome", "success");
  await expect(confirmationPage.locator("html")).toHaveAttribute(
    "data-link-destination",
    "https://fitness.fawxzzy.com/",
  );
  await expect(confirmationPage).toHaveURL(/\/auth\/confirm$/);
  await expect.poll(() => confirmationPage.evaluate((key) => window.localStorage.getItem(key), accountContract.confirmationStateKey)).toBeNull();
});

test("Fitness confirmation fails closed when its secure session handoff cannot complete", async ({ page }) => {
  await page.goto("/apps");
  await page.evaluate((key) => window.localStorage.setItem(key, "fitness-confirm-state"), accountContract.confirmationStateKey);
  await page.goto(
    "/auth/confirm?app=fitness&auth_test=fitness-handoff-error&token_hash=private-hash&type=signup&state=fitness-confirm-state&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
  );
  // No dead end: sign in for the same product, never the Fitness destination.
  await expect(page).toHaveURL(/\/login\?app=fitness$/);
  await expect(page.locator('[data-auth-surface="credentials"][data-auth-product="fitness"]')).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-link-destination", /fitness\.fawxzzy\.com/);
});

test("Fitness confirmation binding follows its destination despite presentation query drift", async ({ page }) => {
  for (const appQuery of ["", "&app=website", "&app=unknown", "&app=website&app=fitness"]) {
    await page.goto(
      `/auth/confirm?auth_test=success&token_hash=private-hash&type=signup&state=forwarded-state&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F${appQuery}`,
    );
    // Opened in a browser that did not start the sign-up: back to sign in, no Fitness handoff.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('[data-auth-surface="credentials"]')).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-link-destination", /fitness\.fawxzzy\.com/);
  }
});

test("confirmation fallback actions preserve the selected product context", async ({ page }) => {
  await page.goto("/auth/confirm?app=mazer");
  await expect(page).toHaveURL(/\/login\?app=mazer$/);
  await expect(page.locator('[data-auth-surface="credentials"][data-auth-product="mazer"]')).toBeVisible();
});

test("a failed link lands on sign in with the reason in the notice slot", async ({ page }) => {
  await page.goto("/login?notice=callback&auth_test=success&app=mazer");
  await expect(noticeOf(page, "signin.callback")).toHaveText(authNotice("signin.callback").text);
  // The reason is read once, then removed from the address.
  await expect(page).toHaveURL(/\/login\?auth_test=success&app=mazer$/);
  await page.goto("/login?notice=confirmed&auth_test=success");
  await expect(page.locator('[data-notice-id="signin.confirmed"][role="status"]')).toBeVisible();
  // Anything off the allowlist is ignored.
  await page.goto("/login?notice=%3Cscript%3E&auth_test=success");
  await expect(page.locator("#auth-notice")).toHaveCount(0);
});

test("callback validates state, exchanges once, and never retains token material", async ({ page }) => {
  await page.goto("/apps");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "expected-state"), accountContract.callbackStateKey);
  const callback =
    "/auth/callback?auth_test=success&code=one-time-code&state=expected-state&returnTo=%2Faccount";
  await page.goto(callback);
  await expect(page).toHaveURL(/\/account$/);
  expect(await page.evaluate(() => window.sessionStorage.length)).toBeGreaterThan(0);

  // The same one-time link again: no second exchange, straight on to the destination.
  await page.goto(callback);
  await expect(page).toHaveURL(/\/account$/);

  await page.goto("/auth/callback?auth_test=success#access_token=secret&refresh_token=secret");
  await expect(page).toHaveURL(/\/login$/);
  expect(page.url()).not.toContain("secret");
});

test("Fitness callbacks establish the secure consumer session before returning", async ({ page }) => {
  await page.goto("/apps");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "fitness-state"), accountContract.callbackStateKey);
  await page.goto(
    "/auth/callback?app=fitness&auth_test=success&code=fitness-code&state=fitness-state&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2Ftoday",
  );
  await expect(page.locator('[data-auth-surface="callback"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-link-outcome", "success");
  await expect(page.locator("html")).toHaveAttribute(
    "data-link-destination",
    "https://fitness.fawxzzy.com/today",
  );
});

test("Fitness callbacks do not redirect when the secure consumer session fails", async ({ page }) => {
  await page.goto("/apps");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "fitness-state"), accountContract.callbackStateKey);
  await page.goto(
    "/auth/callback?app=fitness&auth_test=fitness-handoff-error&code=fitness-code&state=fitness-state&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2Ftoday",
  );
  // Never on to Fitness: back to sign in for the same product.
  await expect(page).toHaveURL(/\/login\?app=fitness$/);
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(/\/login\?app=fitness$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-link-destination", /fitness\.fawxzzy\.com/);
});

test("the public legal center publishes all versioned canonical documents", async ({ page }) => {
  for (const [route, title, documentId] of legalRoutes) {
    await page.goto(route);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${productIdentity.canonicalOrigin}${route}`,
    );
    const document = page.locator(`[data-legal-document="${documentId}"]`);
    await expect(document).toHaveAttribute(
      "data-legal-version",
      documentId === "platform-privacy" || documentId === "mazer-privacy" ? "2026-11-13" : "2026-09-13",
    );
    await expect(document.getByText("Last updated")).toContainText(
      documentId === "platform-privacy" || documentId === "mazer-privacy" ? "November 13, 2026" : legalCenter.lastUpdated.label,
    );
  }
  const sitemapUrls = sitemap().map((entry) => entry.url);
  for (const [route] of legalRoutes) {
    expect(sitemapUrls).toContain(`${productIdentity.canonicalOrigin}${route}`);
  }
});

test("website, Mazer, and unknown account contexts use the correct legal center", async ({ page }) => {
  const surfaces = ["/login", "/reset-password", "/account"] as const;
  for (const route of surfaces) {
    const scenario = route === "/account" ? "session" : "success";
    await page.goto(`${route}?auth_test=${scenario}`);
    const websiteLegal = page.locator('.auth-legal[aria-label="Fawxzzy legal"]');
    await expect(websiteLegal.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute(
      "href",
      "https://fawxzzy.com/privacy",
    );
    await expect(websiteLegal.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute(
      "href",
      "https://fawxzzy.com/terms",
    );

    await page.goto(`${route}?app=mazer&auth_test=${scenario}`);
    const mazerLegal = page.locator('.auth-legal[aria-label="Mazer legal"]');
    await expect(mazerLegal.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute(
      "href",
      "https://fawxzzy.com/legal/mazer/privacy",
    );
    await expect(mazerLegal.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute(
      "href",
      "https://fawxzzy.com/legal/mazer/terms",
    );

    await page.goto(`${route}?app=unknown&auth_test=${scenario}`);
    await expect(page.locator('.auth-surface[data-auth-product="website"]')).toBeVisible();
    await expect(page.locator('.auth-legal[aria-label="Fawxzzy legal"]')).toBeVisible();
  }
});

test("first-party Mazer authorization auto-approves without a consent card", async ({ page }) => {
  const authorizationId = "authorization-id-1234567890";
  await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session`);
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    `https://mazer.fawxzzy.com/?code=local-code&state=${oauthState}`,
  );
  await expect(page).toHaveURL(/\/oauth\/authorize\?auth_test=session$/);
  await expect(page.locator('[data-auth-surface="oauth-consent"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Continue to Mazer?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to Mazer" })).toHaveCount(0);
  await expect(page.getByText("Mazer will use your Fawxzzy email")).toHaveCount(0);
  await expect.poll(() => page.evaluate(
    (id) => Object.values(window.localStorage).some((value) => value.includes(id)),
    authorizationId,
  )).toBe(false);
});

test("first-party Mazer auto-approve failure goes back to Mazer's sign-in once, with no card or retry loop", async ({ page }) => {
  let decisions = 0;
  await page.route("**/api/account/mazer-oauth-pending", async (route) => {
    if (route.request().method() === "PUT") {
      decisions += 1;
      await route.fulfill({ status: 502 });
      return;
    }
    await route.fallback();
  });
  await page.goto(
    "/oauth/authorize?authorization_id=authorization-id-1234567890&auth_test=session",
  );
  // A service failure is not an expired link: Mazer's sign-in gets the `unavailable` notice.
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    "https://mazer.fawxzzy.com/?notice=unavailable",
  );
  await expect(page.locator('[data-auth-surface="oauth"]')).toHaveCount(0);
  await expect(page.locator('[data-auth-surface="oauth-consent"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to Mazer" })).toHaveCount(0);
  await page.waitForTimeout(1_000);
  expect(decisions).toBe(1);
});

test("first-party Mazer auto-approve rejects a hostile provider redirect without a card", async ({ page }) => {
  await page.goto(
    "/oauth/authorize?authorization_id=authorization-id-1234567890&auth_test=oauth-hostile",
  );
  // An unsafe redirect is the one case that keeps the portal fallback screen.
  await expect(page.locator('[data-auth-surface="oauth"][data-auth-state="unsafe"]')).toContainText(AUTH_COPY.title.signInLinkExpired);
  await expect(page.locator('[data-auth-surface="oauth"] .auth-dock__button')).toHaveAttribute("href", accountContract.productOrigins.mazer);
  await expect(page.locator('[data-auth-surface="oauth-consent"]')).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-oauth-redirect", /.+/);
});

test("retained Mazer consent card captures once, scrubs the URL, and approves to the exact app", async ({ page }) => {
  const authorizationId = "authorization-id-1234567890";
  await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session&oauth_consent=1`);
  await expect(page).toHaveURL(/\/oauth\/authorize\?auth_test=session&oauth_consent=1$/);
  await expect(page.locator('[data-auth-surface="oauth-consent"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue to Mazer?" })).toBeVisible();
  await expect(page.getByText("Mazer will use your Fawxzzy email")).toBeVisible();
  const legal = page.locator('.auth-legal[aria-label="Mazer legal"]');
  await expect(legal.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute(
    "href",
    "https://fawxzzy.com/legal/mazer/privacy",
  );
  await expect(legal.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute(
    "href",
    "https://fawxzzy.com/legal/mazer/terms",
  );
  await expect.poll(() => page.evaluate(
    (id) => Object.values(window.localStorage).some((value) => value.includes(id)),
    authorizationId,
  )).toBe(false);

  await page.getByRole("button", { name: "Continue to Mazer" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    `https://mazer.fawxzzy.com/?code=local-code&state=${oauthState}`,
  );
});

test("retained Mazer consent card denial returns a bounded OAuth error", async ({ page }) => {
  const authorizationId = "authorization-id-1234567890";
  await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=session&oauth_consent=1`);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    `https://mazer.fawxzzy.com/?error=access_denied&error_description=${encodeURIComponent(MAZER_OAUTH_DENIAL_DESCRIPTION)}&state=${oauthState}`,
  );
});

test("Mazer authorization preserves a clean internal return through sign-in", async ({ page }) => {
  const authorizationId = "authorization-id-1234567890";
  await page.goto(`/oauth/authorize?authorization_id=${authorizationId}&auth_test=success`);
  await expect(page).toHaveURL(
    /\/login\?app=mazer&returnTo=%2Foauth%2Fauthorize&auth_test=success$/,
  );
  await page.getByLabel("Email or username").fill("fawxzzy");
  await page.locator('input[name="password"]').fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination")).toBe(
    "/oauth/authorize",
  );
});

test("Mazer authorization preserves the same request through signup and recovery", async ({ page }) => {
  const loginUrl = "/login?app=mazer&returnTo=%2Foauth%2Fauthorize&auth_test=success";
  await page.goto(loginUrl);
  await expect(page.getByRole("link", { name: "Reset password" })).toHaveAttribute(
    "href",
    "/reset-password?app=mazer&returnTo=%2Foauth%2Fauthorize",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Username").fill("new.mazer.user");
  await page.getByLabel("Email", { exact: true }).fill("new.mazer.user@example.test");
  await page.locator('input[name="password"]').fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination")).toBe(
    "/oauth/authorize",
  );

  await page.goto("/reset-password?app=mazer&returnTo=%2Foauth%2Fauthorize&auth_test=success");
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    loginUrl.replace("&auth_test=success", ""),
  );
});

test("Mazer authorization rejects duplicate requests and hostile provider redirects", async ({ page }) => {
  await page.goto(
    "/oauth/authorize?authorization_id=authorization-id-1234567890&authorization_id=authorization-id-0987654321&auth_test=session",
  );
  // A malformed request goes back to Mazer's sign-in (a constant destination) with the reason.
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    "https://mazer.fawxzzy.com/?notice=expired",
  );

  await page.goto(
    "/oauth/authorize?authorization_id=authorization-id-1234567890&auth_test=oauth-hostile&oauth_consent=1",
  );
  await expect(page.getByRole("button", { name: "Continue to Mazer" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Mazer" }).click();
  await expect(page.locator('[data-auth-surface="oauth"][data-auth-state="unsafe"]')).toContainText(AUTH_COPY.title.signInLinkExpired);
  await expect(page.locator("html")).not.toHaveAttribute("data-oauth-redirect", /.+/);
});

test("retained Mazer consent card fails closed after a same-tab auth-generation change", async ({ page }) => {
  await page.goto(
    "/oauth/authorize?authorization_id=authorization-id-1234567890&auth_test=session&oauth_consent=1",
  );
  await expect(page.getByRole("button", { name: "Continue to Mazer" })).toBeVisible();
  await page.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: accountContract.authGenerationKey, value: "b".repeat(64) },
  );
  await page.getByRole("button", { name: "Continue to Mazer" }).click();
  // Nothing is approved; the player starts again from Mazer's sign-in.
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    "https://mazer.fawxzzy.com/?notice=expired",
  );
});

test("retained Mazer consent card fails closed after a cross-tab auth-generation change", async ({ context, page }) => {
  await page.goto(
    "/oauth/authorize?authorization_id=authorization-id-1234567890&auth_test=session&oauth_consent=1",
  );
  await expect(page.getByRole("button", { name: "Continue to Mazer" })).toBeVisible();
  const sibling = await context.newPage();
  await sibling.goto("/apps");
  await sibling.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: accountContract.authGenerationKey, value: "c".repeat(64) },
  );
  await sibling.close();
  await page.getByRole("button", { name: "Continue to Mazer" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    "https://mazer.fawxzzy.com/?notice=expired",
  );
});

test("Mazer authorization accepts only a previously approved exact app redirect", async ({ page }) => {
  await page.goto(
    "/oauth/authorize?authorization_id=authorization-id-1234567890&auth_test=oauth-auto",
  );
  await expect.poll(() => page.locator("html").getAttribute("data-oauth-redirect")).toBe(
    `https://mazer.fawxzzy.com/?code=local-auto-code&state=${oauthState}`,
  );
  await expect(page.getByRole("button", { name: "Continue to Mazer" })).toHaveCount(0);
  await expect(page.locator('[data-auth-surface="oauth-consent"]')).toHaveCount(0);
});

test("callback rejects a mismatched state without an exchange", async ({ page }) => {
  await page.goto("/apps");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "expected"), accountContract.callbackStateKey);
  await page.goto("/auth/callback?auth_test=success&code=code&state=wrong");
  await expect(page).toHaveURL(/\/login$/);
  // No exchange happened: no receipt, and the expected state is still waiting for its own link.
  expect(
    await page.evaluate(
      ([receipt, stateKey]) => [window.sessionStorage.getItem(receipt), window.sessionStorage.getItem(stateKey)],
      [callbackReceiptKey("code"), accountContract.callbackStateKey],
    ),
  ).toEqual([null, "expected"]);
});

test("account routes load without app console, page, or framework errors", async ({ context }) => {
  for (const [route] of accountRoutes) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page.locator('[data-nextjs-dialog], #webpack-dev-server-client-overlay')).toHaveCount(0);
    expect(errors, route).toEqual([]);
    await page.close();
  }
});

for (const [route] of accountRoutes) {
  test(`${route} has no automated WCAG A/AA violations`, async ({ page }) => {
    // Link routes hand straight on to sign in; the screen a person lands on is what gets checked.
    await gotoSettled(page, route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("account routes fit an iPhone-class viewport and expose visible focus states", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route] of accountRoutes) {
    await gotoSettled(page, route);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      minimumTargetHeight: Math.min(
        ...[...document.querySelectorAll<HTMLElement>(
          ".site-nav a, .account-utility-nav a, .auth-surface button, .auth-surface input, .auth-surface a",
        )]
          .map((element) => Math.round(element.getBoundingClientRect().height))
          .filter((height) => height > 0),
      ),
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.className,
            right: Math.round(rect.right),
            tag: element.tagName,
            width: Math.round(rect.width),
          };
        })
        .filter(({ right, width }) => right > document.documentElement.clientWidth + 1 || width > document.documentElement.clientWidth + 1)
        .slice(0, 8),
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `${route}: ${JSON.stringify(dimensions.offenders)}`).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
    expect(dimensions.minimumTargetHeight, `${route} touch targets`).toBeGreaterThanOrEqual(44);
    await expect(page.locator("main#main-content")).toBeVisible();
    await page.locator("main a, main button, main input").first().focus();
    await expect(page.locator(":focus")).toBeVisible();
  }
});

test("mobile account screens use one locked viewport without nested scrolling or overlap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  const cases = [
    { route: "/login?auth_test=success", title: "Welcome", create: false },
    { route: "/login?auth_test=success", title: "Create account", create: true },
    { route: "/reset-password?auth_test=success", title: "Reset password", create: false },
    { route: "/account?auth_test=session", title: "Account", create: false },
  ] as const;

  for (const { route, title, create } of cases) {
    await page.goto(route);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-safe-top", "20px");
      document.documentElement.style.setProperty("--app-safe-bottom", "34px");
    });
    if (create) await page.locator(".auth-links").getByRole("button", { name: "Create account" }).click();
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
    const before = await heading.boundingBox();
    await page.evaluate(() => window.scrollTo(0, 500));
    const after = await heading.boundingBox();
    expect(await page.evaluate(() => window.scrollY), route).toBe(0);
    expect(after?.y, route).toBe(before?.y);
    const body = page.locator(".auth-body");
    const bodyBox = await body.boundingBox();
    const bodyScroll = await body.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    // The body may scroll only when a keyboard steals the room; at rest everything fits.
    expect((before?.y ?? 0) + (before?.height ?? 0), route).toBeLessThanOrEqual((bodyBox?.y ?? 0) + 1);
    expect(bodyScroll.scrollTop, route).toBe(0);
    expect(bodyScroll.scrollHeight, route).toBeLessThanOrEqual(bodyScroll.clientHeight + 1);

    const linksBox = await page.locator(".auth-links").boundingBox();
    const dockBox = await page.locator(".auth-dock").boundingBox();
    expect(linksBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect((bodyBox?.y ?? 0) + (bodyBox?.height ?? 0), route).toBeLessThanOrEqual((linksBox?.y ?? 0) + 1);
    expect((linksBox?.y ?? 0) + (linksBox?.height ?? 0), route).toBeLessThanOrEqual((dockBox?.y ?? 0) + 1);
    expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0), route).toBeLessThanOrEqual(650);
  }
});
