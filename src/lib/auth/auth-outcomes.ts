import type { AuthMessageId } from "@/lib/auth/copy-matrix";
import {
  isUsernameTakenError,
  UsernameSignInThrottledError,
} from "@/lib/auth/errors";
import { FitnessHandoffError } from "@/lib/auth/fitness-handoff";
import { EMAIL_PATTERN, USERNAME_PATTERN } from "@/lib/auth/form-guidance";
import { PASSWORD_MINIMUM } from "@/lib/auth/password-policy";

/**
 * Maps form input and provider outcomes to one copy-matrix line. Pure: no DOM, no provider calls.
 * Provider errors are read only through their machine fields (code, status, name) and never shown.
 */

export type AuthField = "identifier" | "username" | "email" | "password" | "confirmation";

export type FormProblem = { id: AuthMessageId; fields: AuthField[] };

type ProviderErrorShape = { code?: unknown; status?: unknown; name?: unknown; message?: unknown; retryAfter?: unknown };

function shape(error: unknown): ProviderErrorShape {
  return typeof error === "object" && error !== null ? (error as ProviderErrorShape) : {};
}

function code(error: unknown) {
  const value = shape(error).code;
  return typeof value === "string" ? value : "";
}

function status(error: unknown) {
  const value = shape(error).status;
  return typeof value === "number" ? value : 0;
}

/** A failed fetch (no connection, DNS, CORS) surfaces as a TypeError from the browser. */
export function isOfflineError(error: unknown) {
  if (error instanceof TypeError) return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isCaptchaError(error: unknown) {
  const value = code(error);
  if (value === "captcha_failed") return true;
  const message = shape(error).message;
  return typeof message === "string" && /captcha/i.test(message);
}

export function signInProblem(identifier: string, password: string): FormProblem | null {
  const fields: AuthField[] = [];
  if (!identifier.trim()) fields.push("identifier");
  if (!password) fields.push("password");
  return fields.length > 0 ? { id: "signin.empty", fields } : null;
}

export function signUpProblem(input: { username: string; email: string; password: string }): FormProblem | null {
  if (!USERNAME_PATTERN.test(input.username.trim())) return { id: "signup.userinvalid", fields: ["username"] };
  if (!EMAIL_PATTERN.test(input.email.trim())) return { id: "signup.emailinvalid", fields: ["email"] };
  if (input.password.length < PASSWORD_MINIMUM) return { id: "signup.pwshort", fields: ["password"] };
  return null;
}

export function newPasswordProblem(password: string, confirmation: string): FormProblem | null {
  if (password.length < PASSWORD_MINIMUM) return { id: "signup.pwshort", fields: ["password"] };
  if (password !== confirmation) return { id: "reset.mismatch", fields: ["confirmation"] };
  return null;
}

export function resetRequestProblem(email: string): FormProblem | null {
  return EMAIL_PATTERN.test(email.trim()) ? null : { id: "signup.emailinvalid", fields: ["email"] };
}

/** Signed-out reset by username: only the format is checked here; existence is never asked. */
export function resetUsernameProblem(username: string): FormProblem | null {
  return USERNAME_PATTERN.test(username.trim()) ? null : { id: "signup.userinvalid", fields: ["username"] };
}

/** Fields a provider outcome points at, so the right box gets the error outline. */
export function fieldsFor(id: AuthMessageId): AuthField[] {
  switch (id) {
    case "signin.wrong":
      return ["identifier", "password"];
    case "signup.taken":
    case "signup.userinvalid":
      return ["username"];
    case "signup.emailinvalid":
    case "signup.emailexists":
      return ["email"];
    case "signup.pwshort":
    case "signup.pwweak":
    case "reset.same":
      return ["password"];
    case "reset.mismatch":
      return ["confirmation"];
    default:
      return [];
  }
}

export function signInFailure(error: unknown): AuthMessageId {
  if (error instanceof UsernameSignInThrottledError) return "signin.throttled";
  if (error instanceof FitnessHandoffError) return "signin.callback";
  if (isOfflineError(error)) return "signin.offline";
  if (isCaptchaError(error)) return "captcha.fail";
  if (code(error) === "email_not_confirmed") return "signin.unconfirmed";
  if (status(error) === 429 || code(error) === "over_request_rate_limit") return "signin.throttled";
  if (status(error) >= 500) return "signin.unavailable";
  return "signin.wrong";
}

/**
 * Sign-up failures. A database or unknown provider failure has no specific cause the provider will
 * tell us, so it gets the generic "try again" line (reported gap: the backend returns one code).
 */
export function signUpFailure(error: unknown): AuthMessageId {
  if (isUsernameTakenError(error)) return "signup.taken";
  if (error instanceof FitnessHandoffError) return "signin.callback";
  if (isOfflineError(error)) return "signin.offline";
  if (isCaptchaError(error)) return "captcha.fail";
  const value = code(error);
  if (value === "user_already_exists" || value === "email_exists") return "signup.emailexists";
  if (value === "weak_password") return "signup.pwweak";
  if (value === "email_address_invalid" || value === "validation_failed") return "signup.emailinvalid";
  if (status(error) === 429 || value === "over_email_send_rate_limit" || value === "over_request_rate_limit") {
    return "signup.rate";
  }
  return "page.crash";
}

/**
 * Email reset request failures. A provider refusal to send (it sends at most one recovery email per
 * account per minute) says so, signed in or out: "No new email sent. Wait a minute, then try again."
 * Until 2026-11-26 a signed-out refusal read exactly like a sent link, to avoid an existence oracle.
 * That hid nothing from a stranger (the browser calls the provider itself, so the 429 is in plain
 * view in its network panel) and told a real person a link was on its way when none was. The
 * username path keeps its server-side indistinguishability (usernameResetFailure).
 */
export function resetRequestFailure(error: unknown): AuthMessageId {
  if (isOfflineError(error)) return "signin.offline";
  if (isCaptchaError(error)) return "captcha.fail";
  if (status(error) === 429 || code(error) === "over_email_send_rate_limit") return "reset.wait";
  return "reset.sendfail";
}

/**
 * The seconds the server says to wait (its Retry-After header, read by the browser adapter), whole and
 * within one send window; null when absent or out of range, so the caller falls back to its own minute.
 */
export function retryAfterSeconds(error: unknown): number | null {
  const value = shape(error).retryAfter;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65 ? value : null;
}

/**
 * Signed-out reset by username. The server answers every accepted request the same way, so the only
 * failures are about the request itself: its rate limit (counted before, and independent of, whether
 * the username exists, so "too many" reveals nothing), the account's one-email-per-minute send window
 * (`reset_wait`: keyed by account for a known username and by name for an unknown one, so both wait
 * identically; nothing was sent, whichever browser asked first) or the service being unavailable.
 */
export function usernameResetFailure(error: unknown): AuthMessageId {
  if (isOfflineError(error)) return "signin.offline";
  if (isCaptchaError(error)) return "captcha.fail";
  if (code(error) === "reset_wait") return "reset.wait";
  if (status(error) === 429 || code(error) === "reset_throttled") return "reset.rate";
  // reset_invalid (the format was already checked here, so it means origin, key or link config),
  // reset_unavailable and anything else: a sending problem, never an account answer.
  return "reset.sendfail";
}

export function passwordSaveFailure(error: unknown): AuthMessageId {
  if (isOfflineError(error)) return "signin.offline";
  const value = code(error);
  if (value === "same_password") return "reset.same";
  if (value === "weak_password") return "signup.pwweak";
  return "reset.savefail";
}

/** Notices another screen may hand to /login through `?notice=` (allowlist; anything else is ignored). */
export const LOGIN_NOTICE_PARAM = "notice";

const LOGIN_NOTICES = {
  callback: "signin.callback",
  confirmed: "signin.confirmed",
  // Sign out everywhere on the account page.
  everywhere: "signin.everywhere",
  // Delete account on the account page: the account is gone (the copy does not claim every trace is:
  // the sign-in provider's security log keeps the email for a while).
  deleted: "signin.deleted",
  resetdone: "signin.resetdone",
  session: "signin.session",
  unavailable: "signin.unavailable",
} as const satisfies Record<string, AuthMessageId>;

export type LoginNoticeKey = keyof typeof LOGIN_NOTICES;

export function loginNoticeFromQuery(values: string[]): AuthMessageId | null {
  if (values.length !== 1) return null;
  const key = values[0];
  return Object.hasOwn(LOGIN_NOTICES, key) ? LOGIN_NOTICES[key as LoginNoticeKey] : null;
}
