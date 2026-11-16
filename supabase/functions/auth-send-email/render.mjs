import { authThemeBase } from "../_shared/auth-theme.mjs";

/**
 * Email-safe renderer: table layout, inline styles, no webfonts, no tracking.
 * One branded template for every auth email: dark canvas, the app's own icon
 * (the only image, an absolute https URL on the account host), the product
 * kicker, a big light title, short copy and at most one pill button, with a
 * soft glow in the app accent. Every dynamic string is HTML-escaped; the only
 * URLs placed in markup are the icon URL from auth-theme.mjs and the action
 * link built by plan.mjs.
 *
 * Limits: the glow (box-shadow) shows only in clients that support it (Apple
 * Mail, iOS Mail); elsewhere the accent ring and border remain. Outlook desktop
 * squares the corners. Clients that force their own dark mode may recolor.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/**
 * First character, three dots, then the domain: `zac@icloud.com` -> `z•••@icloud.com`.
 * Same rule as maskEmail in src/lib/auth/copy-matrix.ts (parity-tested).
 */
export function maskEmail(email) {
  const [local = "", domain = ""] = String(email ?? "").trim().split("@");
  if (!local || !domain) return "your email";
  return `${local.charAt(0)}•••@${domain}`;
}

export function rgbTripletToHex(triplet) {
  const parts = String(triplet).trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("Invalid RGB triplet");
  }
  return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

/** Blend `top` over `bottom` at `alpha` (email clients lack reliable rgba borders). */
export function blendHex(topHex, bottomHex, alpha) {
  const top = hexToRgb(topHex);
  const bottom = hexToRgb(bottomHex);
  return `#${top
    .map((channel, index) => Math.round(channel * alpha + bottom[index] * (1 - alpha)))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Resolve the concrete colors an email for `theme` uses. */
export function themeColors(theme) {
  const canvas = authThemeBase.canvasHex;
  const accent = rgbTripletToHex(theme.accentRgb);
  const glow = (alpha) => `rgba(${hexToRgb(accent).join(",")},${alpha})`;
  return {
    canvas,
    /** Card surface: a faint accent wash over the canvas. */
    surface: blendHex(accent, canvas, 0.05),
    text: authThemeBase.textHex,
    muted: rgbTripletToHex(authThemeBase.mutedRgb),
    accent,
    /** Text color on the accent button: the canvas color, as on the sign-in dock. */
    onAccent: canvas,
    border: blendHex(accent, canvas, 0.36),
    rule: blendHex(accent, canvas, 0.18),
    glowStrong: glow(0.55),
    glowSoft: glow(0.2),
  };
}

/** Absolute https URL of the app icon for `theme` (served from public/ by the account host). */
export function emailIconUrl(theme) {
  return new URL(theme.emailIconPath, authThemeBase.emailAssetOrigin).href;
}

/** Rendered icon size in CSS pixels; the source PNG is 192 px, so it stays sharp at 2x and 2.6x. */
export const EMAIL_ICON_SIZE = 72;

const FONT = authThemeBase.fontFamily.replace(/"/g, "'");

/**
 * @param {object} view
 * @param {object} view.theme       entry of authThemes
 * @param {string} view.subject
 * @param {string} view.preheader
 * @param {string} view.title
 * @param {string[]} view.paragraphs
 * @param {{label:string,url:string}|null} view.button
 * @param {string|null} view.code   6-digit code
 * @param {string} view.footerNote  action-specific "ignore" sentence
 * @param {string} view.recipient   address this message is for (shown masked)
 */
export function renderEmail(view) {
  const colors = themeColors(view.theme);
  const kicker = view.theme.kicker;
  const sentTo = `Sent to ${maskEmail(view.recipient)} for your ${view.theme.accountLabel}. Fawxzzy never asks for your password by email.`;
  const icon = emailIconUrl(view.theme);
  const size = EMAIL_ICON_SIZE;

  const paragraphs = view.paragraphs
    .map(
      (paragraph) =>
        `<tr><td align="center" style="padding:0 0 14px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${colors.text};">${escapeHtml(paragraph)}</td></tr>`,
    )
    .join("");

  const code = view.code
    ? `<tr><td align="center" style="padding:10px 0 26px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td bgcolor="${colors.canvas}" style="border:1px solid ${colors.border};border-radius:16px;padding:14px 28px;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:36px;letter-spacing:0.3em;font-weight:700;color:${colors.accent};box-shadow:0 0 24px ${colors.glowSoft};">${escapeHtml(view.code)}</td></tr></table></td></tr>`
    : "";

  const button = view.button
    ? `<tr><td align="center" style="padding:14px 0 26px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" bgcolor="${colors.accent}" style="border-radius:999px;box-shadow:0 0 26px ${colors.glowStrong};"><a href="${escapeHtml(view.button.url)}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:${FONT};font-size:17px;line-height:20px;font-weight:600;color:${colors.onAccent};text-decoration:none;border-radius:999px;">${escapeHtml(view.button.label)}</a></td></tr></table></td></tr>
<tr><td align="center" style="padding:0 0 18px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${colors.muted};">Button not working? Paste this link into your browser:<br><a href="${escapeHtml(view.button.url)}" target="_blank" style="color:${colors.accent};word-break:break-all;text-decoration:underline;">${escapeHtml(view.button.url)}</a></td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(view.subject)}</title>
<style>
:root { color-scheme: dark light; supported-color-schemes: dark light; }
body { margin: 0; padding: 0; background-color: ${colors.canvas}; }
a { color: ${colors.accent}; }
@media only screen and (max-width: 620px) { .card { padding: 30px 20px 24px 20px !important; } .title { font-size: 30px !important; line-height: 36px !important; } }
</style>
</head>
<body bgcolor="${colors.canvas}" style="margin:0;padding:0;background-color:${colors.canvas};color:${colors.text};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${colors.canvas};">${escapeHtml(view.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colors.canvas}" style="background-color:${colors.canvas};">
<tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td class="card" bgcolor="${colors.surface}" style="background-color:${colors.surface};border:1px solid ${colors.border};border-radius:28px;padding:40px 36px 28px 36px;box-shadow:0 0 60px ${colors.glowSoft};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:0 0 18px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td style="border:1px solid ${colors.border};border-radius:22px;padding:3px;box-shadow:0 0 32px ${colors.glowStrong};"><img src="${escapeHtml(icon)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;border-radius:19px;"></td></tr></table></td></tr>
<tr><td align="center" style="padding:0 0 10px 0;font-family:${FONT};font-size:13px;line-height:18px;font-weight:600;letter-spacing:0.32em;text-transform:uppercase;color:${colors.accent};">${escapeHtml(kicker)}</td></tr>
<tr><td class="title" align="center" style="padding:0 0 20px 0;font-family:${FONT};font-size:34px;line-height:40px;font-weight:300;letter-spacing:-0.02em;color:${colors.text};">${escapeHtml(view.title)}</td></tr>
${paragraphs}
${button}${code}
<tr><td style="padding:6px 0 16px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${colors.rule}" style="height:1px;line-height:1px;font-size:1px;background-color:${colors.rule};">&nbsp;</td></tr></table></td></tr>
<tr><td align="center" style="padding:0 0 6px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${colors.muted};">${escapeHtml(view.footerNote)}</td></tr>
<tr><td align="center" style="font-family:${FONT};font-size:12px;line-height:18px;color:${colors.muted};">${escapeHtml(sentTo)}</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  const lines = [kicker.toUpperCase(), "", view.title, "", ...view.paragraphs.flatMap((paragraph) => [paragraph, ""])];
  if (view.button) lines.push(`${view.button.label}:`, view.button.url, "");
  if (view.code) lines.push(`Your code: ${view.code}`, "");
  lines.push("--", view.footerNote, sentTo, "");
  return { html, text: lines.join("\n") };
}
