import type { AuthMessageId } from "@/lib/auth/copy-matrix";
import { isUsernameTakenError } from "@/lib/auth/errors";
import { EMAIL_PATTERN, USERNAME_PATTERN } from "@/lib/auth/form-guidance";

/**
 * Change username / change email on the signed-in account page (design point 12). Pure: maps form
 * input and provider outcomes to one copy-matrix line. No DOM, no provider calls; provider errors are
 * read only through their machine fields (code, status, name) and never shown.
 *
 * Flow: step 1 re-enters the current password (the same user must come back), step 2 takes the new
 * value. A username is saved at once through `account_api.account_change_username` (rate limited in
 * the database, same rules and "taken" line as sign-up). An email change asks the provider to send a
 * link to the NEW address; the change applies only when that link is opened, so the old address keeps
 * working until then.
 */

export type ChangeField = "username" | "email";

export type ChangeInputField = "password" | ChangeField;

export type ChangeProblem = { id: AuthMessageId; fields: ChangeInputField[] };

/** What `account_api.account_change_username` answers. Anything else is treated as a failure. */
export const USERNAME_CHANGE_STATUSES = ["changed", "same", "taken", "invalid", "rate"] as const;

export type UsernameChangeStatus = (typeof USERNAME_CHANGE_STATUSES)[number];

export function isUsernameChangeStatus(value: unknown): value is UsernameChangeStatus {
  return typeof value === "string" && (USERNAME_CHANGE_STATUSES as readonly string[]).includes(value);
}

/** The re-entered password did not belong to the signed-in account (another user came back). */
export class ReauthMismatchError extends Error {
  constructor() {
    super("Re-authentication returned a different account.");
    this.name = "ReauthMismatchError";
  }
}

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

function isOffline(error: unknown) {
  if (error instanceof TypeError) return true;
  // supabase-js turns a failed fetch into a PostgREST error with status 0 and no code.
  if (status(error) === 0 && !code(error)) return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isCaptchaError(error: unknown) {
  if (code(error) === "captcha_failed") return true;
  const message = shape(error).message;
  return typeof message === "string" && /captcha/i.test(message);
}

function isRateLimited(error: unknown) {
  const value = code(error);
  return status(error) === 429 ||
    value === "over_request_rate_limit" ||
    value === "over_email_send_rate_limit";
}

/**
 * The backend piece is not there yet (the SQL is owner-gated): the function or schema is missing from
 * the API, or this role may not call it. The screen then says changes are unavailable instead of
 * pretending the name was taken or the password was wrong.
 */
export function isChangeBackendMissing(error: unknown) {
  const value = code(error);
  return [
    "PGRST202", // function not found in the schema cache
    "PGRST106", // schema not exposed
    "PGRST205", // relation not found in the schema cache
    "42883", // undefined function
    "42501", // permission denied (no USAGE/EXECUTE for this role)
    "3F000", // invalid schema name
  ].includes(value) || status(error) === 404;
}

export function reauthProblem(password: string): ChangeProblem | null {
  return password ? null : { id: "change.pwempty", fields: ["password"] };
}

export function usernameChangeProblem(value: string, current: string | null): ChangeProblem | null {
  const next = value.trim();
  if (!USERNAME_PATTERN.test(next)) return { id: "signup.userinvalid", fields: ["username"] };
  if (current !== null && next === current.trim()) return { id: "change.usersame", fields: ["username"] };
  return null;
}

export function emailChangeProblem(value: string, current: string | null): ChangeProblem | null {
  const next = value.trim();
  if (!EMAIL_PATTERN.test(next)) return { id: "signup.emailinvalid", fields: ["email"] };
  if (current !== null && next.toLowerCase() === current.trim().toLowerCase()) {
    return { id: "change.emailsame", fields: ["email"] };
  }
  return null;
}

/** Fields a change outcome points at, so the right box gets the error outline. */
export function changeFieldsFor(id: AuthMessageId): ChangeInputField[] {
  switch (id) {
    case "change.pwempty":
    case "change.pwwrong":
      return ["password"];
    case "change.usersame":
    case "signup.taken":
    case "signup.userinvalid":
      return ["username"];
    case "change.emailsame":
    case "change.emailexists":
    case "signup.emailinvalid":
      return ["email"];
    default:
      return [];
  }
}

/** Step 1 (password) failures. A wrong password and a different account read the same. */
export function reauthFailure(error: unknown): AuthMessageId {
  if (error instanceof ReauthMismatchError) return "change.pwwrong";
  if (isOffline(error)) return "signin.offline";
  if (isCaptchaError(error)) return "captcha.fail";
  if (isRateLimited(error)) return "change.rate";
  if (status(error) >= 500) return "change.unavailable";
  return "change.pwwrong";
}

export function usernameChangeNotice(result: UsernameChangeStatus): AuthMessageId {
  switch (result) {
    case "changed":
      return "change.userdone";
    case "same":
      return "change.usersame";
    case "taken":
      return "signup.taken";
    case "invalid":
      return "signup.userinvalid";
    case "rate":
      return "change.rate";
  }
}

export function usernameChangeFailure(error: unknown): AuthMessageId {
  if (isUsernameTakenError(error)) return "signup.taken";
  if (isChangeBackendMissing(error)) return "change.unavailable";
  if (isOffline(error)) return "signin.offline";
  if (isRateLimited(error)) return "change.rate";
  return "change.savefail";
}

export function emailChangeFailure(error: unknown): AuthMessageId {
  if (isOffline(error)) return "signin.offline";
  const value = code(error);
  if (value === "email_exists" || value === "user_already_exists") return "change.emailexists";
  if (value === "email_address_invalid" || value === "validation_failed") return "signup.emailinvalid";
  if (isRateLimited(error)) return "change.rate";
  if (status(error) >= 500) return "change.unavailable";
  return "change.savefail";
}

/** Notices the email-change link may hand to /account through `?notice=` (allowlist). */
export const ACCOUNT_NOTICE_PARAM = "notice";

const ACCOUNT_NOTICES = {
  // The link was opened and the provider returned a session: the change is done.
  emaildone: "change.emaildone",
  // Secure email change: the provider wants the link at the other address opened too.
  emailhalf: "change.emailhalf",
  // The link was rejected (expired, used, or for another change).
  emaillink: "change.linkfail",
} as const satisfies Record<string, AuthMessageId>;

export type AccountNoticeKey = keyof typeof ACCOUNT_NOTICES;

export function accountNoticeFromQuery(values: string[]): AuthMessageId | null {
  if (values.length !== 1) return null;
  const key = values[0];
  return Object.hasOwn(ACCOUNT_NOTICES, key) ? ACCOUNT_NOTICES[key as AccountNoticeKey] : null;
}

/** Where an opened email-change link lands: always the account page, with the outcome. */
export function emailChangeLandingKey(outcome: "session" | "no-session" | "error"): AccountNoticeKey {
  if (outcome === "session") return "emaildone";
  if (outcome === "no-session") return "emailhalf";
  return "emaillink";
}

/**
 * The remembered identity on the sign-in screen follows a username change, so "Welcome back" does
 * not offer a name that no longer signs in. An email or another name stays as it is.
 */
export function nextRememberedIdentity(remembered: string | null, previous: string | null, next: string) {
  if (!remembered || !previous) return null;
  return remembered.trim().toLowerCase() === previous.trim().toLowerCase() ? next : null;
}
