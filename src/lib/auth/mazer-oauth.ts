import { accountContract, isLocalAuthTestOrigin } from "@/config/account";

export const MAZER_OAUTH_AUTHORIZATION_PATH = "/oauth/authorize";
export const MAZER_OAUTH_PENDING_API_PATH = "/api/account/mazer-oauth-pending";
export const MAZER_OAUTH_PENDING_COOKIE = "__Host-fawxzzy-mazer-oauth-pending";
export const MAZER_OAUTH_REDIRECT_URI = `${accountContract.productOrigins.mazer}/`;
export const MAZER_OAUTH_SCOPE = "email";
export const MAZER_OAUTH_PENDING_TTL_MS = 15 * 60 * 1000;

const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;
const AUTH_GENERATION_PATTERN = /^[a-f0-9]{64}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const APPROVAL_QUERY_KEYS = new Set(["code", "state"]);
const DENIAL_QUERY_KEYS = new Set(["error", "state"]);
const REDIRECT_MAX_BYTES = 4_096;
const CODE_MAX_LENGTH = 2_048;

export type MazerOAuthAuthorizationDetails = {
  authorizationId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scope: string;
  userId: string;
};

export type MazerOAuthAuthorizationResult =
  | { kind: "authorization"; details: MazerOAuthAuthorizationDetails }
  | { kind: "redirect"; redirectUrl: string };

export type PendingMazerOAuthAuthorization = {
  authorizationId: string;
  authGeneration: string;
  expiresAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isValidMazerAuthorizationId(value: unknown): value is string {
  return typeof value === "string" && AUTHORIZATION_ID_PATTERN.test(value);
}

export function isValidAuthGeneration(value: unknown): value is string {
  return typeof value === "string" && AUTH_GENERATION_PATTERN.test(value);
}

export function parsePendingMazerOAuthAuthorization(
  value: unknown,
  now = Date.now(),
): PendingMazerOAuthAuthorization | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["authorizationId", "authGeneration", "expiresAt"]) ||
    !isValidMazerAuthorizationId(value.authorizationId) ||
    !isValidAuthGeneration(value.authGeneration) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= now ||
    value.expiresAt > now + MAZER_OAUTH_PENDING_TTL_MS
  ) {
    return null;
  }

  return {
    authorizationId: value.authorizationId,
    authGeneration: value.authGeneration,
    expiresAt: value.expiresAt,
  };
}

export async function storePendingMazerOAuthAuthorization(
  authorizationId: string,
  authGeneration: string,
) {
  if (!isValidMazerAuthorizationId(authorizationId) || !isValidAuthGeneration(authGeneration)) {
    return false;
  }
  const response = await fetch(MAZER_OAUTH_PENDING_API_PATH, {
    body: JSON.stringify({ authorizationId, authGeneration }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return response.ok;
}

export async function readPendingMazerOAuthAuthorization() {
  const response = await fetch(MAZER_OAUTH_PENDING_API_PATH, {
    cache: "no-store",
    credentials: "same-origin",
    method: "GET",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Pending authorization unavailable.");
  return parsePendingMazerOAuthAuthorization(await response.json().catch(() => null));
}

export async function clearPendingMazerOAuthAuthorization() {
  const response = await fetch(MAZER_OAUTH_PENDING_API_PATH, {
    cache: "no-store",
    credentials: "same-origin",
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error("Pending authorization unavailable.");
  }
}

export function normalizeMazerOAuthAuthorizationResult(
  value: unknown,
): MazerOAuthAuthorizationResult | null {
  if (!isRecord(value)) return null;
  if (typeof value.redirect_url === "string") {
    return { kind: "redirect", redirectUrl: value.redirect_url };
  }
  if (
    !isValidMazerAuthorizationId(value.authorization_id) ||
    typeof value.redirect_uri !== "string" ||
    typeof value.scope !== "string" ||
    !isRecord(value.client) ||
    typeof value.client.id !== "string" ||
    typeof value.client.name !== "string" ||
    !isRecord(value.user) ||
    typeof value.user.id !== "string"
  ) {
    return null;
  }

  return {
    kind: "authorization",
    details: {
      authorizationId: value.authorization_id,
      clientId: value.client.id,
      clientName: value.client.name,
      redirectUri: value.redirect_uri,
      scope: value.scope,
      userId: value.user.id,
    },
  };
}

export function expectedMazerOAuthClientId(runtimeOrigin: string) {
  if (isLocalAuthTestOrigin(runtimeOrigin)) return "local-mazer-oauth-client";
  const value = process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID?.trim();
  return value && /^[A-Za-z0-9_-]{8,256}$/.test(value) ? value : null;
}

export function isExpectedMazerOAuthAuthorization(
  details: MazerOAuthAuthorizationDetails,
  runtimeOrigin: string,
) {
  const expectedClientId = expectedMazerOAuthClientId(runtimeOrigin);
  return Boolean(
    expectedClientId &&
      details.clientId === expectedClientId &&
      details.clientName === "Mazer" &&
      details.redirectUri === MAZER_OAUTH_REDIRECT_URI &&
      details.scope === MAZER_OAUTH_SCOPE,
  );
}

function parseBoundedMazerRedirect(value: unknown) {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > REDIRECT_MAX_BYTES) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.origin !== new URL(MAZER_OAUTH_REDIRECT_URI).origin ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function hasExactSearchKeys(url: URL, expectedKeys: Set<string>) {
  const keys = [...url.searchParams.keys()];
  return keys.length === expectedKeys.size &&
    keys.every((key) => expectedKeys.has(key)) &&
    [...expectedKeys].every((key) => url.searchParams.getAll(key).length === 1);
}

export function sanitizeMazerOAuthApprovalRedirect(value: unknown) {
  const url = parseBoundedMazerRedirect(value);
  if (!url || !hasExactSearchKeys(url, APPROVAL_QUERY_KEYS)) return null;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || code.length > CODE_MAX_LENGTH || !state || !STATE_PATTERN.test(state)) return null;
  return url.href;
}

export function sanitizeMazerOAuthDenialRedirect(value: unknown) {
  const url = parseBoundedMazerRedirect(value);
  if (!url || !hasExactSearchKeys(url, DENIAL_QUERY_KEYS)) return null;
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  if (error !== "access_denied" || !state || !STATE_PATTERN.test(state)) return null;
  return url.href;
}
