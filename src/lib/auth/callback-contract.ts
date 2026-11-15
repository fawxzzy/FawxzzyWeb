import { accountContract } from "@/config/account";
import {
  containsUrlTokenMaterial,
  sanitizeReturnTarget,
} from "@/config/account-return";
import { fitnessReturnPath } from "@/lib/auth/fitness-handoff";

const CONFIRM_TYPES = new Set([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

export type ConfirmPayload = {
  state: string;
  tokenHash: string;
  type: "email" | "email_change" | "invite" | "magiclink" | "recovery" | "signup";
  returnTo: string;
};

export type CallbackPayload = {
  code: string;
  state: string;
  returnTo: string;
};

export type RecoveryPayload = {
  code: string | null;
};

export function parseConfirmPayload(url: URL): ConfirmPayload | null {
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const type = url.searchParams.get("type") ?? "";

  if (!tokenHash || !CONFIRM_TYPES.has(type)) return null;

  return {
    state: url.searchParams.get("state") ?? "",
    tokenHash,
    type: type as ConfirmPayload["type"],
    returnTo: sanitizeReturnTarget(url.searchParams.get("returnTo")),
  };
}

export function confirmationStateMatches(received: string, stored: string | null) {
  return Boolean(received && stored && received === stored);
}

export function parseCallbackPayload(url: URL): CallbackPayload | null {
  if (url.hash || url.searchParams.has("access_token") || url.searchParams.has("refresh_token")) {
    return null;
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) return null;

  return {
    code,
    state,
    returnTo: sanitizeReturnTarget(url.searchParams.get("returnTo")),
  };
}

export function parseRecoveryPayload(url: URL): RecoveryPayload | null {
  if (
    url.hash ||
    url.searchParams.get("recovery") !== "1" ||
    url.searchParams.getAll("recovery").length !== 1 ||
    url.searchParams.getAll("code").length > 1 ||
    ["access_token", "refresh_token", "token", "token_hash", "state"].some((key) =>
      url.searchParams.has(key),
    )
  ) {
    return null;
  }

  const code = url.searchParams.get("code")?.trim() || null;
  return { code };
}

export function callbackReceiptKey(code: string) {
  let checksum = 0;
  for (const character of code) checksum = (checksum * 31 + character.charCodeAt(0)) >>> 0;
  return `${accountContract.callbackReceiptPrefix}:${checksum.toString(16)}`;
}

export function callbackStateMatches(received: string, stored: string | null) {
  return Boolean(received && stored && received === stored);
}

/**
 * The last check before a confirm or callback link moves the browser (defence in depth: every
 * destination is already built from a sanitized `returnTo`). Allowed: a `sanitizeReturnTarget`
 * result, or the exact Fitness landing a completed handoff returns (`<fitness origin>` plus `/`,
 * `/entry` or `/today`, nothing else). Anything else becomes the account page.
 */
export function sanitizeLinkDestination(destination: string | null | undefined) {
  if (destination) {
    try {
      const url = new URL(destination);
      const fitnessOrigin = new URL(accountContract.productOrigins.fitness).origin;
      if (url.origin === fitnessOrigin && destination === `${fitnessOrigin}${fitnessReturnPath(destination)}`) {
        return destination;
      }
    } catch {
      // Not an absolute URL: only the return-target rules below apply.
    }
  }
  return sanitizeReturnTarget(destination);
}

export function sanitizeAuthUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (containsUrlTokenMaterial(url)) {
    window.history.replaceState({}, "", url.pathname);
  }
}

export function sanitizeRecoveryUrl() {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, "", accountContract.recoveryPath);
}
