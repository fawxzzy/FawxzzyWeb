// Request handling for the username-password-reset Edge Function, kept free of Deno APIs so the
// repo's node tests (tests/username-password-reset.test.mjs) and the pglite scratch test drive the
// exact code that ships. index.ts only wires environment, fetch and the background-task hook.
//
// Contract (design direction #9): signed out, a reset request carries a USERNAME, never an email.
//   POST { identifier, code_challenge, code_challenge_method: "s256", redirect_to, captchaToken? }
//   200 { status: "accepted" }          for EVERY well-formed, admitted request: known, unknown,
//                                        banned, unconfirmed or email-less usernames alike
//   429 { code: "reset_throttled" }     rate limit, decided before and independent of existence
//   429 { code: "reset_wait" }          the account's 60-second send window is held (the provider sends one
//                                        recovery email per account per minute): no email goes out, and the
//                                        form says so. Keyed by account id (or by name for a username with no
//                                        account), so known and unknown usernames wait identically.
//   503 { code: "reset_unavailable" }   resolver missing or failing (same for every username)
//   400 { code: "reset_invalid" }       malformed request (decided from the request alone)
// The answer never carries an email, a masked email or a user id. The lookup that differs between
// known and unknown usernames (account record) runs as a background task AFTER the answer is
// scheduled, and every answer is held to the same minimum duration, so neither the body nor the
// timing tells a caller whether the username has an account.
//
// Every accepted request makes exactly ONE provider recovery call, carrying the caller's captcha
// token: to the account's address when the username resolves to one that can receive mail, otherwise
// to DECOY_RECIPIENT. So once provider CAPTCHA is on, the token is spent at the provider for known
// and unknown usernames alike (a replayed token cannot tell them apart), and no real mailbox gets
// mail for a miss.
import { clientBucket } from "../username-password-signin/client-bucket.mjs";

export const USERNAME = /^[A-Za-z0-9._-]{2,15}$/;
export const ALLOWED_ORIGINS = new Set(["https://account.fawxzzy.com"]);
export const RESET_ACCEPTED = Object.freeze({ status: "accepted" });
export const RESET_THROTTLED_CODE = "reset_throttled";
export const RESET_WAIT_CODE = "reset_wait";
/** The send window in seconds (the SQL's send_window); only bounds Retry-After here. */
export const SEND_WINDOW_SECONDS = 60;
export const RESET_UNAVAILABLE_CODE = "reset_unavailable";
export const RESET_INVALID_CODE = "reset_invalid";
/** Every answer (except the CORS preflight) takes at least this long. */
export const MINIMUM_RESPONSE_MS = 900;
export const MAX_BODY_BYTES = 4096;
/**
 * Where a miss's provider recovery call goes. `.invalid` is reserved (RFC 2606 / RFC 6761): it never
 * resolves, so nothing can be delivered there, and the provider answers a recover request for an
 * address with no account without sending anything. Go-live check: no auth user has this address.
 */
export const DECOY_RECIPIENT = "username-reset-decoy@fawxzzy.invalid";
/** The account id a miss looks up (same admin call as a hit). Fixed; go-live check: no account has it. */
export const DECOY_USER_ID = "00000000-0000-4000-8000-000000000000";
/**
 * The client address used for rate limiting comes ONLY from headers the platform sets, never from a
 * value the caller controls: Cloudflare's `cf-connecting-ip` (overwritten at Cloudflare's edge), else
 * the RIGHTMOST `x-forwarded-for` hop (appended by the nearest proxy; any entries to its left can be
 * forged by the caller). Which one the deployed runtime actually sets is a go-live proof step
 * (docs/shared-account-portal-phase1.md): a request with a forged x-forwarded-for must land in the
 * same bucket as one without it.
 */
export const CLIENT_ADDRESS_SOURCE = Object.freeze({
  fallback: "x-forwarded-for",
  fallbackHop: "rightmost",
  primary: "cf-connecting-ip",
});
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

/** Client address bucket from the platform-set source only (CLIENT_ADDRESS_SOURCE); IPv6 grouped by /64. */
export function resetClientAddress(headers) {
  const primary = headers.get(CLIENT_ADDRESS_SOURCE.primary)?.trim();
  if (primary) return clientBucket(primary);
  const hops = (headers.get(CLIENT_ADDRESS_SOURCE.fallback) ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return clientBucket(hops.length > 0 ? hops[hops.length - 1] : "unknown");
}

/**
 * The provider's public (client) key: the new publishable key first (SUPABASE_PUBLISHABLE_KEYS, a JSON
 * map or list; the "default" entry wins), else the legacy SUPABASE_ANON_KEY. `getEnv(name)` reads one
 * environment variable.
 */
export function providerPublicKey(getEnv) {
  try {
    const configured = JSON.parse(getEnv("SUPABASE_PUBLISHABLE_KEYS") ?? "null");
    if (Array.isArray(configured)) {
      const first = configured.find((value) => typeof value === "string" && value);
      if (first) return first;
    } else if (configured && typeof configured === "object") {
      if (typeof configured.default === "string" && configured.default) return configured.default;
      const first = Object.values(configured).find((value) => typeof value === "string" && value);
      if (first) return first;
    }
  } catch {
    // A malformed key map falls back to the legacy key.
  }
  return getEnv("SUPABASE_ANON_KEY") || null;
}

/** Non-identifying outcome of the background provider call: the HTTP status class only. */
export function sendOutcome(status) {
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) return "not_sent";
  return `${Math.floor(status / 100)}xx`;
}

/**
 * Reads the request body as text, refusing (null) as soon as it passes `limit` bytes, so an oversize
 * body is never buffered whole. Invalid UTF-8 is refused too.
 */
export async function readBodyLimited(request, limit = MAX_BODY_BYTES) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Calls account_api.account_resolve_username_reset_v2 (service role). Returns
 * { throttled, userId, waitSeconds } or null when the function is missing or the answer is malformed.
 * waitSeconds is 0 unless the account's send window is held (then 1..SEND_WINDOW_SECONDS, userId null).
 */
export async function resolveUsernameResetRpc({ args, fetchImpl, serviceRole, url }) {
  try {
    const response = await fetchImpl(`${url}/rest/v1/rpc/account_resolve_username_reset_v2`, {
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
    const waited = rows[0].wait_seconds;
    if (!Number.isInteger(waited) || waited < 0 || waited > SEND_WINDOW_SECONDS) return null;
    const throttled = rows[0].throttled;
    return { throttled, userId: throttled || waited > 0 ? null : resolved, waitSeconds: throttled ? 0 : waited };
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
  // A legacy anon key is a JWT and also goes in Authorization (what supabase-js sends); a new
  // publishable key (sb_publishable_...) is not a JWT and travels only as `apikey`.
  const isJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(anonKey);
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
        ...(isJwt ? { Authorization: `Bearer ${anonKey}` } : {}),
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
 *   resolve({ normalized, clientKey, pairKey }) -> Promise<{ throttled, userId, waitSeconds? } | null>
 *   findRecipient(userId)                     -> Promise<string | null>  (background only)
 *   sendRecovery({ email, codeChallenge, redirectTo, captchaToken }) -> Promise<number | null>
 *                                             provider HTTP status, null when not configured (background only)
 *   background(promise)                       schedules work that must not delay the answer
 *   log(entry)                                one non-identifying JSON-able line per background send:
 *                                             { event: "username_reset_send", outcome: "2xx" | "4xx" | ... }
 *                                             never a username, email, address, token or user id
 *   sha256(text)                              -> Promise<hex>
 *   now(), sleep(ms)                          clock (injectable for tests)
 */
export function createUsernameResetHandler({
  admitKey,
  background,
  findRecipient,
  log = () => undefined,
  minimumResponseMs = MINIMUM_RESPONSE_MS,
  now = () => Date.now(),
  resolve,
  sendRecovery,
  sha256,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
}) {
  const record = (outcome) => {
    try {
      log({ event: "username_reset_send", outcome });
    } catch {
      // Logging must never change behaviour.
    }
  };

  // Exactly one provider call per accepted request (see the header): the account's address when the
  // username resolves to one that can receive mail, otherwise the decoy. A miss still makes the same
  // account lookup (for DECOY_USER_ID, which no account has), so the provider call, and with it the
  // moment the captcha token is spent, comes after the same kind of work on both paths: a caller
  // racing a replay of its own token against this call gets no head start on one path.
  async function deliver(userId, parsed) {
    let email = null;
    try {
      email = await findRecipient(userId || DECOY_USER_ID);
    } catch {
      email = null;
    }
    if (!userId) email = null;
    try {
      const status = await sendRecovery({
        captchaToken: parsed.captchaToken,
        codeChallenge: parsed.codeChallenge,
        email: email || DECOY_RECIPIENT,
        redirectTo: parsed.redirectTo,
      });
      record(sendOutcome(status));
    } catch {
      // Best effort and invisible to the caller by design: the answer was already the fixed one.
      record("network_error");
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
      const text = await readBodyLimited(request, MAX_BODY_BYTES);
      if (text === null) return invalid();
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
    // The account's send window is held: nothing is sent (the provider would refuse silently), and the
    // caller is told so. The same for a known and an unknown username, so it reveals nothing.
    const waitSeconds = Number.isInteger(resolution.waitSeconds) ? resolution.waitSeconds : 0;
    if (waitSeconds > 0) {
      const retryAfter = Math.min(Math.max(waitSeconds, 1), SEND_WINDOW_SECONDS);
      return respond(429, { code: RESET_WAIT_CODE }, { "Retry-After": String(retryAfter) });
    }
    // Scheduled for EVERY accepted request (a miss goes to the decoy). The answer is still held to the
    // floor, so in normal operation the provider has already seen (and spent) the captcha token by the
    // time the caller gets the answer, for known and unknown usernames alike.
    try {
      background(deliver(resolution.userId, parsed));
    } catch {
      // A scheduler failure must not change the answer.
      record("schedule_error");
    }
    return respond(200, RESET_ACCEPTED);
  };
}
