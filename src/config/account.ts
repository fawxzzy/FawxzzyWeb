import { apps } from "@/data/apps";
import { productIdentity } from "@/config/product";

function requireAppOrigin(slug: "fitness" | "mazer") {
  const app = apps.find((candidate) => candidate.slug === slug);
  if (!app) throw new Error(`Missing ${slug} origin contract.`);
  const compatibility = app.origin.preserveOnCutover[0];
  if (!compatibility) throw new Error(`Missing ${slug} compatibility origin.`);
  return {
    compatibility,
    current: app.origin.current,
    planned: app.origin.plannedCanonical,
  };
}

const fitnessOrigin = requireAppOrigin("fitness");
const mazerOrigin = requireAppOrigin("mazer");

export type AccountExperienceContextId = "website" | "fitness" | "mazer";

export type AccountExperienceContext = {
  accentRgb: string;
  consumerIntegration: "active" | "pending";
  destinationOrigin: string;
  id: AccountExperienceContextId;
  legalLinks: ReadonlyArray<{
    href: string;
    label: string;
  }>;
  productName: string;
  resetLabel: string;
  signInLabel: string;
  signUpLabel: string;
};

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
    "http://localhost:4312",
    "http://127.0.0.1:4312",
    "http://localhost:4313",
    "http://127.0.0.1:4313",
  ],
  storageKey: "fawxzzy.account.auth.v1",
  rememberedIdentityKey: "fawxzzy.account.remembered-identity.v1",
  callbackStateKey: "fawxzzy.account.callback.state.v1",
  callbackReceiptPrefix: "fawxzzy.account.callback.receipt.v1",
} as const;

/**
 * Presentation-only account contexts. These values may change copy, color,
 * legal destinations, and the eventual allowlisted return destination. They
 * never select an Auth provider, callback, session, or credential boundary.
 * Every registered presentation is safe to render on the account host. Fitness
 * and Mazer consumer integration remains pending until their owner repositories
 * adopt the broker contract from reviewed exact heads.
 */
export const accountExperienceContexts: Record<
  AccountExperienceContextId,
  AccountExperienceContext
> = {
  website: {
    accentRgb: "147 184 148",
    consumerIntegration: "active",
    destinationOrigin: accountContract.publicHubOrigin,
    id: "website",
    legalLinks: [],
    productName: productIdentity.publicName,
    resetLabel: "Send recovery link",
    signInLabel: "Sign in",
    signUpLabel: "Create account",
  },
  fitness: {
    accentRgb: "160 223 56",
    consumerIntegration: "pending",
    destinationOrigin: accountContract.productOrigins.fitness,
    id: "fitness",
    legalLinks: [
      {
        href: new URL("/privacy", fitnessOrigin.current).href,
        label: "Privacy Policy",
      },
      {
        href: new URL("/terms", fitnessOrigin.current).href,
        label: "Terms of Service",
      },
    ],
    productName: "Fitness",
    resetLabel: "Send recovery link",
    signInLabel: "Sign in",
    signUpLabel: "Create account",
  },
  mazer: {
    accentRgb: "53 238 224",
    consumerIntegration: "pending",
    destinationOrigin: accountContract.productOrigins.mazer,
    id: "mazer",
    legalLinks: [],
    productName: "Mazer",
    resetLabel: "Send recovery link",
    signInLabel: "Sign in",
    signUpLabel: "Create account",
  },
};

export function resolveAccountExperienceContext(rawContext: unknown) {
  if (typeof rawContext !== "string") return accountExperienceContexts.website;
  if (!Object.prototype.hasOwnProperty.call(accountExperienceContexts, rawContext)) {
    return accountExperienceContexts.website;
  }

  return accountExperienceContexts[rawContext as AccountExperienceContextId];
}

export const accountUrls = {
  login: `${accountContract.canonicalOrigin}${accountContract.loginPath}`,
  account: `${accountContract.canonicalOrigin}${accountContract.accountPath}`,
  confirm: `${accountContract.canonicalOrigin}${accountContract.confirmPath}`,
  callback: `${accountContract.canonicalOrigin}${accountContract.callbackPath}`,
  recovery: `${accountContract.canonicalOrigin}${accountContract.recoveryPath}`,
} as const;

export function accountRecoveryUrl(contextId: AccountExperienceContextId) {
  const url = new URL(accountContract.recoveryPath, accountContract.canonicalOrigin);
  if (contextId !== "website") url.searchParams.set("app", contextId);
  return url.href;
}

export function accountConfirmUrl(contextId: AccountExperienceContextId) {
  if (contextId === "website") return accountUrls.confirm;
  const context = accountExperienceContexts[contextId];
  const url = new URL(accountContract.confirmPath, accountContract.canonicalOrigin);
  url.searchParams.set("app", contextId);
  url.searchParams.set("returnTo", new URL("/", context.destinationOrigin).href);
  return url.href;
}

export type RuntimeOriginKind =
  | "account"
  | "hub"
  | "local-test"
  | "preview"
  | "foreign";

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

export function accountCanonicalUrl(path: string) {
  return new URL(path, accountContract.canonicalOrigin).href;
}
