/**
 * Standard Webhooks (https://www.standardwebhooks.com/) signature verification
 * with Web Crypto HMAC-SHA256. No dependencies, so it runs in Deno and Node.
 *
 * signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
 * webhook-signature = space separated list of `v1,<base64 HMAC>` entries.
 * Secret form from Supabase: `v1,whsec_<base64>`.
 */

export const TIMESTAMP_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

export class WebhookVerificationError extends Error {
  constructor(reason) {
    super("Webhook verification failed");
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Accepts `v1,whsec_<base64>`, `whsec_<base64>` or bare base64. */
export function decodeWebhookSecret(secret) {
  if (typeof secret !== "string" || !secret) throw new WebhookVerificationError("secret_missing");
  const trimmed = secret.trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  try {
    const bytes = base64ToBytes(trimmed);
    if (bytes.length === 0) throw new Error("empty");
    return bytes;
  } catch {
    throw new WebhookVerificationError("secret_malformed");
  }
}

async function hmacSha256(secretBytes, content) {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(content)));
}

/** Compare equal-purpose byte arrays without an early exit on the first mismatch. */
export function constantTimeEqual(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Compute the `v1,<base64>` signature for a webhook (used by tests and by
 * verification). `timestamp` is epoch seconds as a string or number.
 */
export async function signWebhook(secret, id, timestamp, body) {
  const signature = await hmacSha256(decodeWebhookSecret(secret), `${id}.${timestamp}.${body}`);
  return `v1,${bytesToBase64(signature)}`;
}

/**
 * Verify the three webhook headers against the raw request body. Throws
 * WebhookVerificationError (generic message, specific `reason` for logs) on any
 * failure; resolves to undefined on success.
 */
export async function verifyWebhook({ secret, headers, body, nowSeconds }) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) throw new WebhookVerificationError("headers_missing");

  if (!/^\d{1,12}$/.test(timestamp)) throw new WebhookVerificationError("timestamp_malformed");
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TIMESTAMP_TOLERANCE_SECONDS) {
    throw new WebhookVerificationError("timestamp_out_of_tolerance");
  }

  const expected = await hmacSha256(decodeWebhookSecret(secret), `${id}.${timestamp}.${body}`);
  let matched = false;
  for (const entry of signatureHeader.split(" ")) {
    const separator = entry.indexOf(",");
    if (separator < 0 || entry.slice(0, separator) !== "v1") continue;
    let candidate;
    try {
      candidate = base64ToBytes(entry.slice(separator + 1));
    } catch {
      continue;
    }
    // Evaluate every candidate; do not short-circuit on the first match.
    if (constantTimeEqual(candidate, expected)) matched = true;
  }
  if (!matched) throw new WebhookVerificationError("signature_mismatch");
}
