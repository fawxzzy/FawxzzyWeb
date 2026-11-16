import { expect, test } from "@playwright/test";
import {
  createAuthGenerationCoordinator,
  createFitnessCommitFencedStorage,
  persistVerifiedFitnessSession,
  resolveBrowserAuthStorage,
  resolvePortalAuthAdapter,
} from "../../src/lib/auth/browser-adapter";
import {
  completeFitnessHandoff, fitnessHandoffRuntimeReady, fitnessReturnPath,
  FITNESS_HANDOFF_ACTIVATION, FITNESS_HANDOFF_MASTER_PROJECT_REF,
  FITNESS_HANDOFF_READINESS_CONTRACT_VERSION, FITNESS_HANDOFF_UNAVAILABLE,
} from "../../src/lib/auth/fitness-handoff";
import { accountExperienceContexts } from "../../src/config/account";
import { sanitizePostAuthReturnTarget, sanitizeReturnTarget } from "../../src/config/account-return";
import { parseConfirmPayload, sanitizeLinkDestination } from "../../src/lib/auth/callback-contract";

const id = "a".repeat(43);
const origin = "https://fitness.fawxzzy.com";
const droppedFitnessMerge = "389d4d21aa79725ba6cd716dcc84d7aa917ada3e";
const droppedRetainedRollbackFitnessMerge = "5a9ba02e2b950285342fb189d680564ce5cdc489";
const usernameReleaseFitnessMerge = "dbb63556d8b01b383dd61d326ce551635cb8b4d8";
const legacyRetirementFitnessMerge = "0467722373da14760779392d94a212e3f10aac92";
const passwordPolicyFitnessMerge = "c086111c4ca3374c6f0c6d57f5e090b22cb57063";
const loginAutofillFitnessMerge = "06db3f234ee0b90c00b32507351fe1d902661bdf";
const sessionAtomicityFitnessMerge = "2a47cd4b6b1bfb70d6d2b5b913e9f917acc4716e";
const boardRefreshFitnessMerge = "76f04dfcd66c6ebbdbbb6a65a8d516accdd6b2e3";
const releaseNov13FitnessMerge = "529eb6c4b01706521bb4f1f2708c583030118fa7";
const releaseNov13bFitnessMerge = "bca97957aea3b856caff87dde99ebc959cce6c43";
const releaseNov13cFitnessMerge = "d6a625c4b78786b56564b5d29497050fa96183ae";
const releaseNov14FitnessMerge = "c48235cb31b1289faafa5b734848bf4d821ff3d1";
const releaseNov15FitnessMerge = "3db7fe30cb397b83042950f3ef642c930a8e0b8b";
const releaseNov15bFitnessMerge = "d335131a8602206c5c7702ac7fd3399c26c43f35";
const releaseNov15cFitnessMerge = "9979e22faa639d4fb60d915e4a02fefded823dc3";
const releaseNov15dFitnessMerge = "b761e6527e72bbfe34386cfe49e49674610ccfec";
const releaseNov16FitnessMerge = "1ebbd945312b6d48bfbb46fad28c3134767b932c";
const releaseNov16bFitnessMerge = "02917bfb0612dce212d3aa55e0f338c0b0e6d57d";
const acceptedFitnessMerges = [
  releaseNov14FitnessMerge, releaseNov15FitnessMerge, releaseNov15bFitnessMerge, releaseNov15cFitnessMerge, releaseNov15dFitnessMerge, releaseNov16FitnessMerge, releaseNov16bFitnessMerge] as const;
const legacyFitnessMerge = "f87f2dc7e0cc3cbead0eb3ea5ed7b9c592fdfa94";
const pair = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" };
const rotatedPair = { accessToken: "rotated-access", refreshToken: "rotated-refresh" };
const readiness = {
  authProjectRef: FITNESS_HANDOFF_MASTER_PROJECT_REF,
  contractVersion: FITNESS_HANDOFF_READINESS_CONTRACT_VERSION,
  handoffStore: "available",
  sourceCommit: releaseNov16bFitnessMerge,
};
const begin = { ok: true, handoffId: id, readiness, returnTo: "/today" };
const end = { ok: true, returnTo: "/today", session: rotatedPair };
const persistSession = async () => undefined;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

function fixture(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const response = responses.shift();
    if (!response) throw new Error("Fixture must not make another request");
    return response;
  }) as typeof fetch;
  return { calls, request };
}

test("Fitness handoff activates only on the canonical account runtime with exact evidence", () => {
  expect(FITNESS_HANDOFF_ACTIVATION.fitnessConsumerMerges)
    .toEqual(acceptedFitnessMerges);
  expect(fitnessHandoffRuntimeReady("https://account.fawxzzy.com")).toBe(true);
  for (const runtimeOrigin of [
    "http://127.0.0.1:3210",
    "https://fawxzzyweb-preview.vercel.app",
    "https://evil.test",
    "not a URL",
  ]) {
    expect(fitnessHandoffRuntimeReady(runtimeOrigin)).toBe(false);
  }

  for (const activation of [
    { ...FITNESS_HANDOFF_ACTIVATION, state: "inactive" as const },
    { ...FITNESS_HANDOFF_ACTIVATION, fitnessConsumerMerges: ["invalid", loginAutofillFitnessMerge, sessionAtomicityFitnessMerge, boardRefreshFitnessMerge, releaseNov13bFitnessMerge, releaseNov13cFitnessMerge, releaseNov14FitnessMerge] as const },
    { ...FITNESS_HANDOFF_ACTIVATION, fitnessConsumerMerges: [usernameReleaseFitnessMerge, usernameReleaseFitnessMerge, legacyRetirementFitnessMerge, passwordPolicyFitnessMerge, loginAutofillFitnessMerge, sessionAtomicityFitnessMerge, boardRefreshFitnessMerge] as const },
    { ...FITNESS_HANDOFF_ACTIVATION, fitnessConsumerMerges: [usernameReleaseFitnessMerge, legacyRetirementFitnessMerge] as unknown as typeof acceptedFitnessMerges },
    { ...FITNESS_HANDOFF_ACTIVATION, fitnessConsumerMerges: acceptedFitnessMerges.slice(0, 6) as unknown as typeof acceptedFitnessMerges },
    { ...FITNESS_HANDOFF_ACTIVATION, fitnessConsumerMerges: [...acceptedFitnessMerges, "a".repeat(40)] as unknown as typeof acceptedFitnessMerges },
  ]) {
    expect(fitnessHandoffRuntimeReady("https://account.fawxzzy.com", activation)).toBe(false);
  }
});

test("Fitness release binding accepts all transition sources and rejects every unlisted merge before token read", async () => {
  for (const sourceCommit of acceptedFitnessMerges) {
    let reads = 0;
    const accepted = fixture([json({
      ...begin,
      readiness: { ...readiness, sourceCommit },
    }), json(end)]);
    await expect(completeFitnessHandoff("/today", {
      enabled: true,
      persistSession,
      request: accepted.request,
      readSession: async () => { reads += 1; return pair; },
    })).resolves.toBe(`${origin}/today`);
    expect(reads).toBe(1);
    expect(accepted.calls).toHaveLength(2);
  }

  for (const sourceCommit of [sessionAtomicityFitnessMerge, boardRefreshFitnessMerge, legacyFitnessMerge, "0".repeat(40), "a".repeat(40),
    "6ab6c782e239b50a8adf00cc65e553f679c8abda", releaseNov13FitnessMerge, loginAutofillFitnessMerge, "8070196cd3f5efbe2faf7fe8719971cf2ebd1e39", "dbbe305fc511633166c1a65396fdf9ef6a1c79f1", droppedFitnessMerge, droppedRetainedRollbackFitnessMerge, releaseNov13bFitnessMerge, releaseNov13cFitnessMerge, usernameReleaseFitnessMerge, legacyRetirementFitnessMerge, passwordPolicyFitnessMerge, legacyRetirementFitnessMerge.toUpperCase(), usernameReleaseFitnessMerge.toUpperCase(),
    ` ${usernameReleaseFitnessMerge}`, usernameReleaseFitnessMerge.slice(0, 7),
    passwordPolicyFitnessMerge.toUpperCase(), passwordPolicyFitnessMerge.slice(0, 7),
    loginAutofillFitnessMerge.toUpperCase(), loginAutofillFitnessMerge.slice(0, 7),
    sessionAtomicityFitnessMerge.toUpperCase(), sessionAtomicityFitnessMerge.slice(0, 7),
    boardRefreshFitnessMerge.toUpperCase(), boardRefreshFitnessMerge.slice(0, 7),
    releaseNov13FitnessMerge.toUpperCase(), releaseNov13FitnessMerge.slice(0, 7),
    releaseNov13bFitnessMerge.toUpperCase(), releaseNov13bFitnessMerge.slice(0, 7),
    releaseNov13cFitnessMerge.toUpperCase(), releaseNov13cFitnessMerge.slice(0, 7),
    releaseNov14FitnessMerge.toUpperCase(), releaseNov14FitnessMerge.slice(0, 7),
    releaseNov15FitnessMerge.toUpperCase(), releaseNov15FitnessMerge.slice(0, 7),
    releaseNov15bFitnessMerge.toUpperCase(), releaseNov15bFitnessMerge.slice(0, 7),
    releaseNov15cFitnessMerge.toUpperCase(), releaseNov15cFitnessMerge.slice(0, 7),
    releaseNov15dFitnessMerge.toUpperCase(), releaseNov15dFitnessMerge.slice(0, 7),
    releaseNov16FitnessMerge.toUpperCase(), releaseNov16FitnessMerge.slice(0, 7),
    releaseNov16bFitnessMerge.toUpperCase(), releaseNov16bFitnessMerge.slice(0, 7)]) {
    let reads = 0;
    const rejected = fixture([json({
      ...begin,
      readiness: { ...readiness, sourceCommit },
    })]);
    await expect(completeFitnessHandoff("/today", {
      enabled: true,
      persistSession,
      request: rejected.request,
      readSession: async () => { reads += 1; return pair; },
    })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
    expect(reads).toBe(0);
    expect(rejected.calls).toHaveLength(1);
  }
});

test("inactive Fitness handoff fails before any credential read or request", async () => {
  let reads = 0;
  const f = fixture([]);
  await expect(completeFitnessHandoff("/today", {
    enabled: false, persistSession, request: f.request,
    readSession: async () => { reads++; return pair; },
  })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(reads).toBe(0);
  expect(f.calls).toHaveLength(0);
});

test("begin binding precedes pair retrieval and consume precedes returned navigation", async () => {
  const f = fixture([json(begin), json(end)]);
  let persisted: typeof rotatedPair | null = null;
  const destination = await completeFitnessHandoff(`${origin}/today`, {
    enabled: true, request: f.request,
    persistSession: async (session) => {
      expect(f.calls).toHaveLength(2);
      persisted = session;
    },
    readSession: async () => { expect(f.calls).toHaveLength(1); return pair; },
  });
  expect(destination).toBe(`${origin}/today`);
  expect(persisted).toEqual(rotatedPair);
  expect(f.calls.map((call) => call.url)).toEqual([
    `${origin}/auth/session-handoff`, `${origin}/auth/session-sync`,
  ]);
  expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ returnTo: "/today" });
  expect(JSON.parse(f.calls[1].init.body as string)).toEqual({ handoffId: id, ...pair });
  for (const { url, init } of f.calls) {
    expect(init).toMatchObject({
      method: "POST", credentials: "include", mode: "cors", cache: "no-store",
      redirect: "error", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(url).not.toMatch(/synthetic|handoffId|[?#]/);
  }
});

for (const target of ["//evil.test", "https://evil.test/", "/login", "/auth/session-recovery",
  "/today?access_token=secret", "/today#fragment", "/today?returnTo=https://evil.test",
  "https://user:pass@fitness.fawxzzy.com/", "/\\evil.test", "/session/abc"]) {
  test(`closed Fitness return path: ${target}`, () => {
    expect(fitnessReturnPath(target)).toBe("/entry");
  });
}

// Fitness PR275 Settings "Account" row: getFitnessAccountPortalUrl("/account", "/settings") sends the
// absolute Fitness URL. The portal accepts it as a return target (never the `/account` rejection), but
// the handoff path set stays `/`, `/entry`, `/today` on both sides, so a handoff lands on `/entry`.
// Adding `/settings` needs Fitness's ALLOWED_RETURN_PATHS first, or the echoed returnTo stops matching.
const fitnessSettingsReturn = `${origin}/settings`;
const fitnessSettingsAccountUrl =
  `https://account.fawxzzy.com/account?app=fitness&returnTo=${encodeURIComponent(fitnessSettingsReturn)}`;

test("Fitness Settings returnTo is an accepted portal target that hands off to /entry", () => {
  const fitness = accountExperienceContexts.fitness;
  const returnTo = new URL(fitnessSettingsAccountUrl).searchParams.get("returnTo");
  expect(returnTo).toBe(fitnessSettingsReturn);
  expect(sanitizeReturnTarget(returnTo)).toBe(fitnessSettingsReturn);
  expect(sanitizePostAuthReturnTarget(returnTo, fitness)).toBe(fitnessSettingsReturn);
  expect(sanitizeLinkDestination(fitnessSettingsReturn)).toBe(fitnessSettingsReturn);
  expect(fitnessReturnPath(fitnessSettingsReturn)).toBe("/entry");
  expect(parseConfirmPayload(new URL(
    `https://account.fawxzzy.com/auth/confirm?app=fitness&token_hash=h&type=signup&returnTo=${encodeURIComponent(fitnessSettingsReturn)}`,
  ))?.returnTo).toBe(fitnessSettingsReturn);
  // The bare path is not a portal return target: the Fitness context falls back to the product root.
  expect(sanitizeReturnTarget("/settings")).toBe("/account");
  expect(sanitizePostAuthReturnTarget("/settings", fitness)).toBe(`${origin}/`);
  expect(fitnessReturnPath("/settings")).toBe("/entry");
});

for (const hostile of ["//evil.com", "//evil.com/settings", "/\\evil.com", "/\\evil.com/settings",
  "https://evil.com/settings", "https://fitness.fawxzzy.com.evil.com/settings",
  "http://fitness.fawxzzy.com/settings", "https://user:pass@fitness.fawxzzy.com/settings",
  `${origin}/settings#access_token=secret`, `${origin}/settings?token=secret`,
  "javascript:alert(1)", "JaVaScRiPt:alert(1)//fitness.fawxzzy.com/settings",
  "data:text/html,<script>alert(1)</script>"]) {
  test(`hostile Fitness Settings returnTo stays closed: ${hostile}`, () => {
    const fitness = accountExperienceContexts.fitness;
    expect(sanitizeReturnTarget(hostile)).toBe("/account");
    expect(sanitizePostAuthReturnTarget(hostile, fitness)).toBe(`${origin}/`);
    expect(sanitizeLinkDestination(hostile)).toBe("/account");
    expect(fitnessReturnPath(hostile)).toBe("/entry");
  });
}

test("signed-in Account page opened from Fitness Settings renders for Fitness without redirecting", async ({ page }) => {
  const target = `/account?app=fitness&auth_test=session&returnTo=${encodeURIComponent(fitnessSettingsReturn)}`;
  await page.goto(target);
  await expect(page.locator('[data-auth-product="fitness"]').first()).toBeVisible();
  await expect(page.locator('[data-auth-field-action="username"]')).toHaveCount(1);
  expect(new URL(page.url()).pathname).toBe("/account");
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(fitnessSettingsReturn);
});

test("Fitness Settings returnTo through portal sign-in hands off to the closed /entry landing", async ({ page }) => {
  const outgoing: string[] = [];
  await page.route("https://fitness.fawxzzy.com/**", async (route) => {
    outgoing.push(route.request().url());
    await route.abort();
  });
  await page.goto(`/login?app=fitness&auth_test=success&returnTo=${encodeURIComponent(fitnessSettingsReturn)}`);
  await page.getByLabel("Email or username").fill("fixture.user");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.locator(".auth-dock__button").click();
  await expect.poll(() => page.locator("html").getAttribute("data-post-auth-destination"))
    .toBe(`${origin}/entry`);
  expect(outgoing).toEqual([]);
});

for (const response of [
  null, [], { ...begin, ok: false }, { ...begin, handoffId: "short" },
  { ...begin, handoffId: "/".repeat(43) }, { ...begin, returnTo: "https://evil.test" },
  { ...begin, returnTo: "/entry" }, { ...begin, accessToken: "must-not-echo" },
  { ...begin, readiness: null },
  { ...begin, readiness: { ...readiness, authProjectRef: "legacy-project" } },
  { ...begin, readiness: { ...readiness, contractVersion: "legacy-contract" } },
  { ...begin, readiness: { ...readiness, handoffStore: "unavailable" } },
  { ...begin, readiness: { ...readiness, sourceCommit: "0".repeat(40) } },
  { ...begin, readiness: { ...readiness, extra: "must-not-accept" } },
]) {
  test(`malformed begin is terminal ${JSON.stringify(response)}`, async () => {
    const f = fixture([json(response)]);
    let reads = 0;
    await expect(completeFitnessHandoff("/today", {
      enabled: true, persistSession, request: f.request,
      readSession: async () => { reads++; return pair; },
    })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
    expect(f.calls).toHaveLength(1);
    expect(reads).toBe(0);
  });
}

for (const status of [401, 403, 409, 410, 429, 500, 503]) {
  test(`consume ${status} does not retry or echo provider response`, async () => {
    const f = fixture([json(begin), json({ error: "synthetic-access private detail" }, status)]);
    await expect(completeFitnessHandoff("/today", {
      enabled: true, persistSession, request: f.request, readSession: async () => pair,
    })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
    expect(f.calls).toHaveLength(2);
  });
}

for (const response of [null, { ok: false, returnTo: "/today" }, { ok: true, returnTo: "/entry" },
  { ok: true, returnTo: "//evil.test" }, { ...end, session: null },
  { ...end, session: { accessToken: "", refreshToken: "rotated-refresh" } },
  { ...end, session: { ...rotatedPair, extra: "must-not-accept" } },
  { ...end, refreshToken: "must-not-echo" }]) {
  test(`malformed consume cannot supply navigation ${JSON.stringify(response)}`, async () => {
    const f = fixture([json(begin), json(response)]);
    await expect(completeFitnessHandoff("/today", {
      enabled: true, persistSession, request: f.request, readSession: async () => pair,
    })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
    expect(f.calls).toHaveLength(2);
  });
}

test("rotated session persistence must succeed before navigation", async () => {
  const f = fixture([json(begin), json(end)]);
  let persistenceAttempts = 0;
  await expect(completeFitnessHandoff("/today", {
    enabled: true,
    persistSession: async (session) => {
      persistenceAttempts += 1;
      expect(session).toEqual(rotatedPair);
      throw new Error("private persistence detail");
    },
    readSession: async () => pair,
    request: f.request,
  })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(persistenceAttempts).toBe(1);
  expect(f.calls).toHaveLength(2);
});

test("a rotated access session for another user is rejected before storage or subscriber mutation", async () => {
  let storageWrites = 0;
  let subscriberEvents = 0;
  const auth = {
    async getUser() {
      return { data: { user: { id: "wrong-user" } }, error: null };
    },
    async setSession() {
      storageWrites += 1;
      subscriberEvents += 1;
      throw new Error("setSession must not run for a mismatched user");
    },
  };
  await expect(persistVerifiedFitnessSession(auth, rotatedPair, "expected-user"))
    .rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(storageWrites).toBe(0);
  expect(subscriberEvents).toBe(0);
});

test("the portal persists the exact Fitness-rotated pair without creating another refresh lineage", async () => {
  let persisted: { access_token: string; refresh_token: string } | null = null;
  const auth = {
    async getUser() {
      return { data: { user: { id: "expected-user" } }, error: null };
    },
    async setSession(session: { access_token: string; refresh_token: string }) {
      persisted = session;
      return { data: { session: { user: { id: "expected-user" } } }, error: null };
    },
  };
  await expect(persistVerifiedFitnessSession(auth, rotatedPair, "expected-user"))
    .resolves.toBeUndefined();
  expect(persisted).toEqual({
    access_token: rotatedPair.accessToken,
    refresh_token: rotatedPair.refreshToken,
  });
});

test("an invalidated handoff cannot commit a delayed Fitness response or navigate", async () => {
  let current = true;
  let consumeStarted = false;
  let releaseConsume!: (response: Response) => void;
  let writes = 0;
  const delayedConsume = new Promise<Response>((resolve) => { releaseConsume = resolve; });
  const f = fixture([json(begin)]);
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/auth/session-sync")) {
      consumeStarted = true;
      return delayedConsume;
    }
    return f.request(url, init);
  }) as typeof fetch;
  const completion = completeFitnessHandoff("/today", {
    enabled: true,
    isAttemptCurrent: async () => current,
    persistSession: async () => { writes += 1; },
    readSession: async () => pair,
    request,
  });
  await expect.poll(() => consumeStarted).toBe(true);
  current = false;
  releaseConsume(json(end));
  await expect(completion).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(writes).toBe(0);
});

test("local persistence is completion-bound and cannot outlive a handoff timeout", async () => {
  let releasePersist!: () => void;
  let settled = false;
  const persistence = new Promise<void>((resolve) => { releasePersist = resolve; });
  const f = fixture([json(begin), json(end)]);
  const completion = completeFitnessHandoff("/today", {
    enabled: true,
    persistSession: async () => persistence,
    readSession: async () => pair,
    request: f.request,
  }).finally(() => { settled = true; });
  await expect.poll(() => f.calls.length).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(settled).toBe(false);
  releasePersist();
  await expect(completion).resolves.toBe(`${origin}/today`);
});

test("an Auth epoch change fences the delayed SDK storage commit itself", async () => {
  let current = true;
  let releaseSdkLookup!: () => void;
  const sdkLookup = new Promise<void>((resolve) => { releaseSdkLookup = resolve; });
  const stored = new Map<string, string>();
  const writes: string[] = [];
  const fence = createFitnessCommitFencedStorage({
    getItem: (key) => stored.get(key) ?? null,
    removeItem: (key) => { stored.delete(key); },
    setItem: (key, value) => { writes.push(value); stored.set(key, value); },
  });
  const auth = {
    async getUser() {
      return { data: { user: { id: "expected-user" } }, error: null };
    },
    async setSession(session: { access_token: string; refresh_token: string }) {
      await sdkLookup;
      await fence.storage.setItem("session", JSON.stringify(session));
      return { data: { session: { user: { id: "expected-user" } } }, error: null };
    },
  };
  const persistence = fence.run(rotatedPair.accessToken, () => current, () =>
    persistVerifiedFitnessSession(auth, rotatedPair, "expected-user", () => current));
  await new Promise((resolve) => setTimeout(resolve, 0));
  current = false;
  releaseSdkLookup();
  await expect(persistence).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(writes).toEqual([]);
  expect(stored.size).toBe(0);
});

test("a two-tab Auth generation change fences the final shared session write", async () => {
  const stored = new Map<string, string>();
  const sessionWrites: string[] = [];
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    removeItem: (key: string) => { stored.delete(key); },
    setItem: (key: string, value: string) => {
      if (key === "session") sessionWrites.push(value);
      stored.set(key, value);
    },
  };
  let generation = 0;
  const nextGeneration = () => (++generation).toString(16).padStart(64, "0");
  const firstTab = createAuthGenerationCoordinator(storage, true, nextGeneration);
  const secondTab = createAuthGenerationCoordinator(storage, true, nextGeneration);
  const startingGeneration = firstTab.current();
  const fence = createFitnessCommitFencedStorage(storage);
  let releaseSdkLookup!: () => void;
  const sdkLookup = new Promise<void>((resolve) => { releaseSdkLookup = resolve; });
  const auth = {
    async getUser() {
      return { data: { user: { id: "expected-user" } }, error: null };
    },
    async setSession(session: { access_token: string; refresh_token: string }) {
      await sdkLookup;
      fence.storage.setItem("session", JSON.stringify(session));
      return { data: { session: { user: { id: "expected-user" } } }, error: null };
    },
  };
  const persistence = fence.run(
    rotatedPair.accessToken,
    () => firstTab.matches(startingGeneration),
    () => persistVerifiedFitnessSession(
      auth,
      rotatedPair,
      "expected-user",
      () => firstTab.matches(startingGeneration),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  secondTab.advance();
  releaseSdkLookup();
  await expect(persistence).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(sessionWrites).toEqual([]);
});

test("the storage fence performs its final epoch comparison synchronously", async () => {
  let current = true;
  let writes = 0;
  const fence = createFitnessCommitFencedStorage({
    getItem: () => null,
    removeItem: () => undefined,
    setItem: () => { writes += 1; },
  });
  const operation = fence.run(rotatedPair.accessToken, () => current, async () => {
    current = false;
    fence.storage.setItem("session", JSON.stringify({ access_token: rotatedPair.accessToken }));
  });
  await expect(operation).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(writes).toBe(0);
});

test("denied browser storage preserves ordinary Auth fallback and disables handoff persistence", async () => {
  const resolved = resolveBrowserAuthStorage(() => {
    throw new DOMException("Access denied", "SecurityError");
  });
  expect(resolved.durable).toBe(false);
  resolved.storage.setItem("ordinary-auth", "memory-session");
  expect(resolved.storage.getItem("ordinary-auth")).toBe("memory-session");

  let operationCalled = false;
  const fence = createFitnessCommitFencedStorage(resolved.storage, resolved.durable);
  await expect(fence.run(rotatedPair.accessToken, () => true, async () => {
    operationCalled = true;
  })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(operationCalled).toBe(false);
});

test("failed or missing current session never sends consume", async () => {
  for (const readSession of [async () => null, async () => { throw new Error("private detail"); },
    async () => ({ accessToken: "", refreshToken: "synthetic" })]) {
    const f = fixture([json(begin)]);
    await expect(completeFitnessHandoff("/today", {
      enabled: true, persistSession, request: f.request, readSession,
    })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
    expect(f.calls).toHaveLength(1);
  }
});

test("producer matches the consumer token and UTF-8 request-body bounds", async () => {
  for (const oversized of [
    { accessToken: "a".repeat(4097), refreshToken: "r" },
    { accessToken: "a", refreshToken: "r".repeat(4097) },
    { accessToken: "a".repeat(4096), refreshToken: "r".repeat(4096) },
    { accessToken: "\u00e9".repeat(4096), refreshToken: "r" },
  ]) {
    const f = fixture([json(begin)]);
    await expect(completeFitnessHandoff("/today", {
      enabled: true, persistSession, request: f.request, readSession: async () => oversized,
    })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
    expect(f.calls).toHaveLength(1);
  }
  const boundaryPair = { accessToken: "a".repeat(4096), refreshToken: "r" };
  const f = fixture([json(begin), json(end)]);
  await expect(completeFitnessHandoff("/today", {
    enabled: true, persistSession, request: f.request, readSession: async () => boundaryPair,
  })).resolves.toBe(`${origin}/today`);
  expect(JSON.parse(f.calls[1].init.body as string)).toEqual({ handoffId: id, ...boundaryPair });
  expect(new TextEncoder().encode(f.calls[1].init.body as string).byteLength).toBeLessThanOrEqual(8192);
});

test("a contract-valid maximum rotated pair fits the bounded response before persistence", async () => {
  const maximumRotatedPair = {
    accessToken: "a".repeat(4096),
    refreshToken: "r".repeat(4096),
  };
  const f = fixture([json(begin), json({ ...end, session: maximumRotatedPair })]);
  let persisted: typeof maximumRotatedPair | null = null;
  await expect(completeFitnessHandoff("/today", {
    enabled: true,
    persistSession: async (session) => { persisted = session; },
    readSession: async () => pair,
    request: f.request,
  })).resolves.toBe(`${origin}/today`);
  expect(persisted).toEqual(maximumRotatedPair);
});

test("non-JSON, oversized, redirect and network responses fail closed", async () => {
  const redirected = json(begin);
  Object.defineProperty(redirected, "redirected", { value: true });
  for (const response of [new Response("private error"), json("x".repeat(16 * 1024)), redirected]) {
    const f = fixture([response]);
    await expect(completeFitnessHandoff("/today", {
      enabled: true, persistSession, request: f.request, readSession: async () => pair,
    })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
    expect(f.calls).toHaveLength(1);
  }
  let attempts = 0;
  await expect(completeFitnessHandoff("/today", {
    enabled: true, persistSession, readSession: async () => pair,
    request: async () => { attempts++; throw new TypeError("private network detail"); },
  })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(attempts).toBe(1);
});

test("a stalled response hits the deadline with no retry", async () => {
  let signal: AbortSignal | undefined;
  await expect(completeFitnessHandoff("/today", {
    enabled: true, persistSession, readSession: async () => pair,
    request: async (_url, init) => { signal = init!.signal as AbortSignal; return new Promise(() => undefined); },
  })).rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(signal!.aborted).toBe(true);
});

test("failed local handoff preserves the authenticated adapter session", async () => {
  const resolution = resolvePortalAuthAdapter({
    origin: "http://127.0.0.1:3210", search: "?auth_test=fitness-handoff-error",
  });
  expect(resolution.status).toBe("ready");
  if (resolution.status !== "ready") throw new Error("Fixture unavailable");
  const signedIn = await resolution.adapter.signIn("fixture.user", "fixture-password");
  await expect(resolution.adapter.handoffToFitness("/today", signedIn!.userId))
    .rejects.toThrow(FITNESS_HANDOFF_UNAVAILABLE);
  expect(await resolution.adapter.getSession()).toEqual(signedIn);
});

test("portal handoff failure stays on login without external traffic", async ({ page }) => {
  const outgoing: string[] = [];
  await page.route("https://fitness.fawxzzy.com/**", async (route) => {
    outgoing.push(route.request().url());
    await route.abort();
  });
  await page.goto("/login?app=fitness&auth_test=fitness-handoff-error");
  await page.getByLabel("Email or username").fill("fixture.user");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.locator(".auth-dock__button").click();
  // Auth Surface v2: the reason shows once, in the notice slot; the dock keeps saying "Sign in".
  await expect(page.locator('[data-notice-id="signin.callback"][role="alert"]')).toBeVisible();
  await expect(page.locator(".auth-dock__button")).toHaveText("Sign in");
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.locator("html")).not.toHaveAttribute("data-post-auth-destination");
  expect(outgoing).toEqual([]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fawxzzy.account.remembered-identity.v1")))
    .toContain("fixture.user");
});
