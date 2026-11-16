import { isChangeBackendMissing, reauthFailure } from "@/lib/auth/account-change";
import type { AuthMessageId } from "@/lib/auth/copy-matrix";

/**
 * Delete account on the signed-in account page. Pure: maps form input and provider outcomes to one
 * copy-matrix line. No DOM, no provider calls; provider errors are read only through their machine
 * fields (code, status) and never shown.
 *
 * Flow: (1) re-enter the password on a throw-away client (the fresh session is the proof the server
 * checks: a password sign-in from the last 10 minutes on a live session of the same account), (2) type
 * the confirmation text (the username, or the email for an account without one), (3) read what is
 * deleted, then delete. The server function `account_api.account_delete_self` decides; the page never
 * deletes anything itself. Deleted data has no recovery.
 */

export type DeleteStep = "password" | "type" | "warning";

/** `confirmation` is the typed-text box (same field name the forms use for a second entry). */
export type DeleteInputField = "password" | "confirmation";

export type DeleteProblem = { id: AuthMessageId; fields: DeleteInputField[] };

/** What `account_api.account_delete_self` answers. Anything else is treated as a failure. */
export const ACCOUNT_DELETE_STATUSES = ["deleted", "gone", "reauth", "confirm", "billing", "rate"] as const;

export type AccountDeleteStatus = (typeof ACCOUNT_DELETE_STATUSES)[number];

export function isAccountDeleteStatus(value: unknown): value is AccountDeleteStatus {
  return typeof value === "string" && (ACCOUNT_DELETE_STATUSES as readonly string[]).includes(value);
}

/** `deleted` and `gone` both mean the account no longer exists: sign out and leave. */
export function isAccountGone(status: AccountDeleteStatus) {
  return status === "deleted" || status === "gone";
}

/**
 * The text the person types on step 2, the same rule the server uses: the username from the account
 * record when there is one, otherwise the email.
 */
export function deleteConfirmTarget(username: unknown, email: string | null | undefined) {
  const name = typeof username === "string" ? username.trim() : "";
  return name || (email ?? "").trim();
}

/** Same comparison as the server: trimmed, any case. */
export function deleteConfirmMatches(typed: string, target: string) {
  const expected = target.trim().toLowerCase();
  return expected !== "" && typed.trim().toLowerCase() === expected;
}

export function deleteReauthProblem(password: string): DeleteProblem | null {
  return password ? null : { id: "change.pwempty", fields: ["password"] };
}

export function deleteConfirmProblem(typed: string, target: string): DeleteProblem | null {
  return deleteConfirmMatches(typed, target) ? null : { id: "delete.confirmwrong", fields: ["confirmation"] };
}

/** Fields a delete outcome points at, so the right box gets the error outline. */
export function deleteFieldsFor(id: AuthMessageId): DeleteInputField[] {
  switch (id) {
    case "change.pwempty":
    case "change.pwwrong":
      return ["password"];
    case "delete.confirmwrong":
      return ["confirmation"];
    default:
      return [];
  }
}

/** Where each answer sends the flow, and which line it shows. `null` line = the account is gone. */
export function accountDeleteNotice(status: AccountDeleteStatus): { id: AuthMessageId | null; step: DeleteStep } {
  switch (status) {
    case "deleted":
    case "gone":
      return { id: null, step: "warning" };
    case "reauth":
      // The password check is older than 10 minutes or its session ended: ask for the password again.
      return { id: "delete.reauth", step: "password" };
    case "confirm":
      return { id: "delete.confirmwrong", step: "type" };
    case "billing":
      return { id: "delete.billing", step: "warning" };
    case "rate":
      return { id: "delete.rate", step: "warning" };
  }
}

/** Step 1 (password) failures: the change lines, with the delete wording for rate and outage. */
export function deleteReauthFailure(error: unknown): AuthMessageId {
  const id = reauthFailure(error);
  if (id === "change.rate") return "delete.rate";
  if (id === "change.unavailable") return "delete.unavailable";
  return id;
}

type ProviderErrorShape = { code?: unknown; status?: unknown };

function status(error: unknown) {
  const value = typeof error === "object" && error !== null ? (error as ProviderErrorShape).status : undefined;
  return typeof value === "number" ? value : -1;
}

function code(error: unknown) {
  const value = typeof error === "object" && error !== null ? (error as ProviderErrorShape).code : undefined;
  return typeof value === "string" ? value : "";
}

/** The delete call itself failed (no answer from the function). */
export function accountDeleteFailure(error: unknown): AuthMessageId {
  if (isChangeBackendMissing(error)) return "delete.unavailable";
  if (error instanceof TypeError || (status(error) === 0 && !code(error))) return "signin.offline";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "signin.offline";
  if (status(error) === 429) return "delete.rate";
  return "delete.fail";
}
