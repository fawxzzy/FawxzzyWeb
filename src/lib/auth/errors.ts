export type AuthAction =
  | "login"
  | "login-throttled"
  | "signup"
  | "reset-request"
  | "reset-complete"
  | "update-email"
  | "update-password"
  | "confirm"
  | "callback"
  | "signout"
  | "session";

/**
 * Every portal status text is a short plain statement (the length contract in
 * tests/account-copy-length.test.mjs caps it). Wording rules: "Try again." when the same screen can
 * retry, "Request a new link." when a link is dead, "Start again." when a one-time handoff must be
 * restarted from sign-in; no hedging clauses.
 */
const SAFE_MESSAGES: Record<AuthAction, string> = {
  login: "Wrong details. Try again.",
  // Shown only when username sign-in is rate limited. Throttling is applied before and regardless of
  // whether the username exists, so this does not reveal whether an account exists.
  "login-throttled": "Too many tries. Wait 15 minutes or use your email.",
  // One fixed sentence for every sign-up failure (already registered, weak password, rate limit,
  // network, unknown). It claims no completion and never reveals whether an address is registered.
  signup: "Could not create account. Try again.",
  // Identical for every address: it never reveals whether an account or username exists.
  "reset-request": "Check your email.",
  "reset-complete": "Password not saved. Request a new link.",
  "update-email": "Email not updated. Try again.",
  "update-password": "Password not updated. Try again.",
  confirm: "Link failed. Request a new link.",
  callback: "Sign-in failed. Start again.",
  signout: "Sign out failed. Try again.",
  session: "Status unavailable. Try again.",
};

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

/**
 * The one sentence shown beside the username field. A username is public (it appears on the Mazer
 * leaderboard), so unlike email existence it is not a secret and may be named. It claims nothing
 * about the email or password.
 */
export const USERNAME_TAKEN_MESSAGE = "Username taken. Try another.";

const ERROR_TEXT_KEYS = ["message", "msg", "error", "error_description", "code", "details", "hint"] as const;

/**
 * True only when a sign-up rejection carries the username-taken machine code. Looks at the
 * provider error's text fields and never at the email, so the generic "Database error saving new
 * user" message and every email-duplicate rejection stay on the neutral sign-up notice.
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

export function safeAuthError(action: AuthAction) {
  return SAFE_MESSAGES[action];
}

export function safeAuthSuccess(action: AuthAction) {
  switch (action) {
    case "login":
      // Shown on the sign-in button while the page continues to its destination.
      return "Signed in.";
    case "signup":
      // Only shown after the provider returned a real session.
      return "Account created.";
    case "reset-request":
      return SAFE_MESSAGES["reset-request"];
    case "reset-complete":
    case "update-password":
      return "Password updated.";
    case "update-email":
      return "Email update submitted.";
    case "signout":
      return "Signed out everywhere.";
    default:
      return "Done.";
  }
}
