/**
 * Machine codes and error classes the account portal reads. The words a person sees for each outcome
 * live only in the copy matrix (`copy-matrix.ts`); `auth-outcomes.ts` maps these to its lines.
 */

/** Machine code the username sign-in Edge Function returns (HTTP 429) when a lockout applies. */
export const USERNAME_THROTTLED_CODE = "username_throttled";

/** Thrown by the browser adapter so the portal can show the distinct lockout copy. */
export class UsernameSignInThrottledError extends Error {
  constructor() {
    super("Username sign-in is temporarily rate limited.");
    this.name = "UsernameSignInThrottledError";
  }
}

/**
 * Machine code the database duplicate-username guard (a trigger raising a 23505-shaped error) and
 * the optional before-user-created hook (HTTP 409) put in their message when a username is taken.
 */
export const ACCOUNT_USERNAME_TAKEN_CODE = "ACCOUNT_USERNAME_TAKEN";

const ERROR_TEXT_KEYS = ["message", "msg", "error", "error_description", "code", "details", "hint"] as const;

/**
 * True only when a sign-up rejection carries the username-taken machine code. Looks at the
 * provider error's text fields and never at the email, so the generic "Database error saving new
 * user" message and every email-duplicate rejection map to their own lines.
 */
export function isUsernameTakenError(error: unknown): boolean {
  if (typeof error === "string") return error.includes(ACCOUNT_USERNAME_TAKEN_CODE);
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  return ERROR_TEXT_KEYS.some((key) => {
    const value = record[key];
    return typeof value === "string" && value.includes(ACCOUNT_USERNAME_TAKEN_CODE);
  });
}
