"use client";

import {
  createClient,
  isAuthApiError,
  isAuthSessionMissingError,
  type EmailOtpType,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { captchaOptions } from "@/lib/auth/captcha";
import {
  accountContract,
  accountConfirmUrl,
  accountEmailChangeUrl,
  accountRecoveryUrl,
  type AccountExperienceContextId,
  isLiveAccountAdapterOrigin,
  isLocalAuthTestOrigin,
  RESET_BY_USERNAME_LIVE,
  DELETE_ACCOUNT_LIVE,
} from "@/config/account";
import { clearRecoveryPkce, startRecoveryPkce } from "@/lib/auth/recovery-pkce";
import { USERNAME_THROTTLED_CODE, UsernameSignInThrottledError } from "@/lib/auth/errors";
import {
  isUsernameChangeStatus,
  ReauthMismatchError,
  type UsernameChangeStatus,
} from "@/lib/auth/account-change";
import {
  deleteConfirmTarget,
  isAccountDeleteStatus,
  isAccountGone,
  type AccountDeleteStatus,
} from "@/lib/auth/account-delete";
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

/**
 * What a portal sign-out ends. `everywhere` is the account page's "Sign out everywhere" link
 * only: it revokes every session the account holds at the provider (the portal's, Fitness's,
 * Mazer's, other devices). `this-session` ends only the portal's own session in this browser: the
 * account page's bottom Sign out button, the throw-away recovery session after a password
 * reset, and the /signout endpoint that Mazer's Sign out uses. It is the default, so a bare call
 * can never sign out other devices. `other-sessions` ends every
 * session of the account EXCEPT the one making the call; the password-reset flow runs it on the
 * recovery session first, so a changed password also signs out every other device and app. The
 * SDK fires no sign-out event and keeps the local copy for this scope, so it is always followed
 * by `this-session` when the caller itself is a throw-away session.
 */
export type PortalSignOutScope = "everywhere" | "this-session" | "other-sessions";

export const PORTAL_SIGN_OUT_SCOPES = {
  everywhere: "global",
  "this-session": "local",
  "other-sessions": "others",
} as const satisfies Record<PortalSignOutScope, "global" | "local" | "others">;

export type PortalAuthAdapter = {
  kind: "supabase" | "test";
  getAuthGeneration(): string | null;
  getSession(): Promise<PortalSession | null>;
  /**
   * Asks the provider whether the cached session is still alive and returns the provider's own
   * view of the account. A session another app ended (sign out everywhere) is cleared here and
   * answers null. A provider or network failure never signs anyone out: it keeps the cache.
   */
  validateSession(): Promise<PortalSession | null>;
  onSessionChange(listener: (session: PortalSession | null) => void): () => void;
  signIn(email: string, password: string, captchaToken?: string): Promise<PortalSession | null>;
  handoffToFitness(returnTarget: string, expectedUserId: string): Promise<string>;
  getOAuthAccessToken(expectedUserId: string): Promise<string>;
  signUp(
    email: string,
    password: string,
    username: string,
    contextId: AccountExperienceContextId,
    returnTarget?: string,
    captchaToken?: string,
  ): Promise<PortalSession | null>;
  signOut(scope?: PortalSignOutScope): Promise<void>;
  requestPasswordReset(
    email: string,
    contextId: AccountExperienceContextId,
    returnTarget?: string,
    captchaToken?: string,
  ): Promise<void>;
  /**
   * Signed out, the reset form asks for a USERNAME (never an email) when this is true; it is false
   * until the server side (Edge Function username-password-reset + its SQL) is live.
   */
  resetByUsername: boolean;
  /**
   * Signed in, the account page shows the Delete account row only when this is true; it is false
   * until the server function account_api.account_delete_self is applied (DELETE_ACCOUNT_LIVE).
   */
  deleteAccountLive: boolean;
  /**
   * Signed-out reset by username. Resolves for every accepted request, whether or not the username
   * has an account (the server answers the same either way). Throws with `status`/`code` only for a
   * malformed request, the rate limit or an unavailable service.
   */
  requestPasswordResetByUsername(
    username: string,
    contextId: AccountExperienceContextId,
    returnTarget?: string,
    captchaToken?: string,
  ): Promise<void>;
  /**
   * Step 1 of a signed-in change: the current password of the signed-in account, checked on a
   * throw-away client so the page's own session is never replaced. Throws when the password is wrong
   * or the provider returns a different account.
   */
  reauthenticate(password: string, captchaToken?: string): Promise<void>;
  /** Saves a new username at once (database function; rate limited there). */
  changeUsername(username: string): Promise<{ status: UsernameChangeStatus; session: PortalSession | null }>;
  /** Sends the change link to the NEW address; the change applies only when that link is opened. */
  requestEmailChange(email: string, contextId: AccountExperienceContextId): Promise<void>;
  /**
   * Delete account, step 1: the current password on a throw-away client, like `reauthenticate`, but
   * the fresh session is KEPT (in memory only) because it is the proof the server checks. Returns the
   * text step 2 asks the person to type (username, or email when there is none).
   */
  beginAccountDelete(password: string, captchaToken?: string): Promise<{ confirmTarget: string }>;
  /**
   * Delete account, last step: calls `account_api.account_delete_self` with the step-1 session. On
   * `deleted`/`gone` this browser is signed out too (every other session died with the account).
   * Without a step-1 session it answers `reauth` and calls nothing.
   */
  deleteAccount(confirm: string): Promise<AccountDeleteStatus>;
  /** Ends the step-1 session (Cancel, leaving the page). Safe to call at any time. */
  endAccountDelete(): Promise<void>;
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

function toPortalUser(user: User): PortalSession {
  const metadata = user.user_metadata;
  const displayName = [metadata?.username, metadata?.display_name]
    .find((candidate) => typeof candidate === "string" && candidate.trim())
    ?.trim() ?? null;
  return { displayName, email: user.email ?? null, userId: user.id };
}

function toPortalSession(session: Session | null): PortalSession | null {
  if (!session?.user) return null;
  return toPortalUser(session.user);
}

type PortalSignOutAuth = Pick<SupabaseClient["auth"], "getSession" | "signOut">;
type PortalValidationAuth = Pick<SupabaseClient["auth"], "getSession" | "getUser" | "signOut">;

/**
 * Provider answers that mean the session itself is gone (signed out elsewhere, refresh token
 * spent or unknown). Anything else that fails a refresh (rate limit, a gateway rejecting the API
 * key, a 5xx) says nothing about the session and must never read as "already signed out".
 */
const SESSION_REVOKED_CODES: ReadonlySet<string> = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "invalid_grant",
]);

function isSessionRevokedError(error: unknown) {
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthApiError(error)) return false;
  if (error.code) return SESSION_REVOKED_CODES.has(error.code);
  // Older Auth servers answer a dead refresh token with no error code.
  return error.status === 400 &&
    /invalid refresh token|refresh token not found|already used/i.test(error.message);
}

/** Provider answers to the access token itself that mean this session can no longer be used. */
const SESSION_REJECTED_CODES: ReadonlySet<string> = new Set([
  "bad_jwt",
  "user_not_found",
  "user_banned",
  "session_not_found",
]);

/**
 * Ends the portal's session at the provider with the requested reach (see PortalSignOutScope).
 * A failure the provider caused (network, 5xx, rate limit) stays an error, so the page can say
 * so. The one exception is a session another app already revoked: the SDK clears the local copy
 * and may still report the refresh it could not do, and a person with nothing left to sign out
 * of has signed out, so that is a success. Only revocation-class answers count: the SDK also
 * clears the local copy for other non-retryable refresh failures (429, a gateway 4xx), and then
 * the logout call was never sent, so that must surface as an error, not as success.
 */
export async function signOutOfPortal(
  auth: PortalSignOutAuth,
  scope: PortalSignOutScope = "this-session",
) {
  const { error } = await auth.signOut({ scope: PORTAL_SIGN_OUT_SCOPES[scope] });
  if (!error) return;
  if (isSessionRevokedError(error)) {
    const remaining = await auth.getSession().catch(() => null);
    if (remaining && !remaining.error && !remaining.data.session) return;
  }
  throw error;
}

/**
 * Checks the cached session against the provider with the access token it already holds
 * (`getUser`), which is how a sign-out everywhere done in Fitness or Mazer becomes visible here
 * before the cached token expires. The check itself does not use the refresh token, but the SDK
 * may: like `getSession`, `getUser` refreshes when the held access token is expired or inside 90 s
 * of expiry, so this adds no refresh-lineage exposure beyond what every `getSession` call carries.
 * Only a revocation or rejection code clears the local copy; any other failure (offline, 5xx, a
 * gateway answer) keeps what is cached.
 */
export async function validatePortalSession(
  auth: PortalValidationAuth,
): Promise<PortalSession | null> {
  const { data, error } = await auth.getUser();
  if (!error && data.user) return toPortalUser(data.user);
  if (
    isAuthApiError(error) &&
    (error.status === 401 || error.status === 403) &&
    error.code &&
    SESSION_REJECTED_CODES.has(error.code)
  ) {
    // The provider says this access token's session or user is gone. The SDK only clears its own
    // copy for a missing session, so clear it here. The provider already treats the session as
    // dead, so the local sign-out costs nothing; if even that fails the caller changes nothing.
    const { error: clearError } = await auth.signOut({ scope: "local" });
    if (clearError) throw clearError;
    return null;
  }
  // A missing or revoked session was already cleared by the SDK, so reading it back answers null.
  // Provider or network trouble leaves the cached session in place and it is returned as it is;
  // being offline is not a sign-out. If even the cache cannot be read the error is thrown so the
  // caller changes nothing.
  const current = await auth.getSession();
  if (current.error) {
    if (isAuthSessionMissingError(current.error)) return null;
    throw current.error;
  }
  return toPortalSession(current.data.session);
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

export function createSupabaseAdapter(
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

  /**
   * A throw-away client with its own in-memory storage: a password check never replaces, refreshes
   * or signs out the page's session. Throws when the password is wrong or another account answers.
   */
  async function passwordCheck(password: string, captchaToken?: string) {
    const { data: current, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const email = current.session?.user.email;
    const userId = current.session?.user.id;
    if (!email || !userId) throw new ReauthMismatchError();
    const memory = new Map<string, string>();
    const checker = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
        storage: {
          getItem: (key) => memory.get(key) ?? null,
          removeItem: (key) => void memory.delete(key),
          setItem: (key, value) => void memory.set(key, value),
        },
        storageKey: `${accountContract.storageKey}.reauth`,
      },
    });
    const { data, error } = await checker.auth.signInWithPassword({
      email,
      password,
      options: captchaOptions(captchaToken),
    });
    if (error) throw error;
    if (!data.user || data.user.id !== userId) {
      await checker.auth.signOut({ scope: "local" }).catch(() => undefined);
      throw new ReauthMismatchError();
    }
    return { checker, user: data.user };
  }

  // Delete account: the step-1 session, held in memory only while the delete screen is open.
  let deleteChecker: SupabaseClient | null = null;
  async function endDeleteChecker() {
    const checker = deleteChecker;
    deleteChecker = null;
    if (checker) await checker.auth.signOut({ scope: "local" }).catch(() => undefined);
  }

  return {
    kind: "supabase",
    getAuthGeneration() {
      return authGeneration.current();
    },
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return toPortalSession(data.session);
    },
    validateSession() {
      return validatePortalSession(client.auth);
    },
    onSessionChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(toPortalSession(session));
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(identifier, password, captchaToken) {
      beginAuthMutation();
      if (identifier.includes("@")) {
        const { data, error } = await client.auth.signInWithPassword({
          email: identifier,
          password,
          options: captchaOptions(captchaToken),
        });
        if (error) throw error;
        return toPortalSession(data.session);
      }

      const response = await fetch(`${url}/functions/v1/username-password-signin`, {
        body: JSON.stringify({ identifier, password, ...captchaOptions(captchaToken) }),
        headers: {
          apikey: publishableKey,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => null) as {
        access_token?: unknown;
        code?: unknown;
        refresh_token?: unknown;
      } | null;
      if (response.status === 429 && payload?.code === USERNAME_THROTTLED_CODE) {
        throw new UsernameSignInThrottledError();
      }
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
    async signUp(email, password, username, contextId, returnTarget, captchaToken) {
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
            ...captchaOptions(captchaToken),
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
    async getOAuthAccessToken(expectedUserId) {
      const { data, error } = await client.auth.getSession();
      if (
        error ||
        !data.session ||
        data.session.user.id !== expectedUserId ||
        typeof data.session.access_token !== "string"
      ) {
        throw error ?? new Error("Authorization session unavailable.");
      }
      return data.session.access_token;
    },
    async signOut(scope = "this-session") {
      beginAuthMutation();
      await signOutOfPortal(client.auth, scope);
    },
    async requestPasswordReset(email, contextId, returnTarget, captchaToken) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: accountRecoveryUrl(contextId, returnTarget),
        ...captchaOptions(captchaToken),
      });
      if (error) throw error;
    },
    resetByUsername: RESET_BY_USERNAME_LIVE,
    deleteAccountLive: DELETE_ACCOUNT_LIVE,
    async requestPasswordResetByUsername(username, contextId, returnTarget, captchaToken) {
      // The provider call happens on the server, so this browser prepares the PKCE verifier the
      // recovery link is exchanged with (lib/auth/recovery-pkce.ts) and sends only its challenge.
      const verifierStorage = fitnessCommitFence.storage;
      const { codeChallenge, codeChallengeMethod } = await startRecoveryPkce(verifierStorage, accountContract.storageKey);
      let response: Response;
      try {
        response = await fetch(`${url}/functions/v1/username-password-reset`, {
          body: JSON.stringify({
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
            identifier: username,
            redirect_to: accountRecoveryUrl(contextId, returnTarget),
            ...captchaOptions(captchaToken),
          }),
          headers: {
            apikey: publishableKey,
            "Content-Type": "application/json",
          },
          method: "POST",
        });
      } catch (error) {
        await clearRecoveryPkce(verifierStorage, accountContract.storageKey);
        throw error;
      }
      if (response.ok) return;
      const payload = await response.json().catch(() => null) as { code?: unknown } | null;
      await clearRecoveryPkce(verifierStorage, accountContract.storageKey);
      throw Object.assign(new Error("Username reset request failed."), {
        code: typeof payload?.code === "string" ? payload.code : undefined,
        status: response.status,
      });
    },
    async reauthenticate(password, captchaToken) {
      // The session the check creates is ended right away.
      const { checker } = await passwordCheck(password, captchaToken);
      await checker.auth.signOut({ scope: "local" }).catch(() => undefined);
    },
    async beginAccountDelete(password, captchaToken) {
      await endDeleteChecker();
      const { checker, user } = await passwordCheck(password, captchaToken);
      deleteChecker = checker;
      return { confirmTarget: deleteConfirmTarget(user.user_metadata?.username, user.email) };
    },
    async deleteAccount(confirm) {
      const checker = deleteChecker;
      if (!checker) return "reauth";
      const { data, error, status } = await checker
        .schema("account_api")
        .rpc("account_delete_self", { p_confirm: confirm });
      if (error) {
        throw Object.assign(new Error("Account delete failed."), {
          code: error.code,
          message: error.message,
          status,
        });
      }
      if (!isAccountDeleteStatus(data)) {
        throw Object.assign(new Error("Account delete returned an unknown answer."), { status });
      }
      if (data === "reauth") await endDeleteChecker();
      if (isAccountGone(data)) {
        // The account row is gone, and with it every session at the provider. Clear the local copies
        // (the provider answers the logout calls with "not found", which the SDK treats as done).
        await endDeleteChecker();
        beginAuthMutation();
        await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      }
      return data;
    },
    async endAccountDelete() {
      await endDeleteChecker();
    },
    async changeUsername(username) {
      const { data, error, status } = await client
        .schema("account_api")
        .rpc("account_change_username", { p_username: username });
      if (error) {
        throw Object.assign(new Error("Username change failed."), {
          code: error.code,
          message: error.message,
          status,
        });
      }
      if (!isUsernameChangeStatus(data)) {
        throw Object.assign(new Error("Username change returned an unknown answer."), { status });
      }
      if (data !== "changed") return { status: data, session: null };
      // The new name is in the account record; refresh so this page (and its token) carries it.
      beginAuthMutation();
      const refreshed = await client.auth.refreshSession().catch(() => null);
      return { status: data, session: toPortalSession(refreshed?.data.session ?? null) };
    },
    async requestEmailChange(email, contextId) {
      const { error } = await client.auth.updateUser(
        { email },
        { emailRedirectTo: accountEmailChangeUrl(contextId) },
      );
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
  const browserStorage = resolveBrowserAuthStorage();
  const authGeneration = createAuthGenerationCoordinator(
    browserStorage.storage,
    browserStorage.durable,
  );
  const beginAuthMutation = () => {
    authGeneration.advance();
  };
  let session: PortalSession | null =
    [
      "session",
      "session-expires",
      "session-revoked-elsewhere",
      "session-revoked-on-return",
      "session-validation-unavailable",
      "session-refreshed-on-check",
      "oauth-auto",
      "oauth-hostile",
      "change-rate",
      "change-unavailable",
      "signout-everywhere-fail",
      "delete-unavailable",
      "delete-billing",
      "delete-rate",
      "delete-gone",
      "delete-expired",
      "delete-support",
      "delete-blocked",
      "delete-off",
    ].includes(scenario)
      ? { displayName: "fawxzzy", email: "preview.user@example.test", userId: "preview-user" }
      : null;
  const listeners = new Set<(value: PortalSession | null) => void>();
  let deleteChecked = false;
  let deleteExpiredOnce = false;
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
      case "signup-weak-password":
        throw Object.assign(new Error("Password is known to be weak and easy to guess"), {
          code: "weak_password",
          status: 422,
        });
      case "signup-rate-limit":
        throw Object.assign(new Error("Too many requests"), { status: 429 });
      case "signup-network":
        throw new TypeError("fetch failed at the deterministic provider boundary");
      case "signup-username-taken":
        // Shape of the before-user-created hook rejection (HTTP 409).
        throw Object.assign(new Error("ACCOUNT_USERNAME_TAKEN"), { status: 409 });
      case "signup-database-error":
        // What the provider returns when a database trigger aborts user creation.
        throw Object.assign(new Error("Database error saving new user"), {
          code: "unexpected_failure",
          status: 500,
        });
      case "signup-unknown":
        throw { detail: "Malformed provider detail must never reach the interface" };
      default:
        fail();
    }
  };
  const publish = () => listeners.forEach((listener) => listener(session));
  let validations = 0;
  return {
    kind: "test",
    getAuthGeneration() {
      return authGeneration.current();
    },
    async getSession() {
      if (scenario === "session-pending") {
        return new Promise<PortalSession | null>(() => undefined);
      }
      fail();
      return session;
    },
    async validateSession() {
      validations += 1;
      // Harness marker: how many provider checks this page has made.
      document.documentElement.dataset.sessionValidations = String(validations);
      // The provider ended this session while the page held a cached copy: found at the first check
      // (`revoked-elsewhere`) or only when the person comes back to the tab (`revoked-on-return`).
      if (
        scenario === "session-revoked-elsewhere" ||
        (scenario === "session-revoked-on-return" && validations > 1)
      ) {
        session = null;
        publish();
        return null;
      }
      // A failed check must change nothing.
      if (scenario === "session-validation-unavailable") {
        throw new Error("Deterministic provider outage");
      }
      // The SDK announces a session event while the check runs; the provider's fresh answer must
      // still be applied afterwards.
      if (scenario === "session-refreshed-on-check" && session) {
        publish();
        return { ...session, email: "renamed.user@example.test" };
      }
      return session;
    },
    onSessionChange(listener) {
      listeners.add(listener);
      if (scenario === "session-expires") {
        // A session that ends without this page asking (expiry or a sign-out in another tab).
        window.setTimeout(() => {
          session = null;
          publish();
        }, 400);
      }
      return () => listeners.delete(listener);
    },
    async signIn(email) {
      beginAuthMutation();
      // Deterministic lockout scenario: only username sign-in is throttled; email sign-in is not.
      if (scenario === "login-throttled" && !email.includes("@")) {
        throw new UsernameSignInThrottledError();
      }
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
      beginAuthMutation();
      failSignup();
      // The provider created the account but wants the email confirmed first: no session yet.
      if (scenario === "signup-confirm") return null;
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
    async getOAuthAccessToken(expectedUserId) {
      fail();
      if (!session || session.userId !== expectedUserId) {
        throw new Error("Authorization session unavailable.");
      }
      return `local-${scenario ?? "default"}-oauth-token-1234567890`;
    },
    async signOut(scope = "this-session") {
      beginAuthMutation();
      fail();
      // Harness marker so the browser tests can see which reach the page asked for.
      document.documentElement.dataset.signOutScope = scope;
      const log = document.documentElement.dataset.signOutScopes;
      document.documentElement.dataset.signOutScopes = log ? `${log},${scope}` : scope;
      if (scope === "other-sessions") {
        // Mirrors the SDK: ending the other sessions neither clears nor announces this one.
        if (scenario === "reset-others-error") throw new Error("Deterministic other-sessions error");
        return;
      }
      // The provider could not end the sessions (network, 5xx): nothing changes here.
      if (scenario === "signout-everywhere-fail" && scope === "everywhere") {
        throw new Error("Deterministic sign-out-everywhere error");
      }
      session = null;
      publish();
    },
    async requestPasswordReset() {
      fail();
    },
    // Username reset fixtures. Every username gets the same answer (the server never says whether it
    // has an account); `reset-throttled` and `reset-unavailable` answer like the rate limit and a
    // missing server function. `reset-email-legacy` keeps the email form (the flag-off live path).
    resetByUsername: scenario !== "reset-email-legacy",
    // The Delete account row shows in every fixture except `delete-off` (the flag-off live page).
    deleteAccountLive: scenario !== "delete-off",
    async requestPasswordResetByUsername(username, contextId, returnTarget) {
      fail();
      if (scenario === "reset-throttled") {
        throw Object.assign(new Error("Too many requests"), { code: "reset_throttled", status: 429 });
      }
      if (scenario === "reset-unavailable") {
        throw Object.assign(new Error("Service unavailable"), { code: "reset_unavailable", status: 503 });
      }
      document.documentElement.dataset.resetUsername = username;
      document.documentElement.dataset.resetRedirect = accountRecoveryUrl(contextId, returnTarget);
    },
    // Change username / email fixtures. Deterministic by input: the password "wrong-password" is
    // rejected and "too-many" is rate limited, the name "taken-name" and the address
    // "taken@example.test" belong to someone else.
    // `change-rate` answers "too many", `change-unavailable` behaves like the database function is
    // not applied yet. Harness markers record what the page sent.
    async reauthenticate(password) {
      fail();
      if (!session) throw new ReauthMismatchError();
      if (password === "too-many") throw Object.assign(new Error("Too many requests"), { status: 429 });
      if (password === "wrong-password") {
        throw Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials", status: 400 });
      }
      document.documentElement.dataset.reauthenticated = "true";
    },
    async changeUsername(username) {
      fail();
      if (scenario === "change-unavailable") {
        throw Object.assign(new Error("Could not find the function"), { code: "PGRST202", status: 404 });
      }
      document.documentElement.dataset.changedUsername = username;
      if (scenario === "change-rate") return { status: "rate", session: null };
      if (username.toLowerCase() === "taken-name") return { status: "taken", session: null };
      if (!session) throw new ReauthMismatchError();
      if (username === session.displayName) return { status: "same", session: null };
      session = { ...session, displayName: username };
      publish();
      return { status: "changed", session };
    },
    // Delete account fixtures. Same passwords as above ("wrong-password", "too-many"). The typed
    // text must match the username. `delete-unavailable` behaves like the database function is not
    // applied, `delete-billing`/`delete-support`/`delete-rate` return those answers, `delete-gone`
    // answers "gone" (already deleted), `delete-expired` answers "reauth" once (password check too
    // old), `delete-blocked` fails like a foreign key the function does not know rolled the call back
    // (23503), `delete-off` hides the row (DELETE_ACCOUNT_LIVE off).
    // Harness markers record each step; nothing leaves the browser.
    async beginAccountDelete(password) {
      fail();
      if (!session) throw new ReauthMismatchError();
      if (password === "too-many") throw Object.assign(new Error("Too many requests"), { status: 429 });
      if (password === "wrong-password") {
        throw Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials", status: 400 });
      }
      deleteChecked = true;
      document.documentElement.dataset.deleteChecked = "true";
      return { confirmTarget: deleteConfirmTarget(session.displayName, session.email) };
    },
    async deleteAccount(confirm) {
      fail();
      if (!deleteChecked || !session) return "reauth";
      const log = document.documentElement.dataset.deleteCalls;
      document.documentElement.dataset.deleteCalls = String(Number(log ?? "0") + 1);
      if (scenario === "delete-unavailable") {
        throw Object.assign(new Error("Could not find the function"), { code: "PGRST202", status: 404 });
      }
      if (scenario === "delete-expired" && !deleteExpiredOnce) {
        deleteExpiredOnce = true;
        deleteChecked = false;
        return "reauth";
      }
      if (confirm.trim().toLowerCase() !== deleteConfirmTarget(session.displayName, session.email).toLowerCase()) {
        return "confirm";
      }
      if (scenario === "delete-billing") return "billing";
      if (scenario === "delete-support") return "support";
      if (scenario === "delete-rate") return "rate";
      if (scenario === "delete-blocked") {
        throw Object.assign(new Error("update or delete violates foreign key constraint"), { code: "23503", status: 409 });
      }
      const status = scenario === "delete-gone" ? "gone" : "deleted";
      beginAuthMutation();
      deleteChecked = false;
      session = null;
      document.documentElement.dataset.accountDeleted = status;
      publish();
      return status;
    },
    async endAccountDelete() {
      deleteChecked = false;
    },
    async requestEmailChange(email, contextId) {
      fail();
      if (scenario === "change-unavailable") {
        throw Object.assign(new Error("Service unavailable"), { status: 503 });
      }
      if (scenario === "change-rate") {
        throw Object.assign(new Error("Email rate limit exceeded"), { code: "over_email_send_rate_limit", status: 429 });
      }
      if (email.toLowerCase() === "taken@example.test") {
        throw Object.assign(new Error("Email exists"), { code: "email_exists", status: 422 });
      }
      // The provider sends the link; the account keeps its old address until the link is opened.
      document.documentElement.dataset.emailChangeRequested = email;
      document.documentElement.dataset.emailChangeRedirect = accountEmailChangeUrl(contextId);
    },
    async updatePassword() {
      beginAuthMutation();
      fail();
    },
    async confirm() {
      beginAuthMutation();
      fail();
      // Secure email change, first of two links: accepted, but no session yet.
      if (scenario === "confirm-pending") return null;
      session = {
        displayName: "confirmed.user",
        email: "confirmed.user@example.test",
        userId: "confirmed-user",
      };
      publish();
      return session;
    },
    async exchangeCode() {
      beginAuthMutation();
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
      "signup-weak-password",
      "signup-rate-limit",
      "signup-network",
      "signup-unknown",
      "signup-username-taken",
      "signup-database-error",
      "signup-confirm",
      "session-expires",
      "session-revoked-elsewhere",
      "session-revoked-on-return",
      "session-validation-unavailable",
      "session-refreshed-on-check",
      "login-throttled",
      "fitness-handoff-error",
      "oauth-auto",
      "oauth-hostile",
      "reset-others-error",
      "change-rate",
      "change-unavailable",
      "signout-everywhere-fail",
      "delete-unavailable",
      "delete-billing",
      "delete-rate",
      "delete-gone",
      "delete-expired",
      "delete-support",
      "delete-blocked",
      "delete-off",
      "confirm-pending",
      "reset-email-legacy",
      "reset-throttled",
      "reset-unavailable",
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
