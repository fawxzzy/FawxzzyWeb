import { clientBucket } from "./client-bucket.mjs";

/**
 * The client address used for every throttle key. Only `cf-connecting-ip` is trusted: Cloudflare sets it and a caller
 * cannot choose it, whereas `x-forwarded-for` is a list the caller can start with any value, so using it as a fallback
 * would let one caller mint unlimited client keys and defeat the per-client, per-pair and global limits. A missing or
 * unparsable header shares the single "unknown" bucket, which the database gives a strict failure budget.
 */
export function clientAddressFromHeaders(headers) {
  return clientBucket(headers.get("cf-connecting-ip") ?? "unknown");
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * RPC argument sets for every installed generation of the throttle (the Edge Function tries v5, then v4, then v3).
 * `client` is the bucketed address from `clientAddressFromHeaders`; `normalized` is the lower-case username (it matches
 * /^[a-z0-9._-]{2,15}$/ and so can never contain the "|" delimiter used in the v5 pair key).
 * v5 keys: the lock is per (username, client) at 10 failures, per username at 50 failures, per client at 30 failures
 * (10 for the "unknown" bucket) and global at 500 failures, all counting failed password checks only.
 */
export async function deriveThrottleKeys({ client, hash = sha256Hex, normalized }) {
  const [v3Username, v3Client, v4Aggregate, v4Pair, v5Aggregate, v5Client, v5Pair] = await Promise.all([
    hash(`username:${normalized}`),
    hash(`client:${client}`),
    hash(`username-aggregate-v4:${normalized}`),
    hash(`username-client-v4:${normalized}:${client}`),
    hash(`username-aggregate-v5:${normalized}`),
    hash(`client-failure-v5:${client}`),
    hash(`username-client-v5:${normalized}|${client}`),
  ]);
  return {
    v3: {
      p_attempt_key: v3Username,
      p_client_attempt_key: v3Client,
      p_normalized_username: normalized,
    },
    v4: {
      p_attempt_key: v4Aggregate,
      p_client_attempt_key: v3Client,
      p_normalized_username: normalized,
      p_pair_attempt_key: v4Pair,
    },
    v5: {
      p_attempt_key: v5Aggregate,
      p_client_attempt_key: v5Client,
      p_normalized_username: normalized,
      p_pair_attempt_key: v5Pair,
    },
  };
}
