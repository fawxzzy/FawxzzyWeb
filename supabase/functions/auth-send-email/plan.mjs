import { resolveAuthThemeFromRedirect } from "../_shared/auth-theme.mjs";
import { maskEmail, renderEmail } from "./render.mjs";

/**
 * Turns a Supabase Send Email hook payload into the concrete messages to send.
 *
 * Link strategy (verified against src/app/auth/confirm, src/app/reset-password
 * and src/lib/auth/callback-contract.ts by tests/auth-email-contract.test.mjs):
 *
 * - recovery: ALWAYS the Supabase verify URL
 *   `{SUPABASE_URL}/auth/v1/verify?token=<token_hash>&type=recovery&redirect_to=<redirect_to>`.
 *   The reset-password page (parseRecoveryPayload) rejects `token_hash`/`token`
 *   in its query string and only accepts a PKCE `code` or an existing session,
 *   so the verify endpoint must consume the token and redirect back with `code`.
 * - signup / invite / magiclink / email / email_change: the account confirm
 *   route takes `token_hash` + `type` directly (parseConfirmPayload ->
 *   verifyOtp). When redirect_to is exactly that route, append the token to
 *   redirect_to so its `app`, `returnTo` and `state` survive. Any other
 *   redirect_to uses the verify URL (Supabase validates redirect_to itself).
 */

export const ACCOUNT_CONFIRM_URL = "https://account.fawxzzy.com/auth/confirm";

/** Types the confirm route accepts directly (CONFIRM_TYPES in callback-contract.ts, minus recovery). */
const CONFIRM_ROUTE_TYPES = new Set(["email", "email_change", "invite", "magiclink", "signup"]);

const NOTIFICATIONS = {
  password_changed_notification: {
    subject: (name) => `Your ${name} password was changed`,
    title: "Password changed",
    body: "The password on your account was just changed.",
  },
  email_changed_notification: {
    subject: (name) => `Your ${name} email address was changed`,
    title: "Email changed",
    body: "The email address on your account was just changed.",
    /** The account address is already the new one when this notice is sent. */
    bodyFor: (account, newEmail) => `Your ${account} email changed to ${maskEmail(newEmail)}.`,
  },
  phone_changed_notification: {
    subject: (name) => `Your ${name} phone number was changed`,
    title: "Phone number changed",
    body: "The phone number on your account was just changed.",
  },
  identity_linked_notification: {
    subject: (name) => `A sign-in method was added to your ${name} account`,
    title: "Sign-in method added",
    body: "A new sign-in method was just linked to your account.",
  },
  identity_unlinked_notification: {
    subject: (name) => `A sign-in method was removed from your ${name} account`,
    title: "Sign-in method removed",
    body: "A sign-in method was just removed from your account.",
  },
  mfa_factor_enrolled_notification: {
    subject: (name) => `A security factor was added to your ${name} account`,
    title: "Security factor added",
    body: "A new two-step verification method was just added to your account.",
  },
  mfa_factor_unenrolled_notification: {
    subject: (name) => `A security factor was removed from your ${name} account`,
    title: "Security factor removed",
    body: "A two-step verification method was just removed from your account.",
  },
};

export class HookPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "HookPayloadError";
  }
}

const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const SIX_DIGITS = /^\d{6}$/;
const EMAIL_ADDRESS = /^[^\s<>",;()[\]\\]+@[^\s<>",;()[\]\\]+$/;

/** Supabase verify URL (documented Send Email hook link). */
export function buildVerifyUrl(supabaseUrl, tokenHash, type, redirectTo) {
  const base = new URL("/auth/v1/verify", supabaseUrl);
  base.searchParams.set("token", tokenHash);
  base.searchParams.set("type", type);
  if (isNonEmptyString(redirectTo)) base.searchParams.set("redirect_to", redirectTo);
  return base.href;
}

/** Append token_hash/type to a redirect_to that is exactly the account confirm route. */
function buildConfirmRouteUrl(redirectTo, tokenHash, type) {
  let target;
  try {
    target = new URL(redirectTo);
  } catch {
    return null;
  }
  if (`${target.origin}${target.pathname}` !== ACCOUNT_CONFIRM_URL || target.hash) return null;
  if (target.searchParams.has("token_hash") || target.searchParams.has("type")) return null;
  target.searchParams.set("token_hash", tokenHash);
  target.searchParams.set("type", type);
  return target.href;
}

export function buildActionLink({ supabaseUrl, tokenHash, type, redirectTo }) {
  if (!isNonEmptyString(tokenHash)) throw new HookPayloadError("Missing token hash");
  if (CONFIRM_ROUTE_TYPES.has(type)) {
    const direct = buildConfirmRouteUrl(redirectTo, tokenHash, type);
    if (direct) return direct;
  }
  return buildVerifyUrl(supabaseUrl, tokenHash, type, redirectTo);
}

/**
 * How long a link stays valid, as the portal promises it ("reset.sent" in
 * src/lib/auth/copy-matrix.ts: "It expires in 1 hour.").
 */
const LINK_LIFETIME = "1 hour";
const LINK_ONCE = `The link works once and expires in ${LINK_LIFETIME}.`;

/**
 * Per-type copy: sentence case, short, plain, the same words as the portal
 * copy matrix where one exists. Emails are always shown masked (maskEmail) and
 * always derived from the addresses in this message.
 *
 * @param {string} type email_action_type
 * @param {object} theme
 * @param {{ email: string, newEmail?: string, variant?: "current" | "new", secure?: boolean }} who
 */
function linkCopy(type, theme, who) {
  const account = theme.accountLabel;
  const email = maskEmail(who.email);
  switch (type) {
    case "signup":
      return {
        subject: `Confirm your ${theme.kicker} account`,
        preheader: `Confirm ${email} to finish creating your account.`,
        title: "Confirm your email",
        paragraphs: [`Tap the button to confirm ${email} and finish creating your ${account}.`, LINK_ONCE],
        label: "Confirm email",
        footerNote: "Did not sign up? You can ignore this email.",
      };
    case "invite":
      return {
        subject: `You are invited to ${theme.kicker}`,
        preheader: "Accept your invitation to create an account.",
        title: "You are invited",
        paragraphs: [`Tap the button to create your ${account} with ${email}.`, LINK_ONCE],
        label: "Accept invite",
        footerNote: "Not expecting this? You can ignore this email.",
      };
    case "magiclink":
    case "email":
      return {
        subject: `Your ${theme.kicker} sign-in link`,
        preheader: "Tap the link to sign in.",
        title: "Sign in",
        paragraphs: [`Tap the button to sign in to your ${account} as ${email}.`, LINK_ONCE],
        label: "Sign in",
        footerNote: "Did not ask to sign in? You can ignore this email.",
      };
    case "recovery":
      return {
        subject: `Reset your ${theme.kicker} password`,
        preheader: `Choose a new password for ${email}.`,
        title: "Reset password",
        paragraphs: [`Tap the button to choose a new password for ${email}.`, LINK_ONCE],
        label: "Reset password",
        footerNote: "Did not ask for this? You can ignore this email. Your password stays the same.",
      };
    case "email_change": {
      const newEmail = maskEmail(who.newEmail);
      if (who.variant === "current") {
        return {
          subject: `Approve your ${theme.kicker} email change`,
          preheader: `Approve moving your account to ${newEmail}.`,
          title: "Approve email change",
          paragraphs: [
            `Tap the button to move your ${account} from ${email} to ${newEmail}.`,
            `Open the link we sent to ${newEmail} too. Both expire in ${LINK_LIFETIME}.`,
          ],
          label: "Approve change",
          footerNote: "Did not ask for this? You can ignore this email. Your email stays the same.",
        };
      }
      return {
        subject: `Confirm your new ${theme.kicker} email`,
        preheader: `Confirm ${newEmail} for your account.`,
        title: "Confirm new email",
        paragraphs: [
          `Tap the button to use ${newEmail} for your ${account}.`,
          who.secure
            ? `Open the link we sent to ${email} too. Both expire in ${LINK_LIFETIME}.`
            : `Your old email keeps working until you open the link. It expires in ${LINK_LIFETIME}.`,
        ],
        label: "Confirm email",
        footerNote: "Did not ask for this? You can ignore this email. Your email stays the same.",
      };
    }
    default:
      return null;
  }
}

function message({ theme, to, copy, button, code }) {
  const rendered = renderEmail({
    theme,
    subject: copy.subject,
    preheader: copy.preheader,
    title: copy.title,
    paragraphs: copy.paragraphs,
    button: button ?? null,
    code: code ?? null,
    footerNote: copy.footerNote,
    recipient: to,
  });
  return { to, subject: copy.subject, html: rendered.html, text: rendered.text };
}

/**
 * @param {object} payload parsed hook body ({ user, email_data })
 * @param {{ supabaseUrl: string }} options
 * @returns {{ to: string, subject: string, html: string, text: string }[]}
 */
export function planMessages(payload, { supabaseUrl }) {
  const user = payload?.user;
  const data = payload?.email_data;
  if (!user || typeof user !== "object" || !data || typeof data !== "object") {
    throw new HookPayloadError("Malformed hook payload");
  }
  if (!isNonEmptyString(user.email) || !EMAIL_ADDRESS.test(user.email)) {
    throw new HookPayloadError("Malformed recipient");
  }
  const type = data.email_action_type;
  if (!isNonEmptyString(type)) throw new HookPayloadError("Missing email action type");

  const redirectTo = typeof data.redirect_to === "string" ? data.redirect_to : "";
  const theme = resolveAuthThemeFromRedirect(redirectTo);
  const url = (tokenHash) => buildActionLink({ supabaseUrl, tokenHash, type, redirectTo });

  if (type === "reauthentication") {
    if (!SIX_DIGITS.test(String(data.token ?? ""))) throw new HookPayloadError("Malformed code");
    return [
      message({
        theme,
        to: user.email,
        copy: {
          subject: `Your ${theme.kicker} security code`,
          preheader: "Enter this code to confirm your change.",
          title: "Your security code",
          paragraphs: ["Enter this code to confirm your change. It works once and expires soon."],
          footerNote: "Did not ask for this? Ignore this email and change your password.",
        },
        code: data.token,
      }),
    ];
  }

  if (type === "email_change") {
    const newEmail = user.new_email;
    if (!isNonEmptyString(newEmail) || !EMAIL_ADDRESS.test(newEmail)) {
      throw new HookPayloadError("Missing new email address");
    }
    const secure = isNonEmptyString(data.token_hash) && isNonEmptyString(data.token_hash_new);
    const current = linkCopy(type, theme, { email: user.email, newEmail, variant: "current", secure });
    const next = linkCopy(type, theme, { email: user.email, newEmail, variant: "new", secure });
    if (secure) {
      // Supabase names are reversed for backward compatibility: the current
      // address gets token_hash_new, the new address gets token_hash.
      return [
        message({ theme, to: user.email, copy: current, button: { label: current.label, url: url(data.token_hash_new) } }),
        message({ theme, to: newEmail, copy: next, button: { label: next.label, url: url(data.token_hash) } }),
      ];
    }
    const tokenHash = isNonEmptyString(data.token_hash) ? data.token_hash : data.token_hash_new;
    return [message({ theme, to: newEmail, copy: next, button: { label: next.label, url: url(tokenHash) } })];
  }

  const copy = linkCopy(type, theme, { email: user.email });
  if (copy) {
    return [message({ theme, to: user.email, copy, button: { label: copy.label, url: url(data.token_hash) } })];
  }

  const notification = NOTIFICATIONS[type];
  if (notification) {
    // "Email changed" goes to the OLD address: by the time it is sent, user.email is already the new
    // one. The hook payload names the previous address in email_data.old_email; without a valid one
    // the notice falls back to the account's current address.
    const oldEmail = data.old_email;
    const to = type === "email_changed_notification" && isNonEmptyString(oldEmail) && EMAIL_ADDRESS.test(oldEmail)
      ? oldEmail
      : user.email;
    const body = notification.bodyFor ? notification.bodyFor(theme.accountLabel, user.email) : notification.body;
    return [
      message({
        theme,
        to,
        copy: {
          subject: notification.subject(theme.kicker),
          preheader: body,
          title: notification.title,
          paragraphs: [body, "No action is needed if this was you."],
          footerNote: "Not you? Reset your password right away.",
        },
      }),
    ];
  }

  // Safe generic fallback for unknown future action types: neutral notice, no link.
  return [
    message({
      theme,
      to: user.email,
      copy: {
        subject: `A notice about your ${theme.kicker} account`,
        preheader: "There is a new notice about your account.",
        title: "Account notice",
        paragraphs: ["There is a new notice about your account. No action is needed from this email."],
        footerNote: "Not expecting this? You can ignore it.",
      },
    }),
  ];
}
