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
  "signout.unavailable": ["error", "Sign-out is unavailable right now. Try again in a minute."],
  "signin.unconfirmed": ["error", "Confirm your email first. Check your inbox for the link."],
  "signin.session": ["error", "Your session ended. Sign in again to continue."],
  "signin.offline": ["error", "No connection. Check your internet and try again."],
  "captcha.load": ["error", "Security check could not load. Check your connection.", "Try again"],
  "captcha.fail": ["error", "Security check failed. Try the check again.", "Try again"],
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
  "change.pwempty": ["error", "Enter your password."],
  "change.usersame": ["error", "That is already your username."],
  "change.emailhalf": ["info", "One more step. Open the link we sent to your other address."],
  "change.linkfail": ["error", "That change link expired or was already used. Ask again."],
  "change.unavailable": ["error", "Changes are unavailable right now. Try again in a minute."],
  "change.savefail": ["error", "Could not save the change. Try again."],
  "reset.sentany": ["success", "If that account exists, we sent a reset link to its email."],
  // Signed-out reset by username: the same line whether or not the username has an account.
  "reset.sentuser": ["success", "If that username has an account, we sent a reset link to its email."],
  "reset.expired": ["error", "That reset link expired. Send a new one."],
  "reset.invalid": ["error", "That reset link is not valid. Send a new one."],
  "reset.rate": ["error", "Too many reset requests. Wait a few minutes and try again."],
  "reset.sendfail": ["error", "Could not send the email. Try again in a few minutes."],
  "reset.mismatch": ["error", "The two passwords do not match."],
  "reset.same": ["error", "Choose a password different from your current one."],
  "reset.savefail": ["error", "Could not save your password. Try again."],
  "account.loadfail": ["error", "Could not load your account. Try again.", "Try again"],
  "account.signoutfail": ["error", "Could not sign out. Try again."],
  // Sign out everywhere (account page): the in-page confirm, and the line on the sign-in screen after.
  "account.everywhereconfirm": ["info", "Sign out on every device and app?", "Sign out everywhere"],
  "signin.everywhere": ["success", "You are signed out on every device."],
  // Delete account (account page): refusals from account_api.account_delete_self, and the done line.
  "delete.confirmwrong": ["error", "That does not match. Type it exactly as shown."],
  "delete.reauth": ["error", "Your password check timed out. Enter your password again."],
  "delete.billing": ["error", "This account has a purchase. Contact support to delete it."],
  "delete.support": ["error", "This account cannot be deleted here. Contact support."],
  "delete.rate": ["error", "Too many delete attempts. Wait a few minutes and try again."],
  "delete.unavailable": ["error", "Deleting is unavailable right now. Try again in a minute."],
  "delete.fail": ["error", "Could not delete your account. Try again."],
  "signin.deleted": ["success", "Your account was deleted."],
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
    continue: "Continue",
    saveUsername: "Save username",
    sendLink: "Send link",
    deleteAccount: "Delete account",
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
    checking: "Checking…",
    deleting: "Deleting…",
    opening: (app: AuthAppName) => `Opening ${app}…`,
  },
  /** "Resend in 0:30" while a link cannot be sent again yet. */
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
    signOutEverywhere: "Sign out everywhere",
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
    changeUsername: "Change username",
    changeEmail: "Change email",
    deleteAccount: "Delete account",
  },
  lead: {
    resetRequest: "We will email a reset link to the address on your account.",
    newPassword: "Choose a password of at least 10 characters.",
    account: "Your account works in Fitness and Mazer.",
    usingAccount: "Using your Fawxzzy account.",
    changeConfirm: "Enter your password to continue.",
    changeUsername: "Your new username works for sign-in right away.",
    changeEmail: "Your old email keeps working until you open the link.",
    deleteType: "Type the text shown to confirm it is your account.",
    deleteWarning: "Deleting your account removes:",
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
    newUsername: "New username",
    newEmail: "New email",
    deleteAccount: "Delete account",
    deleteAccountValue: "Removes your account",
    resetProgress: "Reset progress",
    resetProgressValue: "Confirm in Mazer",
    typeToConfirm: (text: string) => `Type ${text}`,
  },
  /**
   * The plain-words list on the last delete step, one line each: what IS deleted, what stays (Discord
   * feedback and moderation records keep their Discord ids and text, without the account link; the
   * sign-in provider's security log and the retained migration archives and backups keep some data
   * for their own retention time: owner decision 2026-11-16 "delete live data, keep archives"), and
   * that it is permanent. Never promise more than account_api.account_delete_self removes.
   */
  deleteList: [
    "Your profile, username and sign-in",
    "Your Fitness workouts, routines and history",
    "Your Mazer progress and high scores",
    "Discord feedback and moderation records stay, with no link to you.",
    "Sign-in logs and backups may keep some data for a while.",
    "This cannot be undone. There is no way to get it back.",
  ],
  /** Screen-reader only names for icon buttons and live regions. */
  aria: {
    showPassword: "Show password",
    hidePassword: "Hide password",
    locked: "Locked",
    changeUsername: "Change username",
    changeEmail: "Change email",
    deleteAccount: "Delete account",
    resetProgress: "Reset Mazer progress",
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
