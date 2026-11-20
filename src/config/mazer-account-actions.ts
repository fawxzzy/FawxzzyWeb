import { accountContract } from "@/config/account";

/**
 * MAZER-UI-100: the account page is the ONLY place a Mazer player signs out or resets their Mazer
 * progress. Both actions finish inside Mazer, because Mazer keeps its own session and its own copy of
 * the progress on its own origin (a server-only reset would be merged straight back by the app, and
 * ending the account-host session alone leaves Mazer signed in). So the account page hands back with
 * one closed-set query key and nothing else:
 *
 *   https://mazer.fawxzzy.com/?accountAction=signed-out      after the account page's Sign out
 *   https://mazer.fawxzzy.com/?accountAction=reset-progress  from the Reset progress row
 *
 * No token, code, user id or secret is ever in the URL. Mazer reads the key once, strips it from the
 * address bar, honours `signed-out` only when the page was reached from this host (referrer check,
 * so a third-party link cannot sign a player out), and answers `reset-progress` with its existing
 * confirmation screen (nothing is reset until the player confirms there). Mazer side:
 * src/legacy-runtime/legacyAccountActionHandoff.ts in fawxzzy/mazer.
 */
export const MAZER_ACCOUNT_ACTION_PARAM = "accountAction";

export const MAZER_ACCOUNT_ACTIONS = ["signed-out", "reset-progress"] as const;

export type MazerAccountAction = (typeof MAZER_ACCOUNT_ACTIONS)[number];

/** The Mazer URL an account-page action continues to: the product origin root plus the one key. */
export function mazerAccountActionUrl(
  action: MazerAccountAction,
  mazerOrigin: string = accountContract.productOrigins.mazer,
): string {
  const url = new URL("/", mazerOrigin);
  url.searchParams.set(MAZER_ACCOUNT_ACTION_PARAM, action);
  return url.href;
}
