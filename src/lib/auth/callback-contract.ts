import {
  accountContract,
  containsUrlTokenMaterial,
  sanitizeReturnTarget,
} from "@/config/account";

const CONFIRM_TYPES = new Set([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

export type ConfirmPayload = {
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
    tokenHash,
    type: type as ConfirmPayload["type"],
    returnTo: sanitizeReturnTarget(url.searchParams.get("returnTo")),
  };
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
