import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
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
  resolveAccountExperienceContext,
  sanitizeReturnTarget,
} from "../../src/config/account";
import {
  callbackReceiptKey,
  callbackStateMatches,
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
import { safeAuthError, safeAuthSuccess } from "../../src/lib/auth/errors";
import { validatePassword } from "../../src/lib/auth/password-policy";
import { isBrowserSafeSupabasePublicKey } from "../../src/lib/auth/supabase-public-key.mjs";
import {
  humanAccountServices,
  normalizeServiceRegistrationReadModel,
  resolveServiceRegistrationPresentation,
  serviceRegistrationDispositions,
  sourceOnlyServiceRegistrationCapability,
} from "../../src/lib/account/service-registration";
import { apps } from "../../src/data/apps";
import { productIdentity } from "../../src/config/product";

const accountRoutes = [
  ["/login", `Sign in | ${productIdentity.publicName}`],
  ["/account", `Account | ${productIdentity.publicName}`],
  ["/auth/confirm", `Confirm account | ${productIdentity.publicName}`],
  ["/auth/callback", `Account handoff | ${productIdentity.publicName}`],
  ["/reset-password", `Reset password | ${productIdentity.publicName}`],
] as const;

test("auth surfaces derive public branding from product identity", () => {
  const sources = [
    "../../src/app/login/page.tsx",
    "../../src/app/account/page.tsx",
    "../../src/app/auth/callback/page.tsx",
    "../../src/app/auth/confirm/page.tsx",
    "../../src/components/account/account-portal.tsx",
  ];

  for (const sourcePath of sources) {
    const source = readFileSync(path.resolve(process.cwd(), "tests/e2e", sourcePath), "utf8");
    expect(source).toContain("productIdentity.publicName");
    expect(source).not.toMatch(/["'`]Fawxzzy(?: account| apps)?[."'`<]/);
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

test("one presentation registry renders every product without claiming consumer adoption", () => {
  expect(resolveAccountExperienceContext("website")).toEqual(accountExperienceContexts.website);
  expect(resolveAccountExperienceContext("fitness")).toEqual(accountExperienceContexts.fitness);
  expect(resolveAccountExperienceContext("mazer")).toEqual(accountExperienceContexts.mazer);
  expect(resolveAccountExperienceContext("unknown")).toEqual(accountExperienceContexts.website);
  expect(accountExperienceContexts.website.consumerIntegration).toBe("active");
  expect(accountExperienceContexts.fitness.consumerIntegration).toBe("pending");
  expect(accountExperienceContexts.mazer.consumerIntegration).toBe("pending");
  expect(accountExperienceContexts.fitness.legalLinks).toEqual([]);
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
    "/reset-password?recovery=1",
    "https://fawxzzy.com/",
    "https://fitness.fawxzzy.com/",
    "https://mazer.fawxzzy.com/",
    "https://fawxzzy-fitness-local.vercel.app/",
    "https://fawxzzy-mazer.vercel.app/",
  ]) {
    expect(sanitizeReturnTarget(allowed)).toBe(allowed);
  }

  for (const rejected of [
    "//evil.test/account",
    "/account?access_token=secret",
    "/reset-password?recovery=1&code=secret",
    "/login",
    "https://user@example.com/",
    "https://fitness.fawxzzy.com.evil.test/",
    "https://fitness.fawxzzy.com/path",
    "https://fitness.fawxzzy.com/?code=secret",
    "https://fitness.fawxzzy.com/#access_token=secret",
    "http://fitness.fawxzzy.com/",
    "https://evil.test/",
  ]) {
    expect(sanitizeReturnTarget(rejected), rejected).toBe("/account");
  }
});

test("password policy distinguishes login from account-changing actions without truncation", () => {
  expect(validatePassword("short", "login")).toEqual({ valid: true });
  expect(validatePassword("short", "signup").valid).toBe(false);
  expect(validatePassword("1234567890", "signup")).toEqual({ valid: true });
  expect(validatePassword("x".repeat(129), "reset")).toEqual({ valid: true });
  expect(validatePassword("x".repeat(512), "change")).toEqual({ valid: true });
});

test("safe messages are deterministic and non-enumerating", () => {
  expect(safeAuthError("login")).not.toContain("account exists");
  expect(safeAuthError("signup")).toBe(safeAuthSuccess("signup"));
  expect(safeAuthSuccess("reset-request")).toContain("If an account can receive");
  expect(safeAuthError("reset-request")).toBe(safeAuthSuccess("reset-request"));
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
  const confirm = parseConfirmPayload(
    new URL(
      "https://account.fawxzzy.com/auth/confirm?token_hash=hash&type=signup&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
    ),
  );
  expect(confirm).toEqual({
    returnTo: "https://fitness.fawxzzy.com/",
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

test("all account routes carry account canonical metadata and setup-pending state", async ({ page }) => {
  for (const [route, title] of accountRoutes) {
    await page.goto(route);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${accountContract.canonicalOrigin}${route}`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    if (route === "/auth/confirm" || route === "/auth/callback") {
      await expect(page.locator('[data-auth-state="invalid"]')).toBeVisible();
      await expect(page.locator('[data-system-state="unavailable"]')).toHaveCount(0);
    } else if (route === "/login" || route === "/reset-password" || route === "/account") {
      await expect(page.locator('[data-system-state="unavailable"]')).toHaveCount(0);
      await expect(page.locator(".account-capability-note")).toHaveText(
        "Account service unavailable on this origin.",
      );
    } else {
      await expect(page.locator('[data-system-state="unavailable"]').first()).toBeVisible();
    }
    await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
    await expect(page.getByRole("navigation", { name: "Account" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  }
});

test("utility Auth routes use one focused task shell", async ({ page }) => {
  for (const [route] of utilityRoutes) {
    await page.goto(route);
    await expect(page.getByRole("navigation", { name: "Account" })).toHaveCount(0);
    await expect(page.locator(".account-utility-layout > .account-card")).toHaveCount(1);
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
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.locator('[data-auth-surface="credentials"]')).toBeVisible();
  await expect(page.getByLabel("Email or username")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show password" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("preview-me");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" }).last()).toBeDisabled();
  await expect(page.getByText("Account service unavailable on this origin.")).toBeAttached();
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
      await page.goto(route);
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
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(navigation.getByRole("link", { name: "Apps", exact: true })).toHaveAttribute(
    "href",
    "/apps",
  );
  await expect(navigation.getByRole("link", { name: "Account", exact: true })).toHaveAttribute(
    "href",
    accountUrls.account,
  );
  await expect(navigation.locator("a")).toHaveCount(4);
});

test("login accepts a legacy short password and maps adapter errors safely", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=success");
  const form = page.locator("form");
  await form.getByLabel("Email or username").fill("legacy@example.test");
  await form.getByLabel("Password", { exact: true }).fill("short");
  const loginSubmit = page.locator(".account-auth-dock").getByRole("button", { name: "Sign in" });
  await loginSubmit.click();
  await expect(page.getByRole("status")).toContainText("Signed in on this account origin");
  await expect(page.locator(".account-auth-dock button")).toBeDisabled();

  await page.goto("/login?auth_test=error");
  await page.locator("form").getByLabel("Email or username").fill("unknown@example.test");
  await page.locator("form").getByLabel("Password", { exact: true }).fill("short");
  await page.locator(".account-auth-dock").getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator('.account-auth-live-notice[role="alert"]')).toContainText(
    safeAuthError("login"),
  );
  await expect(page.locator(".account-auth-dock button")).toContainText(safeAuthError("login"));
});

test("auth footer uses the shared pipe and one geometry-owned secondary rail", async ({ page }) => {
  await page.goto("/login?auth_test=success");

  const separator = page.locator(".account-link-separator");
  const passwordIcon = page.locator(".account-password-toggle svg");
  await expect(separator).toHaveCount(1);
  await expect(separator.locator(":scope > span")).toHaveCount(1);
  await expect(passwordIcon).toHaveCSS("width", "20px");
  await expect(passwordIcon).toHaveCSS("height", "20px");
  await expect(page.locator(".account-text-action")).toHaveCSS("padding", "0px");
  await expect(page.locator(".account-card__links")).toContainText("Create account");
  await expect(page.locator(".account-card__links")).toContainText("Reset password");

  const footerBox = await page.locator(".account-auth-secondary").boundingBox();
  const dockBox = await page.locator(".account-auth-dock .catalog-button").boundingBox();
  expect(footerBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(Math.round(dockBox!.y - (footerBox!.y + footerBox!.height))).toBe(16);
});

test("auth entry uses one stable Fitness-shaped frame and remembers the returning username", async ({ page }) => {
  await page.goto("/login?auth_test=success");

  const card = page.locator(".account-card--auth");
  const body = page.locator(".account-auth-body");
  const form = page.locator(".account-form--auth");
  await expect(card).toHaveCSS("position", "relative");
  await expect(card).toHaveCSS("display", "flex");
  await expect(body).toHaveCSS("display", "flex");
  await expect(form).toHaveCSS("position", "static");

  await form.getByLabel("Email or username").fill("fawxzzy");
  await form.getByLabel("Password", { exact: true }).fill("short");
  await page.locator(".account-auth-dock").getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("remembered-identity")).toHaveText("fawxzzy");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByTestId("remembered-identity")).toHaveText("fawxzzy");

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByTestId("remembered-identity")).toHaveCount(0);
});

test("auth fields use the canonical Fitness text and spacing contract", async ({ page }) => {
  await page.goto("/login?auth_test=success");

  const identifier = page.locator("form").getByLabel("Email or username");
  const password = page.locator("form").getByLabel("Password", { exact: true });
  for (const field of [identifier, password]) {
    await expect(field).toHaveCSS("font-size", "14px");
    await expect(field).toHaveCSS("line-height", "20px");
    await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(field).toHaveCSS("padding-left", "54px");
    await expect(field).toHaveCSS("padding-right", "54px");
    await expect(field).toHaveCSS("text-align", "center");
  }
});

test("every account surface shares the anchored intro, centered fields, and dock rail", async ({ page }) => {
  const surfaces = [
    { path: "/login?auth_test=success", surface: "credentials" },
    { path: "/reset-password?auth_test=success", surface: "recovery" },
    { path: "/account?auth_test=session", surface: "account-status" },
  ] as const;

  for (const { path, surface } of surfaces) {
    await page.goto(path);
    const card = page.locator(`[data-auth-surface="${surface}"]`);
    const intro = card.locator(".account-auth-intro");
    const secondary = card.locator(".account-auth-secondary");
    const dock = card.locator(".account-auth-dock .catalog-button");

    await expect(intro).toHaveCSS("flex-grow", "0");
    await expect(intro).toHaveCSS("flex-shrink", "0");

    const cardBox = await card.boundingBox();
    const introBox = await intro.boundingBox();
    const secondaryBox = await secondary.boundingBox();
    const dockBox = await dock.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(introBox).not.toBeNull();
    expect(secondaryBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(Math.round(introBox!.y - cardBox!.y)).toBe(0);
    expect(Math.round(dockBox!.y - (secondaryBox!.y + secondaryBox!.height))).toBe(16);

    for (const field of await card.locator("input").all()) {
      await expect(field).toHaveCSS("padding-left", "54px");
      await expect(field).toHaveCSS("padding-right", "54px");
      await expect(field).toHaveCSS("text-align", "center");
    }
  }

  await page.goto("/login?auth_test=success");
  await page.getByRole("button", { name: "Create account" }).click();
  const signupCard = page.locator('[data-auth-surface="credentials"]');
  await expect(signupCard.getByRole("heading", { name: "Create account" })).toBeVisible();
  for (const field of await signupCard.locator("input").all()) {
    await expect(field).toHaveCSS("padding-left", "54px");
    await expect(field).toHaveCSS("padding-right", "54px");
    await expect(field).toHaveCSS("text-align", "center");
  }
});

test("required-field feedback is visual and does not add an error paragraph", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  const submit = page.locator(".account-auth-dock").getByRole("button", { name: "Sign in" });
  await submit.click();

  const identifierFrame = page.locator("fieldset").filter({ hasText: "Email or username" });
  const passwordFrame = page.locator("fieldset").filter({ hasText: "Password" });
  await expect(identifierFrame).toHaveAttribute("data-invalid", "true");
  await expect(passwordFrame).toHaveAttribute("data-invalid", "true");
  await expect(identifierFrame).toHaveCSS("border-color", "rgb(255, 77, 87)");
  await expect(page.locator(".account-auth-live-notice")).toHaveCount(0);

  await page.getByLabel("Email or username").fill("fawxzzy");
  await expect(identifierFrame).not.toHaveAttribute("data-invalid", "true");
});

test("registered contexts swap product presentation without changing auth authority", async ({ page }) => {
  await page.goto("/login?auth_test=success&app=fitness");
  const card = page.locator('.account-card--auth[data-auth-product="fitness"]');
  await expect(card).toBeVisible();
  await expect(page.locator(".account-auth-intro > p")).toHaveText("Fitness");
  await expect(page.getByRole("navigation", { name: "Fitness legal" })).toHaveCount(0);
  await expect(page.locator('.account-auth-legal[aria-label="Fitness legal"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reset password" })).toHaveAttribute(
    "href",
    "/reset-password?app=fitness",
  );

  await page.goto("/login?auth_test=success&app=unknown");
  await expect(page.locator('.account-card--auth[data-auth-product="website"]')).toBeVisible();
  await expect(page.locator(".account-auth-legal")).toHaveCount(0);

  await page.goto("/login?auth_test=success&app=mazer&app=fitness");
  await expect(page.locator('.account-card--auth[data-auth-product="website"]')).toBeVisible();
});

test("account status keeps the selected presentation context and safe login path", async ({ page }) => {
  await page.goto("/account?auth_test=success&app=mazer");
  await expect(page).toHaveURL(/\/login\?app=mazer$/);
  await expect(page.locator('[data-auth-surface="credentials"][data-auth-product="mazer"]')).toBeVisible();
});

test("account status does not offer sign in before session loading settles", async ({ page }) => {
  await page.goto("/account?auth_test=session-pending");
  await expect(page.getByRole("button", { name: "Checking…" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("account status exits checking when account service configuration is unavailable", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "Unavailable" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Checking…" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("short create-account viewports can scroll fields above the fixed action rails", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/login?auth_test=success");
  await page.getByRole("button", { name: "Create account" }).click();
  const password = page.getByLabel("Password", { exact: true });
  await password.focus();
  await password.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const passwordBox = await password.boundingBox();
  const secondaryBox = await page.locator(".account-auth-secondary").boundingBox();
  expect(passwordBox).not.toBeNull();
  expect(secondaryBox).not.toBeNull();
  expect(passwordBox!.y + passwordBox!.height).toBeLessThanOrEqual(secondaryBox!.y);
});

test("signup enforces ten characters and accepts long passwords", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=success");
  const createAccountMode = page.getByRole("button", { name: "Create account" });
  await createAccountMode.click();
  const form = page.locator("form");
  await expect(form.getByLabel("Password", { exact: true })).toHaveAttribute("minlength", "10");
  await form.getByLabel("Username").fill("new-player");
  await form.getByLabel("Email").fill("new@example.test");
  await form.getByLabel("Password", { exact: true }).fill("x".repeat(129));
  await page.locator(".account-auth-dock").getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("account request is complete");
});

test("signup validation stops before the provider call", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=signup-existing");
  await page.getByRole("button", { name: "Create account" }).click();
  const form = page.locator("form");
  const password = form.getByLabel("Password", { exact: true });
  const submit = page.locator(".account-auth-dock").getByRole("button", { name: "Create account" });
  await form.getByLabel("Username").fill("existing-player");
  await form.getByLabel("Email").fill("existing@example.test");
  await password.fill("too-short");
  await submit.click();

  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('.account-auth-live-notice[role="status"]')).toHaveCount(0);
  await expect(page.locator('.account-auth-live-notice[role="alert"]')).toHaveCount(0);
  await expect(submit).toBeEnabled();
});

test("every settled provider signup outcome has one non-enumerating result", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const outcomes = [
    { scenario: "success", diagnostic: null },
    { scenario: "signup-existing", diagnostic: "User already registered" },
    { scenario: "signup-rate-limit", diagnostic: "Too many requests" },
    {
      scenario: "signup-network",
      diagnostic: "fetch failed at the deterministic provider boundary",
    },
    {
      scenario: "signup-unknown",
      diagnostic: "Malformed provider detail must never reach the interface",
    },
  ] as const;
  const expectedNotice = safeAuthSuccess("signup");

  for (const { scenario, diagnostic } of outcomes) {
    await page.goto(`/login?auth_test=${scenario}`);
    await page.getByRole("button", { name: "Create account" }).click();
    const form = page.locator("form");
    const submit = page.locator('.account-auth-dock button[type="submit"]');
    await form.getByLabel("Username").fill("test-player");
    await form.getByLabel("Email").fill(`${scenario}@example.test`);
    await form.getByLabel("Password", { exact: true }).fill("long-enough-password");
    await submit.click();

    await expect(submit).toHaveText(/^Working/);
    await expect(submit).toBeDisabled();
    const notice = page.locator('.account-auth-live-notice[role="status"]');
    await expect(notice).toContainText(expectedNotice);
    await expect(notice).toHaveAttribute("data-notice-kind", "success");
    await expect(page.locator('.account-auth-live-notice[role="alert"]')).toHaveCount(0);
    await expect(submit).toHaveText(expectedNotice);
    await expect(submit).toBeDisabled();
    if (diagnostic) await expect(page.locator("body")).not.toContainText(diagnostic);
  }

  expect(await context.cookies()).toEqual([]);
});

test("account status copies the compact Mazer hierarchy without unfinished service copy", async ({
  context,
  page,
}) => {
  await page.goto("/account?auth_test=session");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveValue("fawxzzy");
  await expect(page.getByLabel("Username")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Email")).toHaveValue("preview.user@example.test");
  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  await expect(page.locator("body")).not.toContainText("Canonical global username");
  await expect(page.locator("body")).not.toContainText("Immutable global user number");
  await expect(page.locator("body")).not.toContainText("Connections are coming soon");
  await expect(page.locator("body")).not.toContainText("Open your apps");
  await expect(page.getByRole("link", { name: "Reset password" })).toHaveAttribute(
    "href",
    "/reset-password",
  );
  expect(await context.cookies()).toEqual([]);

  const secondaryBox = await page.locator(".account-auth-secondary").boundingBox();
  const dockBox = await page.locator(".account-auth-dock .catalog-button").boundingBox();
  expect(secondaryBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(Math.round(dockBox!.y - (secondaryBox!.y + secondaryBox!.height))).toBe(16);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
});

test("successful website login records the canonical public destination", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  await page.getByLabel("Email or username").fill("fawxzzy");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.locator(".account-auth-dock").getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination"))
    .toBe("https://fawxzzy.com/?signedIn=1");
});

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
  const styleSource = readFileSync(path.resolve("src/styles/page-families/utility.css"), "utf8");
  expect(adapterSource).toContain('/functions/v1/username-password-signin');
  expect(adapterSource).toContain("client.auth.setSession");
  expect(functionConfig).toContain("verify_jwt = false");
  expect(functionSource).toContain('await isAcceptedPublicKey(requestKey)');
  expect(functionSource).toContain('/auth/v1/settings');
  expect(functionSource).toContain('headers: { apikey: candidate }');
  expect(functionSource).not.toContain('Authorization: `Bearer ${requestKey}`');
  expect(functionSource).toContain("resolveUsernameSignInRpc");
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
  expect(styleSource).toContain('input:-webkit-autofill');
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
    "Accept-Profile": "account_private",
    "Content-Profile": "account_private",
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

test("the website sign-in presentation marker expires while an idle tab remains open", async ({ page }) => {
  await page.addInitScript(() => {
    let now = 1_000;
    Date.now = () => now;
    Object.defineProperty(window, "__advanceDisplayClock", {
      value: (milliseconds: number) => { now += milliseconds; },
    });
  });
  await page.goto("/?signedIn=1");
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await page.evaluate(() => {
    (window as typeof window & { __advanceDisplayClock(milliseconds: number): void })
      .__advanceDisplayClock(5 * 60 * 1000 + 1);
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("recovery exchanges PKCE before exposing the password form", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/reset-password?auth_test=error");
  await page.getByLabel("Email").fill("private@example.test");
  await page.getByRole("button", { name: "Send recovery link" }).click();
  await expect(page.getByRole("status")).toContainText(safeAuthSuccess("reset-request"));
  await expect(page.getByRole("button")).toBeDisabled();

  await page.goto("/reset-password?recovery=1&auth_test=pending&code=pending-code");
  await expect(page.locator(".account-auth-dock button")).toHaveText("Preparing recovery…");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);

  await page.goto("/reset-password?recovery=1&auth_test=error&code=failed-code");
  await expect(page.locator('.account-auth-live-notice[role="alert"]')).toContainText(
    safeAuthError("reset-complete"),
  );
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/reset-password\?recovery=1$/);

  await page.goto("/reset-password?recovery=1&auth_test=success&token=blocked");
  await expect(page.locator(".account-auth-dock button")).toHaveText("Recovery link invalid.");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/reset-password\?recovery=1$/);

  await page.goto("/reset-password?recovery=1&auth_test=success");
  await expect(page.locator(".account-auth-dock button")).toHaveText("Recovery link expired.");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);

  await page.goto("/reset-password?recovery=1&auth_test=success&code=one-time-code");
  await expect(page).toHaveURL(/\/reset-password\?recovery=1$/);
  const password = "x".repeat(129);
  const submit = page.locator('.account-auth-dock button[type="submit"]');
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill("y".repeat(129));
  await submit.click();
  await expect(page.getByLabel("Confirm password")).toHaveAttribute("aria-invalid", "true");
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveText("Save new password");

  await page.getByLabel("Confirm password").fill(password);
  await submit.click();
  await expect(page.getByRole("status")).toContainText("password has been updated");

  await page.goto("/reset-password?recovery=1&auth_test=session");
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
});

test("confirmation is one-time, sanitized, and preserves only an approved return", async ({ page }) => {
  await page.goto(
    "/auth/confirm?auth_test=success&token_hash=private-hash&type=signup&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
  );
  await expect(page.getByRole("status")).toContainText("Confirmation complete.");
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  await expect(page.getByRole("link", { name: "Continue safely" })).toHaveAttribute(
    "href",
    "https://fitness.fawxzzy.com/",
  );
});

test("confirmation fallback actions preserve the selected product context", async ({ page }) => {
  await page.goto("/auth/confirm?app=mazer");
  await expect(page.locator('[data-auth-product="mazer"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Start again" })).toHaveAttribute(
    "href",
    "/login?app=mazer",
  );
});

test("callback validates state, exchanges once, and never retains token material", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "expected-state"), accountContract.callbackStateKey);
  const callback =
    "/auth/callback?auth_test=success&code=one-time-code&state=expected-state&returnTo=%2Faccount";
  await page.goto(callback);
  await expect(page.getByRole("status")).toContainText("Sign-in handoff complete.");
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page.getByRole("link", { name: "Continue safely" })).toHaveAttribute(
    "href",
    "/account",
  );

  await page.goto(callback);
  await expect(page.getByRole("status")).toContainText("This sign-in handoff was already completed.");
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page).toHaveURL(/\/account$/, { timeout: 4_000 });

  await page.goto("/auth/callback?auth_test=success#access_token=secret&refresh_token=secret");
  await expect(page.locator('[data-auth-state="invalid"] [role="alert"]')).toContainText(
    "missing a valid authorization handoff",
  );
  await expect(page).toHaveURL(/\/auth\/callback$/);
});

test("callback rejects a mismatched state without an exchange", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "expected"), accountContract.callbackStateKey);
  await page.goto("/auth/callback?auth_test=success&code=code&state=wrong");
  await expect(page.locator('[data-auth-state="unauthorized"] [role="alert"]')).toContainText(
    "does not match the browser",
  );
  await expect(page.getByRole("link", { name: "Start again" })).toHaveAttribute("href", "/login");
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(/\/auth\/callback$/);
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
    await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("account routes fit an iPhone-class viewport and expose visible focus states", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route] of accountRoutes) {
    await page.goto(route);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      minimumTargetHeight: Math.min(
        ...[...document.querySelectorAll<HTMLElement>(
          ".site-nav a, .account-utility-nav a, .account-card button, .account-card input, .account-card a",
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
