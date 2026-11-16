// Request handling for the username-password-reset Edge Function, kept free of Deno APIs so the
// repo's node tests (tests/username-password-reset.test.mjs) and the pglite scratch test drive the
// exact code that ships. index.ts only wires environment, fetch and the background-task hook.
//
// Contract (design direction #9): signed out, a reset request carries a USERNAME, never an email.
//   POST { identifier, code_challenge, code_challenge_method: "s256", redirect_to, captchaToken? }
//   200 { status: "accepted" }          for EVERY well-formed, admitted request: known, unknown,
//                                        banned, unconfirmed or email-less usernames alike
//   429 { code: "reset_throttled" }     rate limit, decided before and independent of existence
//   503 { code: "reset_unavailable" }   resolver missing or failing (same for every username)
//   400 { code: "reset_invalid" }       malformed request (decided from the request alone)
// The answer never carries an email, a masked email or a user id. The lookup that differs between
// known and unknown usernames (account record, provider recovery call) runs as a background task
// AFTER the answer is scheduled, and every answer is held to the same minimum duration, so neither
// the body nor the timing tells a caller whether the username has an account.
import { clientBucket } from "../username-password-signin/client-bucket.mjs";

export const USERNAME = /^[A-Za-z0-9._-]{2,15}$/;
export const ALLOWED_ORIGINS = new Set(["https://account.fawxzzy.com"]);
export const RESET_ACCEPTED = Object.freeze({ status: "accepted" });
export const RESET_THROTTLED_CODE = "reset_throttled";
export const RESET_UNAVAILABLE_CODE = "reset_unavailable";
export const RESET_INVALID_CODE = "reset_invalid";
/** Every answer (except the CORS preflight) takes at least this long. */
export const MINIMUM_RESPONSE_MS = 900;
const MAX_BODY_BYTES = 4096;
// RFC 7636 code challenge: S256 output is 43 base64url characters; allow the full verifier range.
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only redirects the function forwards to the provider: exactly what the portal's
 * accountRecoveryUrl() builds (src/config/account.ts; pinned by the node test). Anything else is a
 * malformed request, so the email link can never point anywhere else.
 */
export const RECOVERY_REDIRECTS = new Set([
  "https://account.fawxzzy.com/reset-password?recovery=1",
  "https://account.fawxzzy.com/reset-password?recovery=1&app=fitness",
  "https://account.fawxzzy.com/reset-password?recovery=1&app=mazer",
  "https://account.fawxzzy.com/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize",
]);

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Headers": "apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function json(status, payload, origin, extra = {}) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      ...(ALLOWED_ORIGINS.has(origin) ? corsHeaders(origin) : {}),
      ...extra,
    },
    status,
  });
}

/** Reads the request body into the fields the function uses, or null when anything is off. */
export function parseResetBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const codeChallenge = typeof body.code_challenge === "string" ? body.code_challenge : "";
  const method = typeof body.code_challenge_method === "string" ? body.code_challenge_method.toLowerCase() : "";
  const redirectTo = typeof body.redirect_to === "string" ? body.redirect_to : "";
  const rawCaptcha = typeof body.captchaToken === "string" ? body.captchaToken.trim() : "";
  if (!USERNAME.test(identifier)) return null;
  if (!CODE_CHALLENGE.test(codeChallenge) || method !== "s256") return null;
  if (!RECOVERY_REDIRECTS.has(redirectTo)) return null;
  if (rawCaptcha.length > 4096) return null;
  return {
    captchaToken: rawCaptcha || undefined,
    codeChallenge,
    identifier,
    redirectTo,
  };
}

/**
 * Who gets the email: the address on the account, unless the account is deleted, banned or has no
 * address. Unconfirmed accounts get it (opening a recovery link also confirms the address, which is
 * the provider's own behaviour for an email-typed reset).
 */
export function recipientFrom(user, nowMs) {
  if (!user || typeof user !== "object") return null;
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (!email.includes("@")) return null;
  if (user.deleted_at) return null;
  if (typeof user.banned_until === "string" && Date.parse(user.banned_until) > nowMs) return null;
  return email;
}

/** Namespaced counter keys; never equal to the username sign-in keys for the same caller. */
export async function resetAttemptKeys(normalizedUsername, clientAddress, sha256) {
  return {
    clientKey: await sha256(`username-reset-client-v1:${clientAddress}`),
    pairKey: await sha256(`username-reset-pair-v1:${normalizedUsername}:${clientAddress}`),
  };
}

/** Client address bucket, same precedence and IPv6 /64 grouping as username sign-in. */
export function resetClientAddress(headers) {
  return clientBucket(
    headers.get("cf-connecting-ip")
      ?? headers.get("x-forwarded-for")?.split(",", 1)[0]
      ?? "unknown",
  );
}

/**
 * Calls account_api.account_resolve_username_reset_v1 (service role). Returns
 * { throttled, userId } or null when the function is missing or the answer is malformed.
 */
export async function resolveUsernameResetRpc({ args, fetchImpl, serviceRole, url }) {
  try {
    const response = await fetchImpl(`${url}/rest/v1/rpc/account_resolve_username_reset_v1`, {
      body: JSON.stringify(args),
      headers: {
        Accept: "application/json",
        "Accept-Profile": "account_api",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
        "Content-Profile": "account_api",
      },
      method: "POST",
      redirect: "error",
    });
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.throttled !== "boolean") return null;
    const resolved = rows[0].resolved_user_id;
    if (resolved !== null && !(typeof resolved === "string" && UUID.test(resolved))) return null;
    return { throttled: rows[0].throttled, userId: rows[0].throttled ? null : resolved };
  } catch {
    return null;
  }
}

/**
 * The provider recovery request: the same call supabase-js resetPasswordForEmail makes, with the
 * BROWSER's PKCE challenge, so the emailed link lands on /reset-password?recovery=1&code=... and is
 * exchanged by the browser that asked (the code verifier never leaves it).
 */
export function recoverRequest({ anonKey, captchaToken, codeChallenge, email, redirectTo, url }) {
  return [
    `${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      body: JSON.stringify({
        code_challenge: codeChallenge,
        code_challenge_method: "s256",
        email,
        gotrue_meta_security: { captcha_token: captchaToken },
      }),
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
    },
  ];
}

/**
 * deps:
 *   admitKey(requestKey)                      -> Promise<boolean>   public client key admission
 *   resolve({ normalized, clientKey, pairKey }) -> Promise<{ throttled, userId } | null>
 *   findRecipient(userId)                     -> Promise<string | null>  (background only)
 *   sendRecovery({ email, codeChallenge, redirectTo, captchaToken }) -> Promise<unknown> (background only)
 *   background(promise)                       schedules work that must not delay the answer
 *   sha256(text)                              -> Promise<hex>
 *   now(), sleep(ms)                          clock (injectable for tests)
 */
export function createUsernameResetHandler({
  admitKey,
  background,
  findRecipient,
  minimumResponseMs = MINIMUM_RESPONSE_MS,
  now = () => Date.now(),
  resolve,
  sendRecovery,
  sha256,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
}) {
  async function deliver(userId, parsed) {
    try {
      const email = await findRecipient(userId);
      if (!email) return;
      await sendRecovery({
        captchaToken: parsed.captchaToken,
        codeChallenge: parsed.codeChallenge,
        email,
        redirectTo: parsed.redirectTo,
      });
    } catch {
      // Best effort and invisible to the caller by design: the answer was already the fixed one.
    }
  }

  return async function handle(request) {
    const origin = request.headers.get("origin") ?? "";
    if (request.method === "OPTIONS" && ALLOWED_ORIGINS.has(origin)) {
      return new Response(null, { headers: corsHeaders(origin), status: 204 });
    }
    const started = now();
    const respond = async (status, payload, extra) => {
      const wait = minimumResponseMs - (now() - started);
      if (wait > 0) await sleep(wait);
      return json(status, payload, origin, extra);
    };
    const invalid = () => respond(400, { code: RESET_INVALID_CODE });

    if (request.method !== "POST" || !ALLOWED_ORIGINS.has(origin)) return invalid();
    const requestKey = request.headers.get("apikey") ?? "";
    if (!requestKey || !await admitKey(requestKey).catch(() => false)) return invalid();
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return invalid();
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return invalid();

    let parsed;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return invalid();
      parsed = parseResetBody(JSON.parse(text));
    } catch {
      return invalid();
    }
    if (!parsed) return invalid();

    const normalized = parsed.identifier.toLowerCase();
    const { clientKey, pairKey } = await resetAttemptKeys(normalized, resetClientAddress(request.headers), sha256);
    let resolution = null;
    try {
      resolution = await resolve({ clientKey, normalized, pairKey });
    } catch {
      resolution = null;
    }
    if (!resolution) return respond(503, { code: RESET_UNAVAILABLE_CODE });
    if (resolution.throttled) return respond(429, { code: RESET_THROTTLED_CODE }, { "Retry-After": "900" });
    if (resolution.userId) {
      try {
        background(deliver(resolution.userId, parsed));
      } catch {
        // A scheduler failure must not change the answer.
      }
    }
    return respond(200, RESET_ACCEPTED);
  };
}
