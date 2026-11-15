/**
 * Auth Surface v2 copy matrix (owner-approved 2026-11-15). The ONLY source of the words a person can
 * read on the account portal screens: every notice line, button, working label, link, title, lead and
 * field label. Components import from here; tests/account-copy-matrix.test.mjs fails when a portal
 * screen carries any other visible text.
 *
 * Messages: id -> tone, text and an optional inline action. `{e}` is the masked email, always derived
 * from the email shown on that same screen (see `maskEmail`).
 */

import { STATUS_COPY } from "@/lib/auth/status-copy";

// The 404 and crash words live in status-copy.ts (shipped on every route); they are part of this matrix.
export { PAGE_CRASH_NOTICE, STATUS_COPY } from "@/lib/auth/status-copy";

export type NoticeTone = "error" | "info" | "success";

type MessageEntry = readonly [NoticeTone, string] | readonly [NoticeTone, string, string];

export const AUTH_MESSAGES = {
  "signin.empty": ["error", "Enter your email or username and your password."],
  "signin.wrong": ["error", "Wrong email, username or password. Try again."],
  "signin.throttled": ["error", "Too many attempts. Wait a few minutes, or sign in with your email."],
  "signin.unavailable": ["error", "Sign-in is unavailable right now. Try again in a minute."],
  "signin.unconfirmed": ["error", "Confirm your email first. Check your inbox for the link."],
  "signin.session": ["error", "Your session ended. Sign in again to continue."],
  "signin.offline": ["error", "No connection. Check your internet and try again."],
  "captcha.load": ["error", "Security check could not load. Check your connection.", "Retry"],
  "captcha.fail": ["error", "Security check failed. Try the check again.", "Retry"],
  "signin.confirmed": ["success", "Email confirmed. Sign in to continue."],
  "signin.resetdone": ["success", "Password saved. Sign in with your new password."],
  "signin.callback": ["error", "We could not finish signing you in. Sign in again."],
  "signup.taken": ["error", "That username is taken. Try another."],
  "signup.userinvalid": ["error", "Use 2 to 15 letters, numbers, periods, underscores or hyphens."],
  "signup.emailinvalid": ["error", "Enter a valid email address."],
  "signup.emailexists": ["error", "That email already has an account.", "Sign in"],
  "signup.pwshort": ["error", "Use at least 10 characters. A longer phrase works well."],
  "signup.pwweak": ["error", "That password is too easy to guess. Try another."],
  "signup.rate": ["error", "Too many sign-up attempts. Wait a few minutes and try again."],
  "signup.sent": ["success", "Check {e} for a link to confirm your account."],
  "reset.sent": ["success", "Reset link sent to {e}. It expires in 1 hour."],
  "change.pwwrong": ["error", "That password is not right. Try again."],
  "change.userdone": ["success", "Username changed. It now applies in every app."],
  "change.emailexists": ["error", "Another account already uses that email."],
  "change.emailsame": ["error", "That is already your email."],
  "change.emailsent": ["success", "Open the link we sent to {e} to confirm the change."],
  "change.emaildone": ["success", "Email changed to {e}. We also told your old address."],
  "change.rate": ["error", "Too many change requests. Wait a few minutes and try again."],
  "reset.sentany": ["success", "If that account exists, we sent a reset link to its email."],
  "reset.expired": ["error", "That reset link expired. Send a new one."],
  "reset.invalid": ["error", "That reset link is not valid. Send a new one."],
  "reset.rate": ["error", "Too many reset requests. Wait a few minutes and try again."],
  "reset.sendfail": ["error", "Could not send the email. Try again in a few minutes."],
  "reset.mismatch": ["error", "The two passwords do not match."],
  "reset.same": ["error", "Choose a password different from your current one."],
  "reset.savefail": ["error", "Could not save your password. Try again."],
  "account.loadfail": ["error", "Could not load your account. Try again.", "Retry"],
  "account.signoutfail": ["error", "Could not sign out. Try again."],
  "page.crash": ["error", STATUS_COPY.crash],
  "page.offline": ["error", "You are offline. We will reconnect when you are back."],
  "mazer.cancelled": ["error", "Sign-in did not finish. Tap Sign in to try again."],
  "mazer.timeout": ["error", "Sign-in took too long. Tap Sign in to try again."],
  "mazer.storage": ["error", "This browser is blocking site data. Allow it, then tap Sign in."],
} as const satisfies Record<string, MessageEntry>;

export type AuthMessageId = keyof typeof AUTH_MESSAGES;

export type AuthNotice = {
  id: AuthMessageId;
  tone: NoticeTone;
  text: string;
  action?: string;
};

/** First character, three dots, then the domain: `zac@icloud.com` -> `z•••@icloud.com`. */
export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.trim().split("@");
  if (!local || !domain) return "your email";
  return `${local.charAt(0)}•••@${domain}`;
}

export function authNotice(id: AuthMessageId, email?: string | null): AuthNotice {
  const entry: MessageEntry = AUTH_MESSAGES[id];
  const text = entry[1].includes("{e}") ? entry[1].replace("{e}", maskEmail(email ?? "")) : entry[1];
  return entry[2] ? { id, tone: entry[0], text, action: entry[2] } : { id, tone: entry[0], text };
}

/** Product names as they appear in `<App>` slots. */
export type AuthAppName = "Fawxzzy" | "Fitness" | "Mazer";

/** Buttons, working labels, links, titles, leads and field labels from the approved mocks. */
export const AUTH_COPY = {
  button: {
    signIn: "Sign in",
    createAccount: "Create account",
    sendResetLink: "Send reset link",
    savePassword: "Save password",
    signOut: "Sign out",
    tryAgain: STATUS_COPY.tryAgain,
    goToAccount: STATUS_COPY.goToAccount,
    open: (app: AuthAppName) => `Open ${app}`,
  },
  working: {
    signingIn: "Signing in…",
    creatingAccount: "Creating account…",
    sending: "Sending…",
    saving: "Saving…",
    signingOut: "Signing out…",
    opening: (app: AuthAppName) => `Opening ${app}…`,
  },
  /** "Resend in 0:30" while a link can not be sent again yet. */
  resendIn: (seconds: number) => `Resend in 0:${String(Math.max(0, Math.min(59, seconds))).padStart(2, "0")}`,
  link: {
    createAccount: "Create account",
    resetPassword: "Reset password",
    signIn: "Sign in",
    notYou: "Not you?",
    backToAccount: "Back to account",
    privacy: "Privacy",
    terms: "Terms",
    wrongEmail: "Wrong email?",
    cancel: "Cancel",
  },
  title: {
    welcome: "Welcome",
    welcomeBack: "Welcome back",
    createAccount: "Create account",
    resetPassword: "Reset password",
    newPassword: "New password",
    account: "Account",
    signingIn: "Signing you in…",
    confirming: "Confirming your email…",
    signingOut: "Signing you out…",
    checkingAccount: "Checking your account…",
    signInLinkExpired: "Sign-in link expired",
    pageNotFound: STATUS_COPY.pageNotFound,
    couldNotLoad: STATUS_COPY.couldNotLoad,
    offline: "You are offline",
    signOut: "Sign out",
  },
  lead: {
    resetRequest: "We will email a reset link to the address on your account.",
    newPassword: "Choose a password of at least 10 characters.",
    account: "Your account works in Fitness and Mazer.",
    usingAccount: "Using your Fawxzzy account.",
    pageNotFound: STATUS_COPY.pageNotFoundLead,
    startAgainIn: (app: AuthAppName) => `Go back to ${app} and tap Sign in to start again.`,
  },
  field: {
    identifier: "Email or username",
    password: "Password",
    username: "Username",
    email: "Email",
    newPassword: "New password",
    confirmPassword: "Confirm password",
  },
  /** Screen-reader only names for icon buttons and live regions. */
  aria: {
    showPassword: "Show password",
    hidePassword: "Hide password",
    locked: "Locked",
  },
} as const;

/** Words that must never appear on an auth screen again (owner list, 2026-11-15). */
export const RETIRED_AUTH_COPY = [
  "Working…",
  "Could not create account",
  "Something went wrong",
  "Wrong details",
  "Log In",
  "Create Account",
  "Choose Sign in",
] as const;
