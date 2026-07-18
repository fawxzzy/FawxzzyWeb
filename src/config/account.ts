import { apps } from "@/data/apps";

function requireAppOrigin(slug: "fitness" | "mazer") {
  const app = apps.find((candidate) => candidate.slug === slug);
  if (!app) throw new Error(`Missing ${slug} origin contract.`);
  const compatibility = app.origin.preserveOnCutover[0];
  if (!compatibility) throw new Error(`Missing ${slug} compatibility origin.`);
  return { compatibility, planned: app.origin.plannedCanonical };
}

const fitnessOrigin = requireAppOrigin("fitness");
const mazerOrigin = requireAppOrigin("mazer");

export const accountContract = {
  canonicalOrigin: "https://account.fawxzzy.com",
  publicHubOrigin: "https://fawxzzy.com",
  loginPath: "/login",
  accountPath: "/account",
  confirmPath: "/auth/confirm",
  callbackPath: "/auth/callback",
  recoveryPath: "/reset-password?recovery=1",
  productOrigins: {
    fitness: fitnessOrigin.planned,
    mazer: mazerOrigin.planned,
  },
  compatibilityOrigins: {
    fitness: fitnessOrigin.compatibility,
    mazer: mazerOrigin.compatibility,
  },
  localTestOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3210",
    "http://127.0.0.1:3210",
  ],
  storageKey: "fawxzzy.account.auth.v1",
  callbackStateKey: "fawxzzy.account.callback.state.v1",
  callbackReceiptPrefix: "fawxzzy.account.callback.receipt.v1",
} as const;

export const accountUrls = {
  login: `${accountContract.canonicalOrigin}${accountContract.loginPath}`,
  account: `${accountContract.canonicalOrigin}${accountContract.accountPath}`,
  confirm: `${accountContract.canonicalOrigin}${accountContract.confirmPath}`,
  callback: `${accountContract.canonicalOrigin}${accountContract.callbackPath}`,
  recovery: `${accountContract.canonicalOrigin}${accountContract.recoveryPath}`,
} as const;

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

export type RuntimeOriginKind =
  | "account"
  | "hub"
  | "local-test"
  | "preview"
  | "foreign";

function hasTokenMaterial(url: URL) {
  if (url.hash) {
    return true;
  }

  return [...url.searchParams.keys()].some((key) =>
    TOKEN_QUERY_KEYS.has(key.toLowerCase()),
  );
}

export function classifyRuntimeOrigin(rawOrigin: string): RuntimeOriginKind {
  try {
    const origin = new URL(rawOrigin).origin;
    if (origin === accountContract.canonicalOrigin) return "account";
    if (origin === accountContract.publicHubOrigin) return "hub";
    if (accountContract.localTestOrigins.some((candidate) => candidate === origin)) {
      return "local-test";
    }

    const url = new URL(origin);
    if (url.protocol === "https:" && url.hostname.endsWith(".vercel.app")) {
      return "preview";
    }
  } catch {
    return "foreign";
  }

  return "foreign";
}

export function isLocalAuthTestOrigin(rawOrigin: string) {
  return classifyRuntimeOrigin(rawOrigin) === "local-test";
}

export function isLiveAccountAdapterOrigin(rawOrigin: string) {
  const kind = classifyRuntimeOrigin(rawOrigin);
  return kind === "account" || kind === "local-test";
}

export function sanitizeReturnTarget(rawTarget: string | null | undefined) {
  if (!rawTarget) return accountContract.accountPath;
  if (rawTarget.startsWith("//") || rawTarget.includes("\\")) {
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
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      hasTokenMaterial(url) ||
      url.search ||
      url.pathname !== "/" ||
      !EXACT_EXTERNAL_RETURN_TARGETS.has(url.href)
    ) {
      return accountContract.accountPath;
    }

    return url.href;
  } catch {
    return accountContract.accountPath;
  }
}

export function accountCanonicalUrl(path: string) {
  return new URL(path, accountContract.canonicalOrigin).href;
}

export function containsUrlTokenMaterial(url: URL) {
  return hasTokenMaterial(url);
}
