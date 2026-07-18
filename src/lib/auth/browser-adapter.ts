"use client";

import { createClient, type EmailOtpType, type Session } from "@supabase/supabase-js";
import {
  accountContract,
  accountUrls,
  isLiveAccountAdapterOrigin,
  isLocalAuthTestOrigin,
} from "@/config/account";
import { isBrowserSafeSupabasePublicKey } from "@/lib/auth/supabase-public-key.mjs";

export type PortalSession = {
  email: string | null;
  userId: string;
};

export type PortalAuthAdapter = {
  kind: "supabase" | "test";
  getSession(): Promise<PortalSession | null>;
  onSessionChange(listener: (session: PortalSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<PortalSession | null>;
  signUp(email: string, password: string): Promise<PortalSession | null>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
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

export type PortalAuthAdapterDependencies = {
  createLiveAdapter(url: string, publishableKey: string): PortalAuthAdapter;
  readPublicConfig(): PublicAuthConfig | null;
};

let supabaseAdapter: PortalAuthAdapter | null = null;

function toPortalSession(session: Session | null): PortalSession | null {
  if (!session?.user) return null;
  return { email: session.user.email ?? null, userId: session.user.id };
}

function createSupabaseAdapter(url: string, publishableKey: string): PortalAuthAdapter {
  if (!isBrowserSafeSupabasePublicKey(publishableKey)) {
    throw new Error("Shared account services are not connected on this deployment yet.");
  }

  const client = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
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
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return toPortalSession(data.session);
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: accountUrls.confirm },
      });
      if (error) throw error;
      return toPortalSession(data.session);
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: accountUrls.recovery,
      });
      if (error) throw error;
    },
    async updateEmail(email) {
      const { error } = await client.auth.updateUser({ email });
      if (error) throw error;
    },
    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    },
    async confirm(tokenHash, type) {
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) throw error;
      return toPortalSession(data.session);
    },
    async exchangeCode(code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return toPortalSession(data.session);
    },
  };
}

function createTestAdapter(scenario: string): PortalAuthAdapter {
  let session: PortalSession | null =
    scenario === "session"
      ? { email: "preview.user@example.test", userId: "preview-user" }
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
      fail();
      return session;
    },
    onSessionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email) {
      fail();
      session = { email, userId: "preview-user" };
      publish();
      return session;
    },
    async signUp(email) {
      failSignup();
      session = { email, userId: "preview-user" };
      publish();
      return session;
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
      session = { email: "confirmed.user@example.test", userId: "confirmed-user" };
      publish();
      return session;
    },
    async exchangeCode() {
      if (scenario === "pending") {
        return new Promise<PortalSession | null>(() => undefined);
      }
      fail();
      session = { email: "callback.user@example.test", userId: "callback-user" };
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
      "signup-existing",
      "signup-rate-limit",
      "signup-network",
      "signup-unknown",
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
      adapter: dependencies.createLiveAdapter(config.url, config.publishableKey),
    };
  }

  supabaseAdapter ??= dependencies.createLiveAdapter(config.url, config.publishableKey);
  return { status: "ready", adapter: supabaseAdapter };
}
