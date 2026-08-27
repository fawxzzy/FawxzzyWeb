import {
  accountContract,
  type AccountExperienceContext,
} from "@/config/account";

const TOKEN_QUERY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "token",
  "token_hash",
  "code",
  "state",
]);

const EXACT_EXTERNAL_RETURN_TARGETS = new Set([
  `${accountContract.publicHubOrigin}/`,
  `${accountContract.productOrigins.fitness}/`,
  `${accountContract.productOrigins.mazer}/`,
  `${accountContract.compatibilityOrigins.fitness}/`,
  `${accountContract.compatibilityOrigins.mazer}/`,
]);

const EXACT_INTERNAL_RETURN_TARGETS = new Set<string>([
  accountContract.accountPath,
  accountContract.recoveryPath,
]);

function hasTokenMaterial(url: URL) {
  return Boolean(url.hash) || [...url.searchParams.keys()].some((key) =>
    TOKEN_QUERY_KEYS.has(key.toLowerCase()),
  );
}

export function sanitizeReturnTarget(rawTarget: string | null | undefined) {
  if (!rawTarget || rawTarget.startsWith("//") || rawTarget.includes("\\")) {
    return accountContract.accountPath;
  }

  if (rawTarget.startsWith("/")) {
    try {
      const url = new URL(rawTarget, accountContract.canonicalOrigin);
      const relativeTarget = `${url.pathname}${url.search}`;
      if (
        url.origin === accountContract.canonicalOrigin &&
        EXACT_INTERNAL_RETURN_TARGETS.has(relativeTarget) &&
        !url.username &&
        !url.password &&
        !hasTokenMaterial(url)
      ) {
        return relativeTarget;
      }
    } catch {
      return accountContract.accountPath;
    }
    return accountContract.accountPath;
  }

  try {
    const url = new URL(rawTarget);
    const nestedTarget = url.searchParams.get("returnTo");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.search &&
        (url.searchParams.size !== 1 ||
          nestedTarget === null ||
          !/^\/(?!\/)[^?#\\]*$/.test(nestedTarget))) ||
      !EXACT_EXTERNAL_RETURN_TARGETS.has(`${url.origin}/`)
    ) {
      return accountContract.accountPath;
    }
    return url.href;
  } catch {
    return accountContract.accountPath;
  }
}

export function sanitizeContextReturnTarget(
  rawTarget: string | null | undefined,
  context: AccountExperienceContext,
) {
  const fallback = new URL("/", context.destinationOrigin).href;
  const sanitized = sanitizeReturnTarget(rawTarget);

  try {
    const target = new URL(sanitized);
    return target.origin === new URL(context.destinationOrigin).origin
      ? target.href
      : fallback;
  } catch {
    return fallback;
  }
}

export function containsUrlTokenMaterial(url: URL) {
  return hasTokenMaterial(url);
}
