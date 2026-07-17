export type AuthAction =
  | "login"
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
  signup:
    "If this address can create an account, the next step is ready. You can also try signing in.",
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

export function safeAuthError(action: AuthAction) {
  return SAFE_MESSAGES[action];
}

export function safeAuthSuccess(action: AuthAction) {
  switch (action) {
    case "signup":
      return "Your account request is complete. You can continue to your account when a session is available.";
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
