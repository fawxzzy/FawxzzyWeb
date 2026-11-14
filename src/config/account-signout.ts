import { accountContract } from "@/config/account";

/**
 * Where /signout may send the person once the account session is ended. This is a strict
 * allowlist of ORIGINS: the Mazer product origin and the account host itself. The hub
 * (fawxzzy.com), Fitness and the *.vercel.app compatibility origins are deliberately not on it.
 * Anything else (a lookalike host, another scheme or port, credentials, a non-URL, a relative
 * path that resolves elsewhere) falls back to the account sign-in page, so the endpoint cannot be
 * used as an open redirect.
 */
export const SIGNOUT_ALLOWED_ORIGINS: readonly string[] = [
  accountContract.productOrigins.mazer,
  accountContract.canonicalOrigin,
];

export const SIGNOUT_RETURN_PARAM = "returnTo";

const MAX_RETURN_LENGTH = 2048;
// ASCII control characters and the backslash (browsers treat "\" as "/" in special-scheme URLs).
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f\\]/u;

/**
 * Returns the absolute URL to continue to after sign-out. `accountOrigin` is the origin the page
 * is running on (the production account host, or an approved local test origin, which then counts
 * as "the account host itself" so the same logic is testable). Only the origin, path and query of
 * the target are kept: the fragment and any credentials are dropped. A target that points back at
 * /signout would loop, so it also falls back to the sign-in page.
 */
export function resolveSignOutDestination(
  rawReturnTo: string | null | undefined,
  accountOrigin: string = accountContract.canonicalOrigin,
): string {
  const fallback = new URL(accountContract.loginPath, accountOrigin).href;
  const raw = typeof rawReturnTo === "string" ? rawReturnTo.trim() : "";
  if (
    raw.length === 0 ||
    raw.length > MAX_RETURN_LENGTH ||
    FORBIDDEN_CHARACTERS.test(raw) ||
    raw.startsWith("//") ||
    // Only an absolute http(s) URL or a path on the account host is understood; a bare word such
    // as "evil.example" or a percent-encoded URL would otherwise become a junk path here.
    !(raw.startsWith("/") || /^https?:\/\//iu.test(raw))
  ) {
    return fallback;
  }

  let target: URL;
  try {
    // A single-slash path is resolved against the account host; everything else must be absolute.
    target = new URL(raw, accountOrigin);
  } catch {
    return fallback;
  }

  const accountUrl = new URL(accountOrigin);
  const allowed = new Set<string>([...SIGNOUT_ALLOWED_ORIGINS, accountUrl.origin]);
  if (
    // blob: and similar schemes report the origin of the URL they wrap, so the scheme is checked too.
    (target.protocol !== "https:" && target.protocol !== accountUrl.protocol) ||
    target.username ||
    target.password ||
    !allowed.has(target.origin) ||
    target.pathname === "/signout" ||
    target.pathname.startsWith("/signout/")
  ) {
    return fallback;
  }

  return `${target.origin}${target.pathname}${target.search}`;
}
