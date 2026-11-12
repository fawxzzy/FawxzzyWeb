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

const SAFE_MESSAGES: Record<AuthAction, string> = {
  login: "We could not sign you in with those details. Check them and try again.",
  // Shown only when username sign-in is rate limited. Throttling is applied before and regardless of
  // whether the username exists, so this does not reveal whether an account exists.
  "login-throttled":
    "Too many tries for that username. Wait 15 minutes, or sign in with your email address.",
  // One fixed sentence for every sign-up failure (already registered, weak password, rate limit,
  // network, unknown). It claims no completion and never reveals whether an address is registered.
  signup:
    "We could not finish creating your account. If you already made one, sign in with it instead.",
  "reset-request":
    "If an account can receive recovery mail at that address, the next step is on its way.",
  "reset-complete": "We could not update the password. Request a fresh recovery link.",
  "update-email": "We could not update the email address. Try again from this account.",
  "update-password": "We could not update the password. Try again from this account.",
  confirm: "This confirmation link could not be completed. Request a fresh link.",
  callback: "This sign-in handoff could not be completed. Start again from the account page.",
  signout: "We could not finish signing out. Refresh and try again.",
  session: "Account status is temporarily unavailable. Refresh and try again.",
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

export function safeAuthError(action: AuthAction) {
  return SAFE_MESSAGES[action];
}

export function safeAuthSuccess(action: AuthAction) {
  switch (action) {
    case "signup":
      // Only shown after the provider returned a real session.
      return "Your account is ready.";
    case "reset-request":
      return SAFE_MESSAGES["reset-request"];
    case "reset-complete":
    case "update-password":
      return "Your password has been updated.";
    case "update-email":
      return "Your email update was accepted.";
    case "signout":
      return "You are signed out on this origin.";
    default:
      return "Done.";
  }
}
