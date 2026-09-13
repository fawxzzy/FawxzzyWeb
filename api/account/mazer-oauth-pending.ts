import { Buffer } from "node:buffer";
import {
  isValidAuthGeneration,
  isValidMazerAuthorizationId,
  isValidOAuthAccessToken,
  MAZER_OAUTH_PENDING_COOKIE,
  MAZER_OAUTH_PENDING_TTL_MS,
  normalizeMazerOAuthProviderResult,
  parsePendingMazerOAuthAuthorization,
  sanitizeMazerOAuthApprovalRedirect,
  sanitizeMazerOAuthDenialRedirect,
  type PendingMazerOAuthAuthorization,
} from "../../src/lib/auth/mazer-oauth";

const CANONICAL_ORIGIN = "https://account.fawxzzy.com";
const MASTER_SUPABASE_ORIGIN = "https://bxtcuhkotumitoqtrcej.supabase.co";
const LOCAL_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3210",
  "http://127.0.0.1:3210",
  "http://localhost:4312",
  "http://127.0.0.1:4312",
  "http://localhost:4313",
  "http://127.0.0.1:4313",
]);
const REQUEST_MAX_BYTES = 1_024;
const PROVIDER_RESPONSE_MAX_BYTES = 16_384;
const COOKIE_MAX_AGE_SECONDS = Math.floor(MAZER_OAUTH_PENDING_TTL_MS / 1_000);
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

class ProviderUnavailableError extends Error {}

function isAllowedOrigin(origin: string) {
  return origin === CANONICAL_ORIGIN || LOCAL_ORIGINS.has(origin);
}

function isExactSameOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  return isAllowedOrigin(requestOrigin) && request.headers.get("origin") === requestOrigin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function encodePending(value: PendingMazerOAuthAuthorization) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodePending(value: string) {
  try {
    return parsePendingMazerOAuthAuthorization(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown,
    );
  } catch {
    return null;
  }
}

function readCookieValues(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${MAZER_OAUTH_PENDING_COOKIE}=`))
    .map((part) => part.slice(MAZER_OAUTH_PENDING_COOKIE.length + 1));
}

function readPending(request: Request) {
  const values = readCookieValues(request);
  return {
    duplicate: values.length > 1,
    pending: values.length === 1 ? decodePending(values[0]) : null,
  };
}

function setCookie(value: string) {
  return `${MAZER_OAUTH_PENDING_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie() {
  return `${MAZER_OAUTH_PENDING_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function response(status: number, body: BodyInit | null = null, headers?: HeadersInit) {
  return new Response(body, {
    headers: { ...RESPONSE_HEADERS, ...headers },
    status,
  });
}

async function readJson(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return { error: 415 as const, value: null };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > REQUEST_MAX_BYTES) {
    return { error: 413 as const, value: null };
  }
  try {
    return { error: null, value: JSON.parse(raw) as unknown };
  } catch {
    return { error: 400 as const, value: null };
  }
}

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  return isValidOAuthAccessToken(token) ? token : null;
}

function readRequestGeneration(request: Request) {
  const value = request.headers.get("x-fawxzzy-auth-generation");
  return isValidAuthGeneration(value) ? value : null;
}

function readProviderConfig() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !publishableKey || publishableKey.length > 4_096 || /\s/.test(publishableKey)) {
    throw new ProviderUnavailableError();
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderUnavailableError();
  }
  if (url.origin !== MASTER_SUPABASE_ORIGIN || !["", "/"].includes(url.pathname)) {
    throw new ProviderUnavailableError();
  }
  return { publishableKey, url: url.origin };
}

async function providerRequest(
  pending: PendingMazerOAuthAuthorization,
  accessToken: string,
  action?: "approve" | "deny",
) {
  const config = readProviderConfig();
  const endpoint = `${config.url}/auth/v1/oauth/authorizations/${pending.authorizationId}${action ? "/consent" : ""}`;
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      body: action ? JSON.stringify({ action }) : undefined,
      headers: {
        Accept: "application/json",
        apikey: config.publishableKey,
        Authorization: `Bearer ${accessToken}`,
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      method: action ? "POST" : "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ProviderUnavailableError();
  }
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (!upstream.ok || bytes.byteLength > PROVIDER_RESPONSE_MAX_BYTES) {
    throw new ProviderUnavailableError();
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ProviderUnavailableError();
  }
}

export async function POST(request: Request) {
  if (!isExactSameOrigin(request)) return response(403);
  const parsed = await readJson(request);
  if (parsed.error) return response(parsed.error);
  if (
    !isRecord(parsed.value) ||
    !hasExactKeys(parsed.value, ["authGeneration", "authorizationId"]) ||
    !isValidMazerAuthorizationId(parsed.value.authorizationId) ||
    !isValidAuthGeneration(parsed.value.authGeneration)
  ) return response(400);
  const pending = {
    authorizationId: parsed.value.authorizationId,
    authGeneration: parsed.value.authGeneration,
    expiresAt: Date.now() + MAZER_OAUTH_PENDING_TTL_MS,
  } satisfies PendingMazerOAuthAuthorization;
  return response(204, null, { "Set-Cookie": setCookie(encodePending(pending)) });
}

export async function PATCH(request: Request) {
  if (!isExactSameOrigin(request)) return response(403);
  const parsed = await readJson(request);
  if (parsed.error) return response(parsed.error);
  if (
    !isRecord(parsed.value) ||
    !hasExactKeys(parsed.value, ["authGeneration"]) ||
    !isValidAuthGeneration(parsed.value.authGeneration)
  ) return response(400);
  const current = readPending(request);
  if (current.duplicate || !current.pending) {
    return response(current.duplicate ? 400 : 404, null, { "Set-Cookie": clearCookie() });
  }
  return response(204, null, {
    "Set-Cookie": setCookie(encodePending({
      ...current.pending,
      authGeneration: parsed.value.authGeneration,
    })),
  });
}

export async function GET(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  if (!isAllowedOrigin(requestOrigin)) return response(404);
  const current = readPending(request);
  if (current.duplicate || !current.pending) {
    return response(current.duplicate ? 400 : 404, null, { "Set-Cookie": clearCookie() });
  }
  const accessToken = readBearerToken(request);
  const authGeneration = readRequestGeneration(request);
  if (!accessToken || authGeneration !== current.pending.authGeneration) return response(401);
  try {
    const raw = await providerRequest(current.pending, accessToken);
    const result = normalizeMazerOAuthProviderResult(raw, current.pending.authorizationId);
    if (!result) return response(502);
    if (result.kind === "redirect") {
      const redirectUrl = sanitizeMazerOAuthApprovalRedirect(result.redirectUrl);
      if (!redirectUrl) return response(502, null, { "Set-Cookie": clearCookie() });
      return response(200, JSON.stringify({ kind: "redirect", redirectUrl }), {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": clearCookie(),
      });
    }
    return response(200, JSON.stringify(result), {
      "Content-Type": "application/json; charset=utf-8",
    });
  } catch {
    return response(502);
  }
}

export async function PUT(request: Request) {
  if (!isExactSameOrigin(request)) return response(403);
  const parsed = await readJson(request);
  if (parsed.error) return response(parsed.error);
  if (
    !isRecord(parsed.value) ||
    !hasExactKeys(parsed.value, ["action", "authGeneration"]) ||
    (parsed.value.action !== "approve" && parsed.value.action !== "deny") ||
    !isValidAuthGeneration(parsed.value.authGeneration)
  ) return response(400);
  const current = readPending(request);
  if (current.duplicate || !current.pending) {
    return response(current.duplicate ? 400 : 404, null, { "Set-Cookie": clearCookie() });
  }
  const accessToken = readBearerToken(request);
  const requestGeneration = readRequestGeneration(request);
  if (
    !accessToken ||
    requestGeneration !== parsed.value.authGeneration ||
    requestGeneration !== current.pending.authGeneration
  ) return response(401);
  try {
    const raw = await providerRequest(current.pending, accessToken, parsed.value.action);
    if (!isRecord(raw) || !hasExactKeys(raw, ["redirect_url"])) {
      return response(502, null, { "Set-Cookie": clearCookie() });
    }
    const redirectUrl = parsed.value.action === "approve"
      ? sanitizeMazerOAuthApprovalRedirect(raw.redirect_url)
      : sanitizeMazerOAuthDenialRedirect(raw.redirect_url);
    if (!redirectUrl) return response(502, null, { "Set-Cookie": clearCookie() });
    return response(200, JSON.stringify({ redirectUrl }), {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": clearCookie(),
    });
  } catch {
    // The provider may have consumed the one-time decision before a transport
    // failure became visible. Clear locally so the browser never replays it.
    return response(502, null, { "Set-Cookie": clearCookie() });
  }
}

export function DELETE(request: Request) {
  if (!isExactSameOrigin(request)) return response(403);
  return response(204, null, { "Set-Cookie": clearCookie() });
}
