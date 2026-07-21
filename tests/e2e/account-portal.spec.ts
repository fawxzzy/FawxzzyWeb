import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  accountContract,
  accountUrls,
  classifyRuntimeOrigin,
  isLiveAccountAdapterOrigin,
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
  nonHumanAccountSurfaces,
  normalizeServiceRegistrationReadModel,
  resolveServiceRegistrationPresentation,
  serviceRegistrationDispositions,
  sourceOnlyServiceRegistrationCapability,
} from "../../src/lib/account/service-registration";
import { apps } from "../../src/data/apps";

const accountRoutes = [
  ["/login", "Sign in | Fawxzzy"],
  ["/account", "Account | Fawxzzy"],
  ["/auth/confirm", "Confirm account | Fawxzzy"],
  ["/auth/callback", "Account handoff | Fawxzzy"],
  ["/reset-password", "Reset password | Fawxzzy"],
] as const;

const utilityRoutes = accountRoutes.filter(([route]) => route !== "/account");

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
  expect(nonHumanAccountSurfaces).toEqual([
    expect.objectContaining({ id: "discordos" }),
  ]);
  expect(humanAccountServices.some((service) => service.id === ("discordos" as never))).toBe(
    false,
  );
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
        { disposition: "active", serviceId: "discordos" },
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
      await expect(page.locator('.account-state-card[data-auth-state="error"]')).toBeVisible();
      await expect(page.locator('[data-auth-state="setup-pending"]')).toHaveCount(0);
    } else {
      await expect(page.locator('[data-auth-state="setup-pending"]')).toBeVisible();
    }
    await expect(page.locator("body")).not.toContainText("FawxzzyWeb");
    if (route === "/account") {
      await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText("Account");
    } else {
      await expect(page.getByRole("navigation", { name: "Account" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    }
  }
});

test("utility Auth routes use one focused task shell", async ({ page }) => {
  for (const [route] of utilityRoutes) {
    await page.goto(route);
    const navigation = page.getByRole("navigation", { name: "Account" });
    await expect(navigation.getByRole("link", { name: "Fawxzzy home" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(navigation.getByRole("link", { name: "Back to site" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.locator(".account-utility-layout > .account-card")).toHaveCount(1);
    await expect(page.locator(".account-hero--utility")).toBeVisible();
  }
});

test("utility forms preserve password-manager and autofill semantics", async ({ page }) => {
  await page.goto("/login?auth_test=success");
  const loginForm = page.locator("form");
  await expect(loginForm.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  await expect(loginForm.getByLabel("Password")).toHaveAttribute(
    "autocomplete",
    "current-password",
  );

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(loginForm.getByLabel("Password")).toHaveAttribute(
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
        minimumNavigationTarget: Math.min(
          ...[...document.querySelectorAll<HTMLElement>(".account-utility-nav a")].map(
            (element) => Math.round(element.getBoundingClientRect().height),
          ),
        ),
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.scrollWidth, `${route} at ${width}px`).toBeLessThanOrEqual(
        geometry.clientWidth,
      );
      expect(geometry.minimumNavigationTarget, `${route} utility navigation`).toBeGreaterThanOrEqual(
        44,
      );
    }
  }
});

test("public navigation stays focused on apps, discovery, and the owned archive", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation.getByRole("link", { name: "Apps", exact: true })).toHaveAttribute(
    "href",
    "/apps",
  );
  await expect(navigation.getByRole("link", { name: "Discover", exact: true })).toHaveAttribute(
    "href",
    "/discover",
  );
  await expect(navigation.getByRole("link", { name: "Newsletter", exact: true })).toHaveAttribute(
    "href",
    "/newsletter",
  );
  await expect(navigation).not.toContainText("Account");
});

test("login accepts a legacy short password and maps adapter errors safely", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=success");
  const form = page.locator("form");
  await form.getByLabel("Email").fill("legacy@example.test");
  await form.getByLabel("Password").fill("short");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in on this account origin");
  await expect(form.getByRole("button")).toBeDisabled();

  await page.goto("/login?auth_test=error");
  await page.locator("form").getByLabel("Email").fill("unknown@example.test");
  await page.locator("form").getByLabel("Password").fill("short");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(safeAuthError("login"));
});

test("signup enforces ten characters and accepts long passwords", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=success");
  await page.getByRole("button", { name: "Create account" }).click();
  const form = page.locator("form");
  await expect(form.getByLabel("Password")).toHaveAttribute("minlength", "10");
  await form.getByLabel("Email").fill("new@example.test");
  await form.getByLabel("Password").fill("x".repeat(129));
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("account request is complete");
});

test("signup validation stops before the provider call", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/login?auth_test=signup-existing");
  await page.getByRole("button", { name: "Create account" }).click();
  const form = page.locator("form");
  const password = form.getByLabel("Password");
  const submit = form.getByRole("button", { name: "Create account" });
  await form.getByLabel("Email").fill("existing@example.test");
  await password.fill("too-short");
  await submit.click();

  expect(await password.evaluate((input) => input.checkValidity())).toBe(false);
  await expect(page.locator('.account-notice[role="status"]')).toHaveCount(0);
  await expect(page.locator('.account-notice[role="alert"]')).toHaveCount(0);
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
    const submit = form.locator('button[type="submit"]');
    await form.getByLabel("Email").fill(`${scenario}@example.test`);
    await form.getByLabel("Password").fill("long-enough-password");
    await submit.click();

    await expect(submit).toHaveText(/^Working/);
    await expect(submit).toBeDisabled();
    const notice = page.locator('.account-notice[role="status"]');
    await expect(notice).toHaveText(expectedNotice);
    await expect(notice).toHaveClass(/account-notice--success/);
    await expect(page.locator('.account-notice[role="alert"]')).toHaveCount(0);
    await expect(submit).toHaveText(/Try again in [1-5]s/);
    await expect(submit).toBeDisabled();
    if (diagnostic) await expect(page.locator("body")).not.toContainText(diagnostic);
  }

  expect(await context.cookies()).toEqual([]);
});

test("account settings stay session-scoped and username remains capability-gated", async ({
  browserName,
  context,
  page,
}) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/account?auth_test=session");
  await expect(page.getByText("preview.user@example.test")).toBeVisible();
  await expect(page.locator('[data-username-capability="gated"] button')).toBeDisabled();
  await expect(page.locator('[data-user-number-capability="gated"] button')).toBeDisabled();
  await expect(page.locator('[data-user-number-state="unavailable"]')).toHaveText(
    "User number unavailable",
  );
  await expect(page.locator('input[name="username"], input[name="user_number"]')).toHaveCount(0);
  expect(await context.cookies()).toEqual([]);

  const emailForm = page.locator("form").filter({ has: page.getByLabel("Update email") });
  await expect(emailForm.getByLabel("Current password")).toHaveAttribute("required", "");
  await emailForm.getByLabel("Update email").fill("changed@example.test");
  await emailForm.getByLabel("Current password").fill("current-account-password");
  await emailForm.getByRole("button", { name: "Save email" }).click();
  await expect(page.getByRole("status")).toContainText("email update was accepted");

  const passwordForm = page.locator("form").filter({ has: page.getByLabel("New password") });
  await expect(passwordForm.getByLabel("Current password")).toHaveAttribute("required", "");
  await passwordForm.getByLabel("Current password").fill("current-account-password");
  await passwordForm.getByLabel("New password").fill("x".repeat(129));
  await passwordForm.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("status")).toContainText("password has been updated");

  await page.getByRole("button", { name: "Sign out here" }).click();
  await expect(page.getByText("You are not signed in on this origin.")).toBeVisible();
});

test("service cards render every local-only disposition without enabling client activation", async ({
  context,
  page,
}) => {
  const scenarios = [
    ["unavailable", "unavailable"],
    ["not-registered", "not_registered"],
    ["active", "active"],
    ["action-required", "action_required"],
    ["unknown", "unknown"],
  ] as const;

  for (const [scenario, disposition] of scenarios) {
    await page.goto(`/account?auth_test=session&services_test=${scenario}`);
    for (const service of humanAccountServices) {
      const card = page.locator(`[data-service-id="${service.id}"]`);
      await expect(card).toHaveAttribute("data-service-disposition", disposition);
      await expect(card.locator('[data-service-activation="gated"]')).toBeDisabled();
      await expect(card.locator("a")).toHaveAttribute("href", service.currentDestination);
      await expect(card.locator("[data-service-canonical]")).toHaveAttribute(
        "data-service-canonical",
        service.canonicalDestination,
      );
    }
    await expect(page.getByText("DiscordOS", { exact: true })).toHaveCount(0);
  }

  expect(await context.cookies()).toEqual([]);
  expect(new URL(page.url()).searchParams.has("access_token")).toBe(false);
  expect(new URL(page.url()).searchParams.has("refresh_token")).toBe(false);
});

test("default account presentation does not claim service registration without readback", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page.locator('[data-service-capability="unavailable"]')).toBeVisible();
  await expect(page.locator('[data-service-disposition="unavailable"]')).toHaveCount(2);
  await expect(page.locator('[data-service-disposition="active"]')).toHaveCount(0);
});

test("recovery exchanges PKCE before exposing the password form", async ({ browserName, page }) => {
  test.slow(browserName === "webkit", "Mobile WebKit needs a longer native actionability budget.");
  await page.goto("/reset-password?auth_test=error");
  await page.getByLabel("Email").fill("private@example.test");
  await page.getByRole("button", { name: "Send recovery link" }).click();
  await expect(page.getByRole("status")).toHaveText(safeAuthSuccess("reset-request"));
  await expect(page.getByRole("button")).toBeDisabled();

  await page.goto("/reset-password?recovery=1&auth_test=pending&code=pending-code");
  await expect(page.getByText("Establishing your recovery session…")).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);

  await page.goto("/reset-password?recovery=1&auth_test=error&code=failed-code");
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(
    safeAuthError("reset-complete"),
  );
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/reset-password\?recovery=1$/);

  await page.goto("/reset-password?recovery=1&auth_test=success");
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(
    safeAuthError("reset-complete"),
  );
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);

  await page.goto("/reset-password?recovery=1&auth_test=success&code=one-time-code");
  await expect(page.getByRole("status")).toContainText("Recovery session established");
  await expect(page).toHaveURL(/\/reset-password\?recovery=1$/);
  const password = "x".repeat(129);
  const submit = page.locator('form button[type="submit"]');
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password").fill("y".repeat(129));
  await submit.click();
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(
    "The passwords do not match.",
  );
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveText("Save new password");

  await page.getByLabel("Confirm new password").fill(password);
  await submit.click();
  await expect(page.getByRole("status")).toContainText("password has been updated");

  await page.goto("/reset-password?recovery=1&auth_test=session");
  await expect(page.getByRole("status")).toContainText("Recovery session established");
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
});

test("confirmation is one-time, sanitized, and preserves only an approved return", async ({ page }) => {
  await page.goto(
    "/auth/confirm?auth_test=success&token_hash=private-hash&type=signup&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
  );
  await expect(page.getByRole("status")).toHaveText("Confirmation complete.");
  await expect(page).toHaveURL(/\/auth\/confirm$/);
  await expect(page.getByRole("link", { name: "Continue safely" })).toHaveAttribute(
    "href",
    "https://fitness.fawxzzy.com/",
  );
});

test("callback validates state, exchanges once, and never retains token material", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "expected-state"), accountContract.callbackStateKey);
  const callback =
    "/auth/callback?auth_test=success&code=one-time-code&state=expected-state&returnTo=%2Faccount";
  await page.goto(callback);
  await expect(page.getByRole("status")).toHaveText("Sign-in handoff complete.");
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page.getByRole("link", { name: "Continue safely" })).toHaveAttribute(
    "href",
    "/account",
  );

  await page.goto(callback);
  await expect(page.getByRole("status")).toHaveText("This sign-in handoff was already completed.");
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page).toHaveURL(/\/account$/, { timeout: 4_000 });

  await page.goto("/auth/callback?auth_test=success#access_token=secret&refresh_token=secret");
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(
    safeAuthError("callback"),
  );
  await expect(page).toHaveURL(/\/auth\/callback$/);
});

test("callback rejects a mismatched state without an exchange", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => window.sessionStorage.setItem(key, "expected"), accountContract.callbackStateKey);
  await page.goto("/auth/callback?auth_test=success&code=code&state=wrong");
  await expect(page.locator('.account-notice[role="alert"]')).toHaveText(
    safeAuthError("callback"),
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
