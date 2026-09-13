export const MAZER_OAUTH_AUTHORIZATION_PATH = "/oauth/authorize";
export const MAZER_OAUTH_PENDING_API_PATH = "/api/account/mazer-oauth-pending";
export const MAZER_OAUTH_PENDING_COOKIE = "__Host-fawxzzy-mazer-oauth-pending";
export const MAZER_OAUTH_REDIRECT_URI = "https://mazer.fawxzzy.com/";
export const MAZER_OAUTH_SCOPE = "email";
export const MAZER_OAUTH_PENDING_TTL_MS = 15 * 60 * 1000;

const LOCAL_TEST_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3210",
  "http://127.0.0.1:3210",
  "http://localhost:4312",
  "http://127.0.0.1:4312",
  "http://localhost:4313",
  "http://127.0.0.1:4313",
]);

const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;
const AUTH_GENERATION_PATTERN = /^[a-f0-9]{64}$/;
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const APPROVAL_QUERY_KEYS = new Set(["code", "state"]);
const DENIAL_QUERY_KEYS = new Set(["error", "error_description", "state"]);
const REDIRECT_MAX_BYTES = 4_096;
const CODE_MAX_LENGTH = 2_048;
const ACCESS_TOKEN_MAX_LENGTH = 8_192;
export const MAZER_OAUTH_DENIAL_DESCRIPTION = "User denied the request";

export type MazerOAuthAuthorizationDetails = {
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

export function isValidOAuthAccessToken(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 16 &&
    value.length <= ACCESS_TOKEN_MAX_LENGTH &&
    ACCESS_TOKEN_PATTERN.test(value);
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

export async function rebindPendingMazerOAuthAuthorization(authGeneration: string) {
  if (!isValidAuthGeneration(authGeneration)) return false;
  const response = await fetch(MAZER_OAUTH_PENDING_API_PATH, {
    body: JSON.stringify({ authGeneration }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  return response.ok;
}

function oauthGatewayHeaders(accessToken: string, authGeneration: string) {
  if (!isValidOAuthAccessToken(accessToken) || !isValidAuthGeneration(authGeneration)) {
    return null;
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Fawxzzy-Auth-Generation": authGeneration,
  };
}

export async function readPendingMazerOAuthAuthorization(
  accessToken: string,
  authGeneration: string,
) {
  const headers = oauthGatewayHeaders(accessToken, authGeneration);
  if (!headers) throw new Error("Authorization session unavailable.");
  const response = await fetch(MAZER_OAUTH_PENDING_API_PATH, {
    cache: "no-store",
    credentials: "same-origin",
    headers,
    method: "GET",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Pending authorization unavailable.");
  return parseMazerOAuthGatewayResult(await response.json().catch(() => null));
}

export async function decidePendingMazerOAuthAuthorization(
  action: "approve" | "deny",
  accessToken: string,
  authGeneration: string,
) {
  const authHeaders = oauthGatewayHeaders(accessToken, authGeneration);
  if (!authHeaders) throw new Error("Authorization session unavailable.");
  const response = await fetch(MAZER_OAUTH_PENDING_API_PATH, {
    body: JSON.stringify({ action, authGeneration }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    method: "PUT",
  });
  if (!response.ok) throw new Error("Authorization decision unavailable.");
  const value = await response.json().catch(() => null);
  if (!isRecord(value) || !hasExactKeys(value, ["redirectUrl"]) || typeof value.redirectUrl !== "string") {
    throw new Error("Authorization decision unavailable.");
  }
  return value.redirectUrl;
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

export function normalizeMazerOAuthProviderResult(
  value: unknown,
  expectedAuthorizationId: string,
): MazerOAuthAuthorizationResult | null {
  if (!isRecord(value) || !isValidMazerAuthorizationId(expectedAuthorizationId)) return null;
  if (typeof value.redirect_url === "string") {
    return { kind: "redirect", redirectUrl: value.redirect_url };
  }
  if (
    value.authorization_id !== expectedAuthorizationId ||
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
      clientId: value.client.id,
      clientName: value.client.name,
      redirectUri: value.redirect_uri,
      scope: value.scope,
      userId: value.user.id,
    },
  };
}

export function parseMazerOAuthGatewayResult(value: unknown): MazerOAuthAuthorizationResult | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (
    value.kind === "redirect" &&
    hasExactKeys(value, ["kind", "redirectUrl"]) &&
    typeof value.redirectUrl === "string"
  ) {
    return { kind: "redirect", redirectUrl: value.redirectUrl };
  }
  if (
    value.kind !== "authorization" ||
    !hasExactKeys(value, ["kind", "details"]) ||
    !isRecord(value.details) ||
    !hasExactKeys(value.details, [
      "clientId",
      "clientName",
      "redirectUri",
      "scope",
      "userId",
    ]) ||
    typeof value.details.clientId !== "string" ||
    typeof value.details.clientName !== "string" ||
    typeof value.details.redirectUri !== "string" ||
    typeof value.details.scope !== "string" ||
    typeof value.details.userId !== "string"
  ) {
    return null;
  }
  return {
    kind: "authorization",
    details: {
      clientId: value.details.clientId,
      clientName: value.details.clientName,
      redirectUri: value.details.redirectUri,
      scope: value.details.scope,
      userId: value.details.userId,
    },
  };
}

export function expectedMazerOAuthClientId(runtimeOrigin: string) {
  if (LOCAL_TEST_ORIGINS.has(runtimeOrigin)) return "local-mazer-oauth-client";
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
  const errorDescription = url.searchParams.get("error_description");
  const state = url.searchParams.get("state");
  if (
    error !== "access_denied" ||
    errorDescription !== MAZER_OAUTH_DENIAL_DESCRIPTION ||
    !state ||
    !STATE_PATTERN.test(state)
  ) return null;
  return url.href;
}
