const MODERN_PUBLISHABLE_KEY_PATTERN =
  /^sb_publishable_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{8}$/;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const SETUP_PENDING_BUILD_ERROR =
  "Shared account configuration is not ready for a public build.";

function decodeBase64Url(segment) {
  if (!JWT_SEGMENT_PATTERN.test(segment) || segment.length % 4 === 1) return null;

  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      segment.length + ((4 - (segment.length % 4)) % 4),
      "=",
    );
    const binary = globalThis.atob(padded);
    const canonical = globalThis
      .btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/u, "");
    if (canonical !== segment) return null;

    return binary;
  } catch {
    return null;
  }
}

function decodeJwtJsonSegment(segment) {
  const binary = decodeBase64Url(segment);
  if (binary === null) return null;

  try {
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(decoded);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isLegacyAnonymousKey(value) {
  const segments = value.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) return false;
  if (decodeBase64Url(segments[2]) === null) return false;

  const header = decodeJwtJsonSegment(segments[0]);
  const payload = decodeJwtJsonSegment(segments[1]);
  if (!header || !payload) return false;

  return (
    header.alg === "HS256" &&
    (header.typ === undefined || header.typ === "JWT") &&
    payload.role === "anon"
  );
}

/**
 * Admits only Supabase key forms documented as safe for public browser clients.
 * The key value is intentionally never included in an error or diagnostic.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isBrowserSafeSupabasePublicKey(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    return false;
  }

  return MODERN_PUBLISHABLE_KEY_PATTERN.test(value) || isLegacyAnonymousKey(value);
}

/**
 * Missing configuration keeps the static portal in setup-pending mode. Any supplied but
 * inadmissible value stops the build before Next.js can inline it into a browser bundle.
 *
 * @param {string | undefined} value
 */
export function assertBrowserSafeSupabasePublicKeyForBuild(value) {
  if (value === undefined || value === "") return;
  if (!isBrowserSafeSupabasePublicKey(value)) {
    throw new Error(SETUP_PENDING_BUILD_ERROR);
  }
}
