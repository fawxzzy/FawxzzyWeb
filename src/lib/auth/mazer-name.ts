import type { AuthMessageId } from "@/lib/auth/copy-matrix";
import { isChangeBackendMissing } from "@/lib/auth/account-change";
import { USERNAME_PATTERN } from "@/lib/auth/form-guidance";

/**
 * Mazer name on the signed-in account page (MAZER-ACCT-047). The Mazer leaderboard name lives in
 * `mazer.mazer_profiles.username`, a separate store from the sign-in username (see
 * docs/shared-account-portal-phase1.md). Mazer itself has no account screens any more, so the name
 * is changed here, through the same auth-bound database function the old in-game editor used:
 * `mazer.mazer_set_username(p_expected_user_id, p_username)`. It renames only the caller's own
 * profile, and the case-insensitive unique index stays the final word on a taken name. A profile
 * that does not exist yet (`MAZER_PROFILE_MISSING`) is created once through
 * `mazer.mazer_ensure_profile` and the rename is retried once, never looped.
 *
 * Pure: maps form input and provider errors to one copy-matrix line. Provider errors are read only
 * through their machine fields (code, status, message markers) and never shown.
 */

export const MAZER_SCHEMA = "mazer";
export const MAZER_SET_USERNAME_RPC = "mazer_set_username";
export const MAZER_ENSURE_PROFILE_RPC = "mazer_ensure_profile";
export const MAZER_PROFILE_TABLE = "mazer_profiles";

export type MazerNameProblem = { id: AuthMessageId };

type ProviderErrorShape = { code?: unknown; status?: unknown; message?: unknown };

function shape(error: unknown): ProviderErrorShape {
  return typeof error === "object" && error !== null ? (error as ProviderErrorShape) : {};
}

function code(error: unknown) {
  const value = shape(error).code;
  return typeof value === "string" ? value : "";
}

function status(error: unknown) {
  const value = shape(error).status;
  return typeof value === "number" ? value : -1;
}

function message(error: unknown) {
  const value = shape(error).message;
  return typeof value === "string" ? value : "";
}

/** Same rule as sign-up and the database check: 2 to 15 letters, numbers, dot, underscore, hyphen. */
export function mazerNameProblem(value: string, current: string | null): MazerNameProblem | null {
  const next = value.trim();
  if (!USERNAME_PATTERN.test(next)) return { id: "signup.userinvalid" };
  // A case-only change is a real change (the unique index ignores case, the leaderboard does not).
  if (current !== null && next === current.trim()) return { id: "mazer.namesame" };
  return null;
}

/** The caller has no Mazer profile row yet: create it once, then retry the rename once. */
export function isMazerProfileMissing(error: unknown) {
  return code(error) === "P0002" || message(error).includes("MAZER_PROFILE_MISSING");
}

/**
 * The account page shows the Mazer name row when the account already has a Mazer name, or when the
 * person came from Mazer (`?app=mazer`). A Fitness-only account opened without Mazer context gets no
 * row, so nothing ever creates a Mazer profile for someone who never played.
 */
export function showMazerNameRow(contextId: string, current: string | null) {
  return current !== null || contextId === "mazer";
}

/**
 * In Mazer the account page shows ONE name: the Mazer name, labelled "Username". The sign-in
 * username row is hidden there (the two stores stay separate; only the display collapses). Every
 * other context keeps both rows. Pure, display only.
 */
export function mazerNameIsSoleUsername(contextId: string, rowShown: boolean) {
  return rowShown && contextId === "mazer";
}

/** One copy-matrix line for a failed rename. */
export function mazerNameFailure(error: unknown): AuthMessageId {
  const value = code(error);
  if (value === "23505") return "signup.taken";
  if (value === "22023" || message(error).includes("MAZER_USERNAME_INVALID")) return "signup.userinvalid";
  // 28000: the signed-in id did not match the session; PGRST301/401: the session token was refused.
  if (value === "28000" || value === "PGRST301" || status(error) === 401) return "signin.session";
  if (value === "42501" || status(error) === 403) return "change.unavailable";
  if (isChangeBackendMissing(error)) return "change.unavailable";
  if (error instanceof TypeError || (status(error) === 0 && !value)) return "signin.offline";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "signin.offline";
  if (status(error) === 429) return "change.rate";
  return "change.savefail";
}
