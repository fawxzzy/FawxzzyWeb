import { authThemeBase } from "../_shared/auth-theme.mjs";

/**
 * Email-safe renderer: table layout, inline styles, no remote images, no
 * webfonts, no tracking. The look follows the account sign-in screens: charcoal
 * canvas, light text, per-app kicker and accent. Every dynamic string is
 * HTML-escaped; the only URL placed in markup is built by plan.mjs.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);
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

/** Resolve the concrete hex colors an email for `theme` uses. */
export function themeColors(theme) {
  const canvas = authThemeBase.canvasHex;
  const accent = rgbTripletToHex(theme.accentRgb);
  return {
    canvas,
    text: authThemeBase.textHex,
    muted: rgbTripletToHex(authThemeBase.mutedRgb),
    accent,
    /** Text color on the accent button: the canvas color, as on the sign-in dock. */
    onAccent: canvas,
    border: blendHex(accent, canvas, 0.36),
  };
}

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
 * @param {string} view.recipient   address this message is for
 */
export function renderEmail(view) {
  const colors = themeColors(view.theme);
  const kicker = view.theme.kicker;
  const receiving = `You're receiving this because of your ${view.theme.accountLabel}.`;

  const paragraphs = view.paragraphs
    .map(
      (paragraph) =>
        `<tr><td style="padding:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${colors.text};">${escapeHtml(paragraph)}</td></tr>`,
    )
    .join("");

  const code = view.code
    ? `<tr><td align="center" style="padding:8px 0 24px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td bgcolor="${colors.canvas}" style="border:1px solid ${colors.border};border-radius:14px;padding:14px 28px;font-family:'Courier New',Courier,monospace;font-size:32px;line-height:36px;letter-spacing:0.3em;font-weight:700;color:${colors.accent};">${escapeHtml(view.code)}</td></tr></table></td></tr>`
    : "";

  const button = view.button
    ? `<tr><td align="center" style="padding:8px 0 24px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" bgcolor="${colors.accent}" style="border-radius:14px;"><a href="${escapeHtml(view.button.url)}" target="_blank" style="display:inline-block;padding:15px 32px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:${colors.onAccent};text-decoration:none;border-radius:14px;">${escapeHtml(view.button.label)}</a></td></tr></table></td></tr>
<tr><td style="padding:0 0 16px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${colors.muted};">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(view.button.url)}" target="_blank" style="color:${colors.accent};word-break:break-all;text-decoration:underline;">${escapeHtml(view.button.url)}</a></td></tr>`
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
@media only screen and (max-width: 620px) { .card { padding: 24px 18px !important; } }
</style>
</head>
<body bgcolor="${colors.canvas}" style="margin:0;padding:0;background-color:${colors.canvas};color:${colors.text};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${colors.canvas};">${escapeHtml(view.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colors.canvas}" style="background-color:${colors.canvas};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td class="card" bgcolor="${colors.canvas}" style="background-color:${colors.canvas};border:1px solid ${colors.border};border-radius:22px;padding:36px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:0 0 22px 0;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;letter-spacing:0.32em;text-transform:uppercase;color:${colors.accent};">${escapeHtml(kicker)}</td></tr>
<tr><td align="center" style="padding:0 0 24px 0;font-family:${FONT};font-size:30px;line-height:34px;font-weight:500;letter-spacing:-0.03em;color:${colors.text};">${escapeHtml(view.title)}</td></tr>
${paragraphs}
${button}${code}
<tr><td style="padding:8px 0 20px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="2" bgcolor="${colors.accent}" style="height:2px;line-height:2px;font-size:2px;background-color:${colors.accent};">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:0 0 8px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${colors.muted};">${escapeHtml(receiving)} ${escapeHtml(view.footerNote)}</td></tr>
<tr><td style="font-family:${FONT};font-size:13px;line-height:20px;color:${colors.muted};">This message was sent to ${escapeHtml(view.recipient)}. Fawxzzy will never ask for your password by email.</td></tr>
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
  lines.push(
    "--",
    `${receiving} ${view.footerNote}`,
    `This message was sent to ${view.recipient}. Fawxzzy will never ask for your password by email.`,
    "",
  );
  return { html, text: lines.join("\n") };
}
