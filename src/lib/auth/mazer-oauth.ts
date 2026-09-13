import { accountContract, isLocalAuthTestOrigin } from "@/config/account";

export const MAZER_OAUTH_AUTHORIZATION_PATH = "/oauth/authorize";
export const MAZER_OAUTH_PENDING_KEY = "fawxzzy.account.mazer.oauth.pending.v1";
export const MAZER_OAUTH_REDIRECT_URI = `${accountContract.productOrigins.mazer}/`;
export const MAZER_OAUTH_SCOPE = "email";
export const MAZER_OAUTH_PENDING_TTL_MS = 15 * 60 * 1000;

const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;
const REDIRECT_QUERY_KEYS = new Set([
  "code",
  "error",
  "error_description",
  "state",
]);

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
  expiresAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidMazerAuthorizationId(value: unknown): value is string {
  return typeof value === "string" && AUTHORIZATION_ID_PATTERN.test(value);
}

export function serializePendingMazerOAuthAuthorization(
  authorizationId: string,
  now = Date.now(),
) {
  if (!isValidMazerAuthorizationId(authorizationId)) return null;
  return JSON.stringify({
    authorizationId,
    expiresAt: now + MAZER_OAUTH_PENDING_TTL_MS,
  } satisfies PendingMazerOAuthAuthorization);
}

export function parsePendingMazerOAuthAuthorization(
  value: string | null | undefined,
  now = Date.now(),
) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !isRecord(parsed) ||
      !isValidMazerAuthorizationId(parsed.authorizationId) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= now ||
      parsed.expiresAt > now + MAZER_OAUTH_PENDING_TTL_MS
    ) {
      return null;
    }
    return {
      authorizationId: parsed.authorizationId,
      expiresAt: parsed.expiresAt,
    } satisfies PendingMazerOAuthAuthorization;
  } catch {
    return null;
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

export function sanitizeMazerOAuthRedirect(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== new URL(MAZER_OAUTH_REDIRECT_URI).origin ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => !REDIRECT_QUERY_KEYS.has(key)) ||
      url.searchParams.getAll("code").length > 1 ||
      url.searchParams.getAll("state").length > 1 ||
      url.searchParams.getAll("error").length > 1 ||
      url.searchParams.getAll("error_description").length > 1
    ) {
      return null;
    }
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if ((Boolean(code) === Boolean(error)) || (!code && !error)) return null;
    return url.href;
  } catch {
    return null;
  }
}
