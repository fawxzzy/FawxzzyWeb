"use client";

import { createClient, type EmailOtpType, type Session } from "@supabase/supabase-js";
import {
  accountContract,
  accountConfirmUrl,
  accountRecoveryUrl,
  type AccountExperienceContextId,
  isLiveAccountAdapterOrigin,
  isLocalAuthTestOrigin,
} from "@/config/account";
import { isBrowserSafeSupabasePublicKey } from "@/lib/auth/supabase-public-key.mjs";
import {
  completeFitnessHandoff, fitnessReturnPath, FitnessHandoffError,
  fitnessHandoffRuntimeReady,
} from "@/lib/auth/fitness-handoff";

export type PortalSession = {
  displayName: string | null;
  email: string | null;
  userId: string;
};

export type PortalAuthAdapter = {
  kind: "supabase" | "test";
  getSession(): Promise<PortalSession | null>;
  onSessionChange(listener: (session: PortalSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<PortalSession | null>;
  handoffToFitness(returnTarget: string, expectedUserId: string): Promise<string>;
  getOAuthAuthorization(authorizationId: string): Promise<unknown>;
  approveOAuthAuthorization(authorizationId: string): Promise<string>;
  denyOAuthAuthorization(authorizationId: string): Promise<string>;
  signUp(
    email: string,
    password: string,
    username: string,
    contextId: AccountExperienceContextId,
    returnTarget?: string,
  ): Promise<PortalSession | null>;
  signOut(): Promise<void>;
  requestPasswordReset(
    email: string,
    contextId: AccountExperienceContextId,
    returnTarget?: string,
  ): Promise<void>;
  updateEmail(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  confirm(tokenHash: string, type: EmailOtpType): Promise<PortalSession | null>;
  exchangeCode(code: string): Promise<PortalSession | null>;
};

export type AdapterResolution =
  | { status: "ready"; adapter: PortalAuthAdapter }
  | { status: "setup-pending"; reason: string };

type PublicAuthConfig = {
  publishableKey: string;
  url: string;
};

type BrowserAuthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function resolveBrowserAuthStorage(
  readStorage: () => BrowserAuthStorage = () => window.localStorage,
): { durable: boolean; storage: BrowserAuthStorage } {
  const memory = new Map<string, string>();
  const memoryStorage: BrowserAuthStorage = {
    getItem: (key) => memory.get(key) ?? null,
    removeItem: (key) => { memory.delete(key); },
    setItem: (key, value) => { memory.set(key, value); },
  };
  try {
    const storage = readStorage();
    const probeKey = `${accountContract.storageKey}.availability.${Math.random()}`;
    storage.setItem(probeKey, probeKey);
    storage.removeItem(probeKey);
    return { durable: true, storage };
  } catch {
    // Match the Supabase client's browser-storage fallback for ordinary Auth.
    return { durable: false, storage: memoryStorage };
  }
}

export function createFitnessCommitFencedStorage(
  storage: BrowserAuthStorage,
  durable = true,
) {
  let fence: { accessToken: string; isCurrent: () => boolean } | null = null;
  const fencedStorage = {
    getItem: (key: string) => storage.getItem(key),
    removeItem: (key: string) => storage.removeItem(key),
    setItem(key: string, value: string) {
      if (fence) {
        let storedAccessToken: unknown;
        try {
          storedAccessToken = (JSON.parse(value) as { access_token?: unknown }).access_token;
        } catch { /* Non-session SDK values are not Fitness commit candidates. */ }
        // This final epoch comparison and the browser write are deliberately
        // synchronous: no microtask can invalidate the attempt between them.
        if (storedAccessToken === fence.accessToken && !fence.isCurrent()) {
          throw new FitnessHandoffError();
        }
      }
      storage.setItem(key, value);
    },
  };
  return {
    storage: fencedStorage,
    async run<T>(
      accessToken: string,
      isCurrent: () => boolean,
      operation: () => Promise<T>,
    ): Promise<T> {
      if (!durable || fence) throw new FitnessHandoffError();
      fence = { accessToken, isCurrent };
      try {
        return await operation();
      } finally {
        fence = null;
      }
    },
  };
}

type FitnessSessionAuth = {
  getUser(accessToken: string): Promise<{
    data: { user: { id: string } | null };
    error: unknown;
  }>;
  setSession(session: { access_token: string; refresh_token: string }): Promise<{
    data: { session: { user: { id: string } } | null };
    error: unknown;
  }>;
};

export async function persistVerifiedFitnessSession(
  auth: FitnessSessionAuth,
  session: { accessToken: string; refreshToken: string },
  expectedUserId: string,
  canCommit: () => boolean | Promise<boolean> = () => true,
): Promise<void> {
  const accessVerified = await auth.getUser(session.accessToken);
  if (accessVerified.error || accessVerified.data.user?.id !== expectedUserId) {
    throw new FitnessHandoffError();
  }
  if (!await canCommit()) {
    throw new FitnessHandoffError();
  }
  const persisted = await auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (persisted.error || !persisted.data.session ||
    persisted.data.session.user.id !== expectedUserId) {
    throw new FitnessHandoffError();
  }
}

export type PortalAuthAdapterDependencies = {
  createLiveAdapter(url: string, publishableKey: string, runtimeOrigin: string): PortalAuthAdapter;
  readPublicConfig(): PublicAuthConfig | null;
};

let supabaseAdapter: PortalAuthAdapter | null = null;

function toPortalSession(session: Session | null): PortalSession | null {
  if (!session?.user) return null;
  const metadata = session.user.user_metadata;
  const displayName = [metadata?.username, metadata?.display_name]
    .find((candidate) => typeof candidate === "string" && candidate.trim())
    ?.trim() ?? null;
  return { displayName, email: session.user.email ?? null, userId: session.user.id };
}

function createBrowserBoundConfirmationState() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createAuthGenerationCoordinator(
  storage: BrowserAuthStorage,
  durable = true,
  createGeneration: () => string = createBrowserBoundConfirmationState,
) {
  const read = () => {
    if (!durable) return null;
    try {
      const value = storage.getItem(accountContract.authGenerationKey);
      return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
    } catch {
      return null;
    }
  };
  const advance = () => {
    if (!durable) return null;
    try {
      const value = createGeneration();
      if (!/^[a-f0-9]{64}$/.test(value)) return null;
      storage.setItem(accountContract.authGenerationKey, value);
      return value;
    } catch {
      return null;
    }
  };
  if (!read()) advance();
  return {
    advance,
    current: read,
    matches(expected: string | null) {
      return Boolean(expected && read() === expected);
    },
  };
}

function createSupabaseAdapter(
  url: string,
  publishableKey: string,
  runtimeOrigin: string,
): PortalAuthAdapter {
  if (!isBrowserSafeSupabasePublicKey(publishableKey)) {
    throw new Error("Shared account services are not connected on this deployment yet.");
  }

  let authMutationEpoch = 0;
  const browserStorage = resolveBrowserAuthStorage();
  const authGeneration = createAuthGenerationCoordinator(
    browserStorage.storage,
    browserStorage.durable,
  );
  const beginAuthMutation = () => {
    authMutationEpoch += 1;
    authGeneration.advance();
  };
  const fitnessCommitFence = createFitnessCommitFencedStorage(
    browserStorage.storage,
    browserStorage.durable,
  );
  const client = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
      storage: fitnessCommitFence.storage,
      storageKey: accountContract.storageKey,
    },
  });

  return {
    kind: "supabase",
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return toPortalSession(data.session);
    },
    onSessionChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(toPortalSession(session));
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(identifier, password) {
      beginAuthMutation();
      if (identifier.includes("@")) {
        const { data, error } = await client.auth.signInWithPassword({ email: identifier, password });
        if (error) throw error;
        return toPortalSession(data.session);
      }

      const response = await fetch(`${url}/functions/v1/username-password-signin`, {
        body: JSON.stringify({ identifier, password }),
        headers: {
          apikey: publishableKey,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => null) as {
        access_token?: unknown;
        refresh_token?: unknown;
      } | null;
      if (
        !response.ok
        || typeof payload?.access_token !== "string"
        || typeof payload.refresh_token !== "string"
      ) {
        throw new Error("Unable to sign in with those credentials.");
      }
      const { data, error } = await client.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      });
      if (error) throw error;
      return toPortalSession(data.session);
    },
    async signUp(email, password, username, contextId, returnTarget) {
      beginAuthMutation();
      let confirmationState: string | undefined;
      if (contextId === "fitness") {
        if (!browserStorage.durable) {
          throw new Error("This browser cannot safely start a Fitness confirmation yet.");
        }
        confirmationState = createBrowserBoundConfirmationState();
        try {
          browserStorage.storage.setItem(accountContract.confirmationStateKey, confirmationState);
        } catch {
          throw new Error("This browser cannot safely start a Fitness confirmation yet.");
        }
      }
      let result: Awaited<ReturnType<typeof client.auth.signUp>>;
      try {
        result = await client.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: username, username },
            emailRedirectTo: accountConfirmUrl(contextId, confirmationState, returnTarget),
          },
        });
      } catch (error) {
        if (confirmationState) {
          browserStorage.storage.removeItem(accountContract.confirmationStateKey);
        }
        throw error;
      }
      const { data, error } = result;
      if (error) {
        if (confirmationState) {
          browserStorage.storage.removeItem(accountContract.confirmationStateKey);
        }
        throw error;
      }
      if (confirmationState && data.session) {
        browserStorage.storage.removeItem(accountContract.confirmationStateKey);
      }
      return toPortalSession(data.session);
    },
    async handoffToFitness(returnTarget, expectedUserId) {
      const attemptEpoch = authMutationEpoch;
      const attemptGeneration = authGeneration.current();
      const isEpochCurrent = () => authMutationEpoch === attemptEpoch &&
        authGeneration.matches(attemptGeneration);
      const isAttemptCurrent = async () => {
        if (!isEpochCurrent()) return false;
        const { data, error } = await client.auth.getSession();
        return !error && data.session?.user.id === expectedUserId &&
          isEpochCurrent();
      };
      return completeFitnessHandoff(returnTarget, {
        enabled: fitnessHandoffRuntimeReady(runtimeOrigin),
        async persistSession(session) {
          await fitnessCommitFence.run(session.accessToken, isEpochCurrent, () =>
            persistVerifiedFitnessSession(client.auth, session, expectedUserId, isAttemptCurrent));
        },
        isAttemptCurrent,
        async readSession() {
          const { data, error } = await client.auth.getSession();
          if (error || !data.session || data.session.user.id !== expectedUserId) {
            throw new FitnessHandoffError();
          }
          return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
        },
      });
    },
    async getOAuthAuthorization(authorizationId) {
      const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (error || !data) throw error ?? new Error("Authorization request unavailable.");
      return data;
    },
    async approveOAuthAuthorization(authorizationId) {
      const { data, error } = await client.auth.oauth.approveAuthorization(authorizationId, {
        skipBrowserRedirect: true,
      });
      if (error || !data?.redirect_url) throw error ?? new Error("Authorization request unavailable.");
      return data.redirect_url;
    },
    async denyOAuthAuthorization(authorizationId) {
      const { data, error } = await client.auth.oauth.denyAuthorization(authorizationId, {
        skipBrowserRedirect: true,
      });
      if (error || !data?.redirect_url) throw error ?? new Error("Authorization request unavailable.");
      return data.redirect_url;
    },
    async signOut() {
      beginAuthMutation();
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
    async requestPasswordReset(email, contextId, returnTarget) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: accountRecoveryUrl(contextId, returnTarget),
      });
      if (error) throw error;
    },
    async updateEmail(email) {
      beginAuthMutation();
      const { error } = await client.auth.updateUser({ email });
      if (error) throw error;
    },
    async updatePassword(password) {
      beginAuthMutation();
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    },
    async confirm(tokenHash, type) {
      beginAuthMutation();
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) throw error;
      return toPortalSession(data.session);
    },
    async exchangeCode(code) {
      beginAuthMutation();
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return toPortalSession(data.session);
    },
  };
}

function createTestAdapter(scenario: string): PortalAuthAdapter {
  let session: PortalSession | null =
    ["session", "oauth-auto", "oauth-hostile"].includes(scenario)
      ? { displayName: "fawxzzy", email: "preview.user@example.test", userId: "preview-user" }
      : null;
  const listeners = new Set<(value: PortalSession | null) => void>();
  const fail = () => {
    if (scenario === "error") throw new Error("Deterministic local test error");
  };
  const failSignup = () => {
    switch (scenario) {
      case "signup-existing":
        throw Object.assign(new Error("User already registered"), {
          code: "user_already_exists",
          status: 422,
        });
      case "signup-rate-limit":
        throw Object.assign(new Error("Too many requests"), { status: 429 });
      case "signup-network":
        throw new TypeError("fetch failed at the deterministic provider boundary");
      case "signup-unknown":
        throw { detail: "Malformed provider detail must never reach the interface" };
      default:
        fail();
    }
  };
  const publish = () => listeners.forEach((listener) => listener(session));

  return {
    kind: "test",
    async getSession() {
      if (scenario === "session-pending") {
        return new Promise<PortalSession | null>(() => undefined);
      }
      fail();
      return session;
    },
    onSessionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email) {
      fail();
      session = {
        displayName: email.includes("@") ? email.split("@", 1)[0] : email,
        email,
        userId: "preview-user",
      };
      publish();
      return session;
    },
    async signUp(email, _password, username) {
      failSignup();
      session = { displayName: username, email, userId: "preview-user" };
      publish();
      return session;
    },
    async handoffToFitness(returnTarget, expectedUserId) {
      // Deterministic local-only adapter: never send synthetic credentials to a live service.
      if (scenario === "fitness-handoff-error" || session?.userId !== expectedUserId) {
        throw new FitnessHandoffError();
      }
      return `${accountContract.productOrigins.fitness}${fitnessReturnPath(returnTarget)}`;
    },
    async getOAuthAuthorization(authorizationId) {
      fail();
      if (!session) throw new Error("Authorization request unavailable.");
      if (scenario === "oauth-auto") {
        return {
          redirect_url: `${accountContract.productOrigins.mazer}/?code=local-auto-code&state=local-state`,
        };
      }
      return {
        authorization_id: authorizationId,
        client: {
          id: "local-mazer-oauth-client",
          logo_uri: "",
          name: "Mazer",
          uri: accountContract.productOrigins.mazer,
        },
        redirect_uri: `${accountContract.productOrigins.mazer}/`,
        scope: "email",
        user: { email: session.email, id: session.userId },
      };
    },
    async approveOAuthAuthorization() {
      fail();
      if (scenario === "oauth-hostile") {
        return "https://attacker.example.test/?code=stolen";
      }
      return `${accountContract.productOrigins.mazer}/?code=local-code&state=local-state`;
    },
    async denyOAuthAuthorization() {
      fail();
      return `${accountContract.productOrigins.mazer}/?error=access_denied&state=local-state`;
    },
    async signOut() {
      fail();
      session = null;
      publish();
    },
    async requestPasswordReset() {
      fail();
    },
    async updateEmail(email) {
      fail();
      session = session ? { ...session, email } : null;
      publish();
    },
    async updatePassword() {
      fail();
    },
    async confirm() {
      fail();
      session = {
        displayName: "confirmed.user",
        email: "confirmed.user@example.test",
        userId: "confirmed-user",
      };
      publish();
      return session;
    },
    async exchangeCode() {
      if (scenario === "pending") {
        return new Promise<PortalSession | null>(() => undefined);
      }
      fail();
      session = {
        displayName: "callback.user",
        email: "callback.user@example.test",
        userId: "callback-user",
      };
      publish();
      return session;
    },
  };
}

function readPublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }

  return { publishableKey, url };
}

const defaultDependencies: PortalAuthAdapterDependencies = {
  createLiveAdapter: createSupabaseAdapter,
  readPublicConfig,
};

export function resolvePortalAuthAdapter(
  location: Pick<Location, "origin" | "search">,
  dependencies: PortalAuthAdapterDependencies = defaultDependencies,
): AdapterResolution {
  const query = new URLSearchParams(location.search);
  const scenario = query.get("auth_test");
  if (
    scenario &&
    [
      "success",
      "error",
      "pending",
      "session",
      "session-pending",
      "signup-existing",
      "signup-rate-limit",
      "signup-network",
      "signup-unknown",
      "fitness-handoff-error",
      "oauth-auto",
      "oauth-hostile",
    ].includes(scenario) &&
    isLocalAuthTestOrigin(location.origin)
  ) {
    return { status: "ready", adapter: createTestAdapter(scenario) };
  }

  if (!isLiveAccountAdapterOrigin(location.origin)) {
    return {
      status: "setup-pending",
      reason:
        "Live account access is limited to account.fawxzzy.com and approved local development origins.",
    };
  }

  const config = dependencies.readPublicConfig();
  if (!config || !isBrowserSafeSupabasePublicKey(config.publishableKey)) {
    return {
      status: "setup-pending",
      reason: "Shared account services are not connected on this deployment yet.",
    };
  }

  if (dependencies !== defaultDependencies) {
    return {
      status: "ready",
      adapter: dependencies.createLiveAdapter(config.url, config.publishableKey, location.origin),
    };
  }

  supabaseAdapter ??= dependencies.createLiveAdapter(
    config.url,
    config.publishableKey,
    location.origin,
  );
  return { status: "ready", adapter: supabaseAdapter };
}
