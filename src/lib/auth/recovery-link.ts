import { accountContract, type AccountExperienceContextId } from "@/config/account";
import type { AuthMessageId } from "@/lib/auth/copy-matrix";

/**
 * Recovery links that work in any browser (2026-11-26).
 *
 * The emailed recovery link opens the confirm route, `/auth/confirm?token_hash=...&type=recovery`
 * (built by supabase/functions/auth-send-email/plan.mjs). That page calls verifyOtp: the provider
 * checks the one-time token itself (POST /auth/v1/verify with token_hash + type) and answers with
 * the recovery session. No PKCE code verifier is involved, so it does not matter which browser asked
 * for the link. The page then moves to the reset form, or back to the request form with the reason.
 *
 * Pure: no DOM, no provider calls. Every destination is built from constants plus the two values
 * the reset page already allows (`app`, and `returnTo` only as the Mazer authorization path), so a
 * hostile `returnTo`, `next` or `redirect_to` on the link can never move the browser anywhere else.
 */

/** Reset-page query key that names why a recovery link could not be used. */
export const RESET_LINK_PARAM = "link";

export type RecoveryLinkFailure = "expired" | "invalid";

const RESET_LINK_NOTICES: Record<RecoveryLinkFailure, AuthMessageId> = {
  expired: "reset.expired",
  invalid: "reset.invalid",
};

/** The only continuation the reset page keeps (same rule as accountRecoveryUrl/contextualPath). */
const MAZER_AUTHORIZE = "/oauth/authorize";

/**
 * The provider answers a used, wrong or expired token the same way (403 `otp_expired`, "Email link
 * is invalid or has expired"), so all of those read as an expired link. Anything else (malformed
 * link, provider or network failure) reads as a link that did not work. Either way the person gets
 * the request form with one line and can send a new link.
 */
export function recoveryLinkFailure(error: unknown): RecoveryLinkFailure {
  const shape = typeof error === "object" && error !== null ? (error as { code?: unknown; status?: unknown }) : {};
  if (shape.code === "otp_expired" || shape.status === 403) return "expired";
  return "invalid";
}

/** Allowlisted reset-page notice for `?link=`; anything else shows nothing. */
export function resetLinkNotice(value: string | null | undefined): AuthMessageId | null {
  return value === "expired" || value === "invalid" ? RESET_LINK_NOTICES[value] : null;
}

/**
 * Where an opened recovery link goes next: the new-password form (`/reset-password?recovery=1`) when
 * the provider accepted the token, else the request form with `?link=<reason>`. `rawReturnTo` is the
 * link's own `returnTo`; it survives only as the exact Mazer authorization path for the Mazer app.
 */
export function recoveryLandingPath(
  contextId: AccountExperienceContextId,
  rawReturnTo: string | null | undefined,
  failure?: RecoveryLinkFailure,
) {
  const url = new URL(
    failure ? `/reset-password?${RESET_LINK_PARAM}=${failure}` : accountContract.recoveryPath,
    accountContract.canonicalOrigin,
  );
  if (contextId === "fitness" || contextId === "mazer") url.searchParams.set("app", contextId);
  if (contextId === "mazer" && rawReturnTo === MAZER_AUTHORIZE) url.searchParams.set("returnTo", MAZER_AUTHORIZE);
  return `${url.pathname}${url.search}`;
}

/**
 * Resend wait for a reset link, kept in this browser's storage so a reload or a second tab cannot
 * ask again while the provider would still refuse to send (it sends at most one recovery email per
 * account per minute and answers a second request in that minute without sending anything). A repeat
 * from ANOTHER browser is caught server-side: the username path answers `reset_wait` (the account's
 * 65-second send window in the database; the email path gets the provider's own 429). Only a
 * timestamp is stored: no username, no address.
 */
export const RESET_RESEND_SECONDS = 60;
/**
 * The username path's resend countdown after a send: the server's send window (the provider's minute
 * counted from its own, slightly later send, so 5 s longer; keep equal to SEND_WINDOW_SECONDS in
 * supabase/functions/username-password-reset/handler.mjs and send_window in the v2 SQL, pinned by a test).
 * A reload restores RESET_RESEND_SECONDS from storage; the server's reset_wait covers the last 5 s.
 */
export const RESET_USERNAME_RESEND_SECONDS = 65;
export const RESET_SENT_AT_KEY = "fawxzzy.account.reset-sent-at";

type WaitStorage = Pick<Storage, "getItem" | "setItem">;

export function recordResetSent(storage: WaitStorage | null | undefined, nowMs: number) {
  try {
    storage?.setItem(RESET_SENT_AT_KEY, String(Math.floor(nowMs)));
  } catch {
    // Storage off (private mode, quota): the in-page countdown still applies.
  }
}

/** Whole seconds left before another reset link may be asked for from this browser (0 = now). */
export function resetWaitRemaining(storage: WaitStorage | null | undefined, nowMs: number) {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(RESET_SENT_AT_KEY) ?? null;
  } catch {
    return 0;
  }
  if (!raw || !/^\d{1,15}$/.test(raw)) return 0;
  const elapsed = nowMs - Number(raw);
  // A timestamp in the future (clock moved back, edited value) never locks the form.
  if (elapsed < 0) return 0;
  return Math.max(0, Math.ceil((RESET_RESEND_SECONDS * 1000 - elapsed) / 1000));
}
