import { Buffer } from "node:buffer";
import {
  isValidAuthGeneration,
  isValidMazerAuthorizationId,
  MAZER_OAUTH_PENDING_COOKIE,
  MAZER_OAUTH_PENDING_TTL_MS,
  parsePendingMazerOAuthAuthorization,
  type PendingMazerOAuthAuthorization,
} from "../../src/lib/auth/mazer-oauth";

const CANONICAL_ORIGIN = "https://account.fawxzzy.com";
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
const COOKIE_MAX_AGE_SECONDS = Math.floor(MAZER_OAUTH_PENDING_TTL_MS / 1_000);
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

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

export async function POST(request: Request) {
  if (!isExactSameOrigin(request)) return response(403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return response(415);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > REQUEST_MAX_BYTES) return response(413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return response(400);
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).sort().join(",") !== "authGeneration,authorizationId" ||
    !isValidMazerAuthorizationId(parsed.authorizationId) ||
    !isValidAuthGeneration(parsed.authGeneration)
  ) {
    return response(400);
  }
  const pending = {
    authorizationId: parsed.authorizationId,
    authGeneration: parsed.authGeneration,
    expiresAt: Date.now() + MAZER_OAUTH_PENDING_TTL_MS,
  } satisfies PendingMazerOAuthAuthorization;
  return response(204, null, { "Set-Cookie": setCookie(encodePending(pending)) });
}

export function GET(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  if (!isAllowedOrigin(requestOrigin)) return response(404);
  const values = readCookieValues(request);
  if (values.length !== 1) {
    return response(values.length > 1 ? 400 : 404, null, values.length > 1
      ? { "Set-Cookie": clearCookie() }
      : undefined);
  }
  const pending = decodePending(values[0]);
  if (!pending) return response(404, null, { "Set-Cookie": clearCookie() });
  return response(200, JSON.stringify(pending), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

export function DELETE(request: Request) {
  if (!isExactSameOrigin(request)) return response(403);
  return response(204, null, { "Set-Cookie": clearCookie() });
}
