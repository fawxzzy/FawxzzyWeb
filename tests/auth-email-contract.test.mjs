import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

import {
  authThemeBase,
  authThemes,
  resolveAuthTheme,
  resolveAuthThemeFromRedirect,
} from "../supabase/functions/_shared/auth-theme.mjs";
import { handleAuthEmailRequest } from "../supabase/functions/auth-send-email/handler.mjs";
import {
  ACCOUNT_CONFIRM_URL,
  buildActionLink,
  HookPayloadError,
  planMessages,
} from "../supabase/functions/auth-send-email/plan.mjs";
import {
  blendHex,
  EMAIL_ICON_SIZE,
  emailIconUrl,
  escapeHtml,
  maskEmail,
  renderEmail,
  rgbTripletToHex,
  themeColors,
} from "../supabase/functions/auth-send-email/render.mjs";
import { RESEND_ENDPOINT, SEND_TIMEOUT_MS } from "../supabase/functions/auth-send-email/resend.mjs";
import {
  constantTimeEqual,
  signWebhook,
  TIMESTAMP_TOLERANCE_SECONDS,
  verifyWebhook,
  WebhookVerificationError,
} from "../supabase/functions/auth-send-email/standard-webhooks.mjs";
import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

// Obvious dummy values only. None of these is a real credential.
const DUMMY_SECRET = `v1,whsec_${Buffer.from("dummy-hook-secret-for-tests-only-0123456789").toString("base64")}`;
const OTHER_SECRET = `v1,whsec_${Buffer.from("a-different-dummy-secret-for-tests-0000").toString("base64")}`;
const DUMMY_API_KEY = "re_DUMMY_TEST_KEY_not_real";
const SUPABASE_URL = "https://dummyref.supabase.co";
const NOW = 1_800_000_000;

const portalAccount = loadPortalModule("src/config/account.ts");
const portalContract = loadPortalModule("src/lib/auth/callback-contract.ts");
const { accountExperienceContexts, accountRecoveryUrl, accountConfirmUrl, accountUrls } = portalAccount;
const { parseConfirmPayload, parseRecoveryPayload } = portalContract;

function hookPayload(overrides = {}) {
  const { user, email_data, ...rest } = overrides;
  return {
    user: {
      id: "00000000-0000-0000-0000-000000000000",
      aud: "authenticated",
      role: "authenticated",
      email: "person@example.test",
      ...user,
    },
    email_data: {
      token: "123456",
      token_hash: "hash_current_abc",
      redirect_to: accountRecoveryUrl("fitness"),
      email_action_type: "recovery",
      site_url: "https://account.fawxzzy.com",
      token_new: "",
      token_hash_new: "",
      ...email_data,
    },
    ...rest,
  };
}

async function signedRequest(payload, { secret = DUMMY_SECRET, timestamp = NOW, id = "msg_test_1", method = "POST" } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signature = await signWebhook(secret, id, timestamp, body);
  return new Request("https://hook.test/auth-send-email", {
    method,
    headers: { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": signature },
    ...(method === "POST" ? { body } : {}),
  });
}

function mockFetch(responder = () => new Response('{"id":"email_1"}', { status: 200 })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return responder(url, init, calls.length);
  };
  return { calls, fetchImpl };
}

const goodEnv = () => ({
  SEND_EMAIL_HOOK_SECRET: DUMMY_SECRET,
  RESEND_API_KEY: DUMMY_API_KEY,
  AUTH_EMAIL_FROM: "Fawxzzy <no-reply@fawxzzy.com>",
  SUPABASE_URL,
});

// WCAG 2.x contrast.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------- signature

test("signature: valid signature verifies, with and without the v1,whsec_ prefix", async () => {
  const body = '{"a":1}';
  const signature = await signWebhook(DUMMY_SECRET, "id1", NOW, body);
  const headers = new Headers({ "webhook-id": "id1", "webhook-timestamp": String(NOW), "webhook-signature": signature });
  await verifyWebhook({ secret: DUMMY_SECRET, headers, body, nowSeconds: NOW });
  await verifyWebhook({ secret: DUMMY_SECRET.replace(/^v1,whsec_/, ""), headers, body, nowSeconds: NOW });
});

test("signature: matches an independently computed Standard Webhooks HMAC", async () => {
  const { createHmac } = await import("node:crypto");
  const key = Buffer.from(DUMMY_SECRET.replace(/^v1,whsec_/, ""), "base64");
  const expected = `v1,${createHmac("sha256", key).update(`id1.${NOW}.body`).digest("base64")}`;
  assert.equal(await signWebhook(DUMMY_SECRET, "id1", NOW, "body"), expected);
});

test("signature: wrong secret, tampered body, wrong id/timestamp, missing headers reject", async () => {
  const body = '{"a":1}';
  const good = await signWebhook(DUMMY_SECRET, "id1", NOW, body);
  const base = { "webhook-id": "id1", "webhook-timestamp": String(NOW), "webhook-signature": good };
  const reject = async (headers, requestBody = body, secret = DUMMY_SECRET) =>
    assert.rejects(
      verifyWebhook({ secret, headers: new Headers(headers), body: requestBody, nowSeconds: NOW }),
      WebhookVerificationError,
    );
  await reject(base, body, OTHER_SECRET);
  await reject(base, '{"a":2}');
  await reject({ ...base, "webhook-id": "id2" });
  await reject({ ...base, "webhook-timestamp": String(NOW + 1) });
  await reject({ ...base, "webhook-signature": "v1,AAAA" });
  await reject({ ...base, "webhook-signature": good.replace("v1,", "v2,") });
  for (const name of Object.keys(base)) {
    const rest = Object.fromEntries(Object.entries(base).filter(([key]) => key !== name));
    await reject(rest);
  }
});

test("signature: stale and future timestamps outside tolerance reject, edge accepted", async () => {
  const body = "{}";
  const attempt = async (timestamp) => {
    const signature = await signWebhook(DUMMY_SECRET, "id1", timestamp, body);
    const headers = new Headers({ "webhook-id": "id1", "webhook-timestamp": String(timestamp), "webhook-signature": signature });
    return verifyWebhook({ secret: DUMMY_SECRET, headers, body, nowSeconds: NOW });
  };
  await assert.rejects(attempt(NOW - TIMESTAMP_TOLERANCE_SECONDS - 1), WebhookVerificationError);
  await assert.rejects(attempt(NOW + TIMESTAMP_TOLERANCE_SECONDS + 1), WebhookVerificationError);
  await attempt(NOW - TIMESTAMP_TOLERANCE_SECONDS);
  await attempt(NOW + TIMESTAMP_TOLERANCE_SECONDS);
});

test("signature: a header carrying several signatures accepts when any one is valid", async () => {
  const body = "{}";
  const good = await signWebhook(DUMMY_SECRET, "id1", NOW, body);
  const bad = await signWebhook(OTHER_SECRET, "id1", NOW, body);
  const headers = new Headers({
    "webhook-id": "id1",
    "webhook-timestamp": String(NOW),
    "webhook-signature": `${bad} ${good}`,
  });
  await verifyWebhook({ secret: DUMMY_SECRET, headers, body, nowSeconds: NOW });
});

test("signature: constant-time compare covers length and content", () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])), false);
  assert.equal(constantTimeEqual(new Uint8Array([]), new Uint8Array([0])), false);
});

// -------------------------------------------------------------------- theme

test("theme: app query parameter selects the theme; unknown or missing falls back to default", () => {
  assert.equal(resolveAuthThemeFromRedirect("https://account.fawxzzy.com/reset-password?recovery=1&app=fitness").id, "fitness");
  assert.equal(resolveAuthThemeFromRedirect("https://account.fawxzzy.com/reset-password?recovery=1&app=mazer").id, "mazer");
  for (const redirect of [
    "https://account.fawxzzy.com/reset-password?recovery=1",
    "https://account.fawxzzy.com/reset-password?recovery=1&app=unknown",
    "https://account.fawxzzy.com/reset-password?recovery=1&app=__proto__",
    "https://account.fawxzzy.com/reset-password?recovery=1&app=constructor",
    "https://account.fawxzzy.com/reset-password?recovery=1&app=fitness&app=mazer",
    "https://account.fawxzzy.com/reset-password?app=FITNESS",
    "not a url",
    "",
    undefined,
  ]) {
    assert.equal(resolveAuthThemeFromRedirect(redirect).id, "website", String(redirect));
  }
  assert.equal(resolveAuthTheme(undefined).id, "website");
});

test("theme: the kicker, accent and wording appear in the rendered email for each app", () => {
  for (const [id, theme] of Object.entries(authThemes)) {
    const redirect = id === "website" ? accountRecoveryUrl("website") : accountRecoveryUrl(id);
    const [message] = planMessages(hookPayload({ email_data: { redirect_to: redirect } }), { supabaseUrl: SUPABASE_URL });
    const accentHex = rgbTripletToHex(theme.accentRgb);
    assert.ok(message.html.includes(`>${theme.kicker}</td>`), `${id} kicker in html`);
    assert.ok(message.html.includes(accentHex), `${id} accent in html`);
    assert.ok(message.html.includes(`your ${theme.accountLabel}.`), `${id} receiving line`);
    assert.ok(message.text.startsWith(theme.kicker.toUpperCase()), `${id} kicker in text`);
    assert.ok(message.subject.includes(theme.kicker), `${id} subject`);
  }
});

// ------------------------------------------------------------------- parity

test("parity: portal per-app tokens (evaluated from src/config/account.ts) equal the email theme tokens", () => {
  assert.deepEqual(Object.keys(accountExperienceContexts).sort(), Object.keys(authThemes).sort());
  for (const [id, theme] of Object.entries(authThemes)) {
    const context = accountExperienceContexts[id];
    assert.equal(context.accentRgb, theme.accentRgb, `${id} accent`);
    assert.equal(context.productName, theme.kicker, `${id} kicker`);
  }
  const loaded = loadPortalModule("src/config/product.ts");
  assert.equal(authThemes.website.kicker, loaded.productIdentity.publicName);
});

test("parity: the portal and email renderer do not hard-code a second copy of the tokens", async () => {
  const sources = {
    "src/config/account.ts": await readFile(new URL("../src/config/account.ts", import.meta.url), "utf8"),
    "render.mjs": await readFile(new URL("../supabase/functions/auth-send-email/render.mjs", import.meta.url), "utf8"),
    "plan.mjs": await readFile(new URL("../supabase/functions/auth-send-email/plan.mjs", import.meta.url), "utf8"),
  };
  const rgbTriplet = /["']\d{1,3} \d{1,3} \d{1,3}["']/;
  const hexColor = /["']#[0-9a-fA-F]{6}["']/;
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, rgbTriplet, `${name} hard-codes an RGB token`);
    assert.doesNotMatch(source, hexColor, `${name} hard-codes a hex color`);
  }
  assert.match(sources["src/config/account.ts"], /supabase\/functions\/_shared\/auth-theme\.mjs/);
  for (const id of Object.keys(authThemes)) {
    assert.match(sources["src/config/account.ts"], new RegExp(`authThemes\\.${id}\\.accentRgb`));
    assert.match(sources["src/config/account.ts"], new RegExp(`authThemes\\.${id}\\.kicker`));
  }
});

test("parity: base canvas, text, muted and font tokens match the portal CSS the sign-in screen uses", async () => {
  const utility = await readFile(new URL("../src/styles/page-families/utility.css", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../src/styles/foundations/tokens-and-reset.css", import.meta.url), "utf8");
  const block = utility.match(/\.app-theme-fawxzzy\.account-page--utility\s*\{([^}]*)\}/);
  assert.ok(block, "utility auth page block exists");
  assert.match(block[1], new RegExp(`color:\\s*${authThemeBase.textHex};`));
  assert.ok(block[1].includes(`, ${authThemeBase.canvasHex};`), "canvas color is the gradient base");
  assert.ok(block[1].includes(`font-family: ${authThemeBase.fontFamily};`), "font family");
  assert.match(tokens, new RegExp(`--muted:\\s*${authThemeBase.mutedRgb};`));
  // The kicker is uppercased and tracked by the same rule on the screen (Auth Surface v2).
  const surface = await readFile(new URL("../src/styles/page-families/auth-surface.css", import.meta.url), "utf8");
  assert.match(surface, /\.auth-kicker \{[^}]*color: rgb\(var\(--ac\)\);[^}]*text-transform: uppercase;/s);
  // The v1 auth card rules are gone; nothing may reintroduce them.
  assert.doesNotMatch(utility, /\.account-auth-/);
});

// --------------------------------------------------------------- all actions

const ACTION_CASES = [
  ["signup", { redirect_to: accountConfirmUrl("fitness", "state-1") }],
  ["invite", { redirect_to: accountConfirmUrl("mazer", "state-2") }],
  ["magiclink", { redirect_to: accountConfirmUrl("fitness", "state-3") }],
  ["email", { redirect_to: accountConfirmUrl("fitness", "state-4") }],
  ["recovery", { redirect_to: accountRecoveryUrl("fitness") }],
  ["email_change", { redirect_to: accountConfirmUrl("fitness", "state-5") }],
  ["reauthentication", { token: "654321" }],
  ["password_changed_notification", {}],
  ["email_changed_notification", {}],
  ["phone_changed_notification", {}],
  ["identity_linked_notification", {}],
  ["identity_unlinked_notification", {}],
  ["mfa_factor_enrolled_notification", {}],
  ["mfa_factor_unenrolled_notification", {}],
  ["some_future_action_type", {}],
];

test("every email_action_type renders html + plain text with subject, preheader and kicker", () => {
  for (const [type, data] of ACTION_CASES) {
    const payload = hookPayload({
      user: { new_email: "new-address@example.test" },
      email_data: { email_action_type: type, ...data },
    });
    const messages = planMessages(payload, { supabaseUrl: SUPABASE_URL });
    assert.ok(messages.length >= 1, type);
    for (const message of messages) {
      assert.ok(message.subject.length > 3 && !/[\r\n]/.test(message.subject), `${type} subject`);
      assert.match(message.html, /^<!doctype html>/, type);
      assert.ok(message.text.length > 40, `${type} plain text present`);
      assert.ok(message.text.includes(`Sent to ${maskEmail(message.to)} `), `${type} masked recipient in text`);
      assert.ok(message.html.includes(`Sent to ${escapeHtml(maskEmail(message.to))} `), `${type} masked recipient in html`);
      assert.match(message.html, /display:none;max-height:0;overflow:hidden/, `${type} preheader block`);
      assert.match(message.html, /<meta name="color-scheme" content="dark light">/, type);
      assert.match(message.html, /max-width:600px/, type);
      assert.match(message.html, /role="presentation"/, type);
    }
  }
});

test("reauthentication shows the six-digit code and no link; malformed codes are rejected", () => {
  const [message] = planMessages(
    hookPayload({ email_data: { email_action_type: "reauthentication", token: "654321" } }),
    { supabaseUrl: SUPABASE_URL },
  );
  assert.ok(message.html.includes(">654321</td>"));
  assert.ok(message.text.includes("Your code: 654321"));
  assert.doesNotMatch(message.html, /<a /);
  assert.throws(
    () => planMessages(hookPayload({ email_data: { email_action_type: "reauthentication", token: "12<script>" } }), { supabaseUrl: SUPABASE_URL }),
    HookPayloadError,
  );
});

test("email_change: secure change sends two emails with the reversed token fields; single change sends one", () => {
  const base = { user: { new_email: "new-address@example.test" }, email_data: { email_action_type: "email_change", redirect_to: accountConfirmUrl("fitness", "s") } };
  const secure = planMessages(
    hookPayload({ ...base, email_data: { ...base.email_data, token_hash: "HASH_FOR_NEW", token_hash_new: "HASH_FOR_CURRENT" } }),
    { supabaseUrl: SUPABASE_URL },
  );
  assert.equal(secure.length, 2);
  assert.equal(secure[0].to, "person@example.test");
  assert.ok(secure[0].text.includes("token_hash=HASH_FOR_CURRENT"));
  assert.equal(secure[1].to, "new-address@example.test");
  assert.ok(secure[1].text.includes("token_hash=HASH_FOR_NEW"));
  assert.notEqual(secure[0].subject, secure[1].subject);

  const single = planMessages(hookPayload(base), { supabaseUrl: SUPABASE_URL });
  assert.equal(single.length, 1);
  assert.equal(single[0].to, "new-address@example.test");

  assert.throws(
    () => planMessages(hookPayload({ email_data: base.email_data }), { supabaseUrl: SUPABASE_URL }),
    HookPayloadError,
    "email_change without new_email fails loudly instead of mailing the wrong address",
  );
});

test("email_change: the portal's change link lands on the allow-listed confirm route, themed", () => {
  for (const contextId of ["website", "fitness", "mazer"]) {
    const redirect = portalAccount.accountEmailChangeUrl(contextId);
    const [message] = planMessages(
      hookPayload({
        user: { new_email: "new-address@example.test" },
        email_data: { email_action_type: "email_change", redirect_to: redirect, token_hash: "HASH_NEW", token_hash_new: "" },
      }),
      { supabaseUrl: SUPABASE_URL },
    );
    const link = new URL(message.text.match(/https:\/\/\S+/)[0]);
    assert.equal(`${link.origin}${link.pathname}`, ACCOUNT_CONFIRM_URL, contextId);
    assert.equal(link.searchParams.get("type"), "email_change");
    assert.equal(link.searchParams.get("token_hash"), "HASH_NEW");
    assert.equal(link.searchParams.get("returnTo"), contextId === "website" ? null : `https://${contextId}.fawxzzy.com/`, "the fixed allow-listed home; the confirm route never follows it for email_change");
    assert.equal(link.searchParams.get("app"), contextId === "website" ? null : contextId);
    const payload = parseConfirmPayload(link);
    assert.equal(payload?.type, "email_change");
  }
});

test("email_changed_notification goes to the old address named by the hook; otherwise to the account address", () => {
  const notify = (emailData, user = {}) =>
    planMessages(
      hookPayload({ user: { email: "new-address@example.test", ...user }, email_data: { email_action_type: "email_changed_notification", ...emailData } }),
      { supabaseUrl: SUPABASE_URL },
    );
  const [toOld] = notify({ old_email: "old-address@example.test" });
  assert.equal(toOld.to, "old-address@example.test");
  assert.match(toOld.subject, /email address was changed/);
  assert.equal(notify({})[0].to, "new-address@example.test", "no old_email: falls back to the account address");
  assert.equal(notify({ old_email: "not an address" })[0].to, "new-address@example.test", "a malformed old_email is never used");
  assert.equal(notify({ old_email: "" })[0].to, "new-address@example.test");
  // Other notifications ignore old_email entirely.
  const [password] = planMessages(
    hookPayload({ email_data: { email_action_type: "password_changed_notification", old_email: "old-address@example.test" } }),
    { supabaseUrl: SUPABASE_URL },
  );
  assert.equal(password.to, "person@example.test");
});

test("notification and fallback emails never include an action link", () => {
  for (const type of [
    "password_changed_notification",
    "email_changed_notification",
    "mfa_factor_enrolled_notification",
    "some_future_action_type",
  ]) {
    const [message] = planMessages(hookPayload({ email_data: { email_action_type: type } }), { supabaseUrl: SUPABASE_URL });
    assert.doesNotMatch(message.html, /<a /, type);
    assert.doesNotMatch(message.text, /https?:\/\//, type);
  }
});

test("emails carry exactly one image (the app icon) and no webfonts, trackers or scripts", () => {
  for (const [type, data] of ACTION_CASES) {
    const [message] = planMessages(
      hookPayload({ user: { new_email: "n@example.test" }, email_data: { email_action_type: type, ...data } }),
      { supabaseUrl: SUPABASE_URL },
    );
    for (const forbidden of [/<link/i, /<script/i, /<iframe/i, /@import/i, /@font-face/i, /url\(/i, /http:\/\//i, /<form/i, /background(-image)?\s*:\s*[^;"]*gradient/i]) {
      assert.doesNotMatch(message.html, forbidden, `${type} ${forbidden}`);
    }
    const images = [...message.html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
    assert.equal(images.length, 1, `${type} has one image`);
    const src = images[0].match(/\ssrc="([^"]*)"/)[1];
    assert.equal(src, emailIconUrl(resolveAuthThemeFromRedirect(data.redirect_to ?? accountRecoveryUrl("fitness"))), `${type} image is the app icon`);
    assert.match(images[0], new RegExp(`width="${EMAIL_ICON_SIZE}" height="${EMAIL_ICON_SIZE}"`), `${type} icon has fixed size (Outlook)`);
    assert.match(images[0], /\salt=""/, `${type} icon is decorative: the kicker under it names the app`);
    const hrefs = [...message.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    for (const href of hrefs) assert.match(href, /^https:\/\//);
  }
});

// -------------------------------------------------------------------- icons

// Byte-exact copies of each app's own branding output (AGENTS.md: no repo-owned canonical icons).
// A rebrand updates the source app first, then re-copies here and updates the hash.
const EMAIL_ICON_SOURCES = {
  website: { source: "FawxzzyWeb public/app/icon-192.png", sha256: "706fbaae6ed1f82d736b03f8d334246257c7c2ad12d8d2edb4b2ca4a37525018" },
  fitness: { source: "fawxzzy-fitness public/app/icon-192.png", sha256: "558f4236982b7d81b37e9beebebbab6de990ba5c4f8e1326686d56ac1f387b84" },
  mazer: { source: "mazer public/icons/icon-192.png", sha256: "cf8f46d880655b987bd10d9d371117525043cf842d7cb10270e741a653f30785" },
};

test("icons: every theme's email icon is an absolute https URL on the account host under /email/icons/", () => {
  assert.equal(authThemeBase.emailAssetOrigin, new URL(ACCOUNT_CONFIRM_URL).origin, "icons come from the host the links point to");
  for (const [id, theme] of Object.entries(authThemes)) {
    const url = new URL(emailIconUrl(theme));
    assert.equal(url.protocol, "https:", id);
    assert.equal(url.origin, "https://account.fawxzzy.com", id);
    assert.match(url.pathname, /^\/email\/icons\/[a-z]+-192\.png$/, id);
    assert.equal(url.search + url.hash, "", `${id} icon URL carries no query (no tracking)`);
  }
  assert.equal(new Set(Object.values(authThemes).map(emailIconUrl)).size, 3, "each app has its own icon");
});

test("icons: each email icon file ships from public/, is a 192 px PNG and is the app's own branding output", async () => {
  const { createHash } = await import("node:crypto");
  const { default: sharp } = await import("sharp");
  assert.deepEqual(Object.keys(EMAIL_ICON_SOURCES).sort(), Object.keys(authThemes).sort());
  for (const [id, theme] of Object.entries(authThemes)) {
    const bytes = await readFile(new URL(`../public${theme.emailIconPath}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${id} is a PNG (email clients do not all show WebP or SVG)`);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 192, `${id} width`);
    assert.equal(meta.height, 192, `${id} height`);
    assert.ok(meta.width >= EMAIL_ICON_SIZE * 2, `${id} stays sharp at 2x`);
    assert.ok(bytes.length < 100 * 1024, `${id} is small enough for mobile mail (${bytes.length} bytes)`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), EMAIL_ICON_SOURCES[id].sha256, `${id} is the exact ${EMAIL_ICON_SOURCES[id].source}`);
  }
});

test("parity: the email icon shows the same artwork as the portal auth screen icon", async () => {
  const { default: sharp } = await import("sharp");
  const thumb = async (path) =>
    sharp(await readFile(new URL(`../public${path}`, import.meta.url)))
      .flatten({ background: authThemeBase.canvasHex })
      .resize(24, 24, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
  const distance = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
  const thumbs = {};
  for (const [id, theme] of Object.entries(authThemes)) {
    thumbs[id] = { email: await thumb(theme.emailIconPath), portal: await thumb(theme.iconPath) };
  }
  for (const id of Object.keys(authThemes)) {
    const same = distance(thumbs[id].email, thumbs[id].portal);
    assert.ok(same < 12, `${id}: email icon differs from the portal icon (mean channel distance ${same.toFixed(1)})`);
    for (const other of Object.keys(authThemes).filter((key) => key !== id)) {
      const cross = distance(thumbs[id].email, thumbs[other].portal);
      assert.ok(cross > same * 1.5, `${id}: the check is real (${other} portal icon scores ${cross.toFixed(1)} vs ${same.toFixed(1)})`);
    }
  }
});

test("icons: three separate portal icons, pinned (Mazer M, Fitness fox, Fawxzzy fox F); the retired Fitness trident stays deleted", async () => {
  const { createHash } = await import("node:crypto");
  const { existsSync } = await import("node:fs");
  const PORTAL_ICON_SHA256 = {
    website: "706fbaae6ed1f82d736b03f8d334246257c7c2ad12d8d2edb4b2ca4a37525018",
    fitness: "68ea981e132b52b38a8cf56a9c931361881a52b19cb302eedc7502448f82a23e",
    mazer: "d369527a7cf096cc16dc701ef8986b70875a78eff17a3e5016d27e0beec00826",
  };
  for (const [id, theme] of Object.entries(authThemes)) {
    const bytes = await readFile(new URL(`../public${theme.iconPath}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), PORTAL_ICON_SHA256[id], `${id} portal icon ${theme.iconPath}`);
  }
  assert.equal(new Set(Object.values(PORTAL_ICON_SHA256)).size, 3, "no two skins share an icon file");
  assert.ok(!existsSync(new URL("../public/apps/fitness/icon-192.png", import.meta.url)), "retired Fitness trident icon is not shipped");
});

test("parity: the portal auth screens take their icon paths from auth-theme.mjs, not a second copy", async () => {
  const status = await readFile(new URL("../src/components/account/auth-status.tsx", import.meta.url), "utf8");
  assert.match(status, /supabase\/functions\/_shared\/auth-theme\.mjs/);
  for (const id of Object.keys(authThemes)) assert.match(status, new RegExp(`authThemes\\.${id}\\.iconPath`));
  for (const theme of Object.values(authThemes)) {
    assert.ok(!status.includes(`"${theme.iconPath}"`), `auth-status.tsx hard-codes ${theme.iconPath}`);
  }
  const render = await readFile(new URL("../supabase/functions/auth-send-email/render.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(render, /["'][^"']*\.(png|webp|svg|jpe?g)["']/i, "render.mjs hard-codes an image path");
});

// -------------------------------------------------------------------- words

test("words: emails are masked the same way as the portal copy matrix, always from the message's own addresses", () => {
  const matrix = loadPortalModule("src/lib/auth/copy-matrix.ts");
  for (const sample of ["zac@icloud.com", "  a.b+c@example.test ", "x@y", "", "nodomain", "@example.test", "o'brien&co@example.test"]) {
    assert.equal(maskEmail(sample), matrix.maskEmail(sample), JSON.stringify(sample));
  }
  const payload = (type, extra = {}) =>
    hookPayload({
      user: { email: "person@example.test", new_email: "new-address@example.test" },
      email_data: { email_action_type: type, redirect_to: accountConfirmUrl("fitness", "s"), ...extra },
    });
  const [signup] = planMessages(payload("signup"), { supabaseUrl: SUPABASE_URL });
  assert.ok(signup.text.includes("confirm p•••@example.test and finish"), "signup names the masked address");
  const [recovery] = planMessages(payload("recovery", { redirect_to: accountRecoveryUrl("fitness") }), { supabaseUrl: SUPABASE_URL });
  assert.ok(recovery.text.includes("new password for p•••@example.test"), "recovery names the masked address");
  const secure = planMessages(payload("email_change", { token_hash: "N", token_hash_new: "C" }), { supabaseUrl: SUPABASE_URL });
  assert.ok(secure[0].text.includes("from p•••@example.test to n•••@example.test"), "current address sees both, masked");
  assert.ok(secure[1].text.includes("use n•••@example.test for your Fitness account"), "new address sees itself, masked");
  assert.ok(secure[1].text.includes("link we sent to p•••@example.test too"), "secure change says both links are needed");
  const [single] = planMessages(payload("email_change"), { supabaseUrl: SUPABASE_URL });
  assert.ok(single.text.includes("Your old email keeps working until you open the link."), "copy-matrix lead.changeEmail wording");
  const [changed] = planMessages(
    hookPayload({ user: { email: "new-address@example.test" }, email_data: { email_action_type: "email_changed_notification", old_email: "old@example.test", redirect_to: accountConfirmUrl("mazer", "s") } }),
    { supabaseUrl: SUPABASE_URL },
  );
  assert.equal(changed.to, "old@example.test");
  assert.ok(changed.text.includes("Your Mazer account email changed to n•••@example.test."), "notice names the new address, masked");
  assert.ok(changed.text.includes("Sent to o•••@example.test "), "footer names the old address, masked");
});

test("words: no email shows a full address, a retired line or jargon", () => {
  const matrix = loadPortalModule("src/lib/auth/copy-matrix.ts");
  const banned = [...matrix.RETIRED_AUTH_COPY, "needs verification", "(later)", "token", "OTP", "redirect", "Supabase", "expires soon."];
  for (const app of ["website", "fitness", "mazer"]) {
    for (const [type, data] of ACTION_CASES) {
      const messages = planMessages(
        hookPayload({
          user: { email: "person@example.test", new_email: "new-address@example.test" },
          email_data: { email_action_type: type, ...data, token_hash_new: type === "email_change" ? "C" : "", redirect_to: accountConfirmUrl(app, "s"), old_email: "old@example.test" },
        }),
        { supabaseUrl: SUPABASE_URL },
      );
      for (const message of messages) {
        // Only the human-readable words: drop the link lines (they carry token_hash) before checking.
        const words = message.text.split("\n").filter((line) => !/^https:\/\//.test(line)).join("\n");
        for (const phrase of banned.filter((item) => !(type === "reauthentication" && item === "expires soon."))) {
          assert.ok(!words.includes(phrase), `${app}/${type}: "${phrase}"`);
        }
        for (const address of ["person@example.test", "new-address@example.test", "old@example.test"]) {
          assert.ok(!words.includes(address), `${app}/${type}: full address ${address} in words`);
          assert.ok(!message.html.replace(/href="[^"]*"|>https:\/\/[^<]*</g, "").includes(address), `${app}/${type}: full address ${address} in html`);
        }
        assert.match(message.subject, /^[A-Z][^A-Z]*( [A-Z][a-z]+)?[^A-Z]*$/, `${app}/${type} subject is sentence case`);
      }
    }
  }
});

// ---------------------------------------------------------------- escaping

test("escaping: user-controlled strings are HTML-escaped in every position", () => {
  assert.equal(escapeHtml(`<b>"x"&'y'</b>`), "&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;");
  const hostile = `"><img src=x onerror=alert(1)>@example.test`;
  // Not a valid recipient for planning (rejected), so render directly as well.
  assert.throws(() => planMessages(hookPayload({ user: { email: hostile } }), { supabaseUrl: SUPABASE_URL }), HookPayloadError);
  const view = {
    theme: authThemes.fitness,
    subject: `<script>alert("s")</script>`,
    preheader: `<i>pre</i>`,
    title: `<u>title</u>`,
    paragraphs: [`<script>alert(1)</script>`],
    button: { label: `"><b>`, url: `https://x.test/?a="><script>alert(2)</script>&b=1` },
    code: `<code>`,
    footerNote: `<s>note</s>`,
    recipient: `a"b<i>@example.test`,
  };
  const { html } = renderEmail(view);
  for (const raw of ["<script", "<img src=x", "<b>", "<i>", "<u>", "<s>", "<code>"]) {
    assert.ok(!html.includes(raw), `unescaped ${raw}`);
  }
  assert.equal(html.match(/<img\b/g).length, 1, "only the app icon image");
  assert.ok(html.includes("?a=&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;&amp;b=1"), "url attribute escaped");
  assert.ok(html.includes("a•••@example.test"), "recipient is shown masked");
  assert.ok(!html.includes("a&quot;b&lt;i&gt;@example.test"), "the full recipient is never shown");
  assert.ok(html.includes("&amp;b=1"));
});

test("escaping: a recipient with markup-significant characters is escaped in a planned message", () => {
  const [message] = planMessages(hookPayload({ user: { email: "o'brien&co@ex'am&ple.test" } }), { supabaseUrl: SUPABASE_URL });
  assert.ok(message.html.includes("o•••@ex&#39;am&amp;ple.test"));
  assert.doesNotMatch(message.html, /ex'am&ple/);
  assert.doesNotMatch(message.html, /brien/, "the local part is masked away");
});

// ---------------------------------------------------------------- contrast

test("contrast: every themed text/background pair is at least 4.5:1 (button text on accent included)", () => {
  for (const [id, theme] of Object.entries(authThemes)) {
    const colors = themeColors(theme);
    const pairs = {
      "button text on accent": [colors.onAccent, colors.accent],
      "body text on canvas": [colors.text, colors.canvas],
      "muted text on canvas": [colors.muted, colors.canvas],
      "accent kicker/link on canvas": [colors.accent, colors.canvas],
      "body text on card": [colors.text, colors.surface],
      "muted text on card": [colors.muted, colors.surface],
      "accent kicker/link on card": [colors.accent, colors.surface],
    };
    for (const [name, [foreground, background]] of Object.entries(pairs)) {
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= 4.5, `${id}: ${name} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("contrast: the check is real (a low-contrast accent would fail it)", () => {
  assert.ok(contrast("#777777", "#7a7a7a") < 4.5);
  assert.ok(contrast(authThemeBase.canvasHex, "#2a2a2a") < 4.5);
  assert.equal(blendHex("#ffffff", "#000000", 0.5), "#808080");
});

// ------------------------------------------------------- link construction

test("links: recovery uses the Supabase verify URL, and that is what the reset route requires", () => {
  for (const app of ["fitness", "mazer", "website"]) {
    const redirectTo = accountRecoveryUrl(app);
    const [message] = planMessages(hookPayload({ email_data: { redirect_to: redirectTo } }), { supabaseUrl: SUPABASE_URL });
    const link = message.text.match(/https:\/\/\S+/)[0];
    const url = new URL(link);
    assert.equal(url.origin + url.pathname, `${SUPABASE_URL}/auth/v1/verify`);
    assert.equal(url.searchParams.get("token"), "hash_current_abc");
    assert.equal(url.searchParams.get("type"), "recovery");
    assert.equal(url.searchParams.get("redirect_to"), redirectTo, "redirect_to round-trips exactly");
    assert.ok(message.html.includes(escapeHtml(link)), "the same link is in the html button");

    // The redirect target is exactly what the portal allow-list/reset route expects...
    assert.equal(redirectTo.startsWith("https://account.fawxzzy.com/reset-password?recovery=1"), true);
    // ...and after Supabase verifies the token it appends a PKCE `code`, which the reset route accepts:
    const afterVerify = new URL(redirectTo);
    afterVerify.searchParams.set("code", "pkce-code");
    assert.deepEqual(parseRecoveryPayload(afterVerify), { code: "pkce-code" });
    // The reset route would REJECT a token_hash placed directly on it, which is why the verify URL is required.
    const direct = new URL(redirectTo);
    direct.searchParams.set("token_hash", "hash_current_abc");
    direct.searchParams.set("type", "recovery");
    assert.equal(parseRecoveryPayload(direct), null);
  }
});

test("links: signup/invite/magiclink/email_change go straight to the confirm route and the portal parses them", () => {
  for (const [type, app] of [["signup", "fitness"], ["invite", "mazer"], ["magiclink", "fitness"], ["email", "fitness"], ["email_change", "fitness"]]) {
    const redirectTo = accountConfirmUrl(app, "browser-state");
    const link = buildActionLink({ supabaseUrl: SUPABASE_URL, tokenHash: "hash_current_abc", type, redirectTo });
    const url = new URL(link);
    assert.equal(url.origin + url.pathname, ACCOUNT_CONFIRM_URL, `${type} lands on the confirm route`);
    const payload = parseConfirmPayload(url);
    assert.ok(payload, `${type} accepted by parseConfirmPayload`);
    assert.equal(payload.tokenHash, "hash_current_abc");
    assert.equal(payload.type, type);
    assert.equal(payload.state, "browser-state", "state the Fitness confirm check needs survives");
    assert.equal(payload.returnTo, new URL(redirectTo).searchParams.get("returnTo"), "returnTo survives sanitize");
    assert.equal(url.searchParams.get("app"), app, "app theme survives");
  }
  assert.equal(accountUrls.confirm, ACCOUNT_CONFIRM_URL, "plan.mjs confirm URL equals the portal contract");
});

test("links: a redirect_to that is not the account confirm route uses the Supabase verify URL", () => {
  for (const redirectTo of [
    "https://account.fawxzzy.com/account",
    "https://evil.example/auth/confirm?app=fitness",
    "https://account.fawxzzy.com/auth/confirm?token_hash=preset",
    `${ACCOUNT_CONFIRM_URL}#fragment`,
    "",
  ]) {
    const link = buildActionLink({ supabaseUrl: SUPABASE_URL, tokenHash: "h", type: "signup", redirectTo });
    assert.ok(link.startsWith(`${SUPABASE_URL}/auth/v1/verify?`), redirectTo);
  }
  assert.throws(() => buildActionLink({ supabaseUrl: SUPABASE_URL, tokenHash: "", type: "signup", redirectTo: "" }), HookPayloadError);
});

// ------------------------------------------------------------- handler/send

test("handler: success sends one Resend request with the documented shape and returns 200 {}", async () => {
  const { calls, fetchImpl } = mockFetch();
  const request = await signedRequest(hookPayload());
  const response = await handleAuthEmailRequest(request, { env: goodEnv(), fetchImpl, nowSeconds: NOW });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, RESEND_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${DUMMY_API_KEY}`);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "msg_test_1/0");
  assert.equal(calls[0].body.from, "Fawxzzy <no-reply@fawxzzy.com>");
  assert.deepEqual(calls[0].body.to, ["person@example.test"]);
  assert.match(calls[0].body.subject, /Reset your Fitness password/);
  assert.ok(calls[0].body.html.includes("<!doctype html>") && calls[0].body.text.length > 0);
});

test("handler: secure email change sends both emails and fails if the second send fails", async () => {
  const payload = hookPayload({
    user: { new_email: "new-address@example.test" },
    email_data: { email_action_type: "email_change", redirect_to: accountConfirmUrl("mazer", "s"), token_hash: "N", token_hash_new: "C" },
  });
  const ok = mockFetch();
  const response = await handleAuthEmailRequest(await signedRequest(payload), { env: goodEnv(), fetchImpl: ok.fetchImpl, nowSeconds: NOW });
  assert.equal(response.status, 200);
  assert.deepEqual(ok.calls.map((call) => call.body.to[0]), ["person@example.test", "new-address@example.test"]);
  assert.deepEqual(ok.calls.map((call) => call.init.headers["Idempotency-Key"]), ["msg_test_1/0", "msg_test_1/1"]);

  const half = mockFetch((_url, _init, count) => new Response("{}", { status: count === 1 ? 200 : 500 }));
  const failed = await handleAuthEmailRequest(await signedRequest(payload), { env: goodEnv(), fetchImpl: half.fetchImpl, nowSeconds: NOW });
  assert.equal(failed.status, 502);
});

test("handler: Resend 4xx and 5xx and network failures return the {error:{http_code,message}} shape without leaking", async () => {
  for (const status of [400, 401, 403, 422, 429, 500, 503]) {
    const { fetchImpl } = mockFetch(() => new Response(JSON.stringify({ message: `provider says ${DUMMY_API_KEY} person@example.test` }), { status }));
    const response = await handleAuthEmailRequest(await signedRequest(hookPayload()), { env: goodEnv(), fetchImpl, nowSeconds: NOW });
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(response.status, 502, String(status));
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.equal(body.error.http_code, 502);
    assert.equal(typeof body.error.message, "string");
    assert.ok(!text.includes(DUMMY_API_KEY) && !text.includes("person@example.test") && !text.includes("provider says"));
  }
  const network = await handleAuthEmailRequest(await signedRequest(hookPayload()), {
    env: goodEnv(),
    fetchImpl: async () => {
      throw new TypeError(`connect failed using ${DUMMY_API_KEY}`);
    },
    nowSeconds: NOW,
  });
  const networkText = await network.text();
  assert.equal(network.status, 502);
  assert.ok(!networkText.includes(DUMMY_API_KEY));
});

test("handler: missing or malformed env returns a generic 500 that never leaks secrets", async () => {
  for (const name of ["SEND_EMAIL_HOOK_SECRET", "RESEND_API_KEY", "AUTH_EMAIL_FROM", "SUPABASE_URL"]) {
    const env = goodEnv();
    delete env[name];
    const { calls, fetchImpl } = mockFetch();
    const response = await handleAuthEmailRequest(await signedRequest(hookPayload()), { env, fetchImpl, nowSeconds: NOW });
    const text = await response.text();
    assert.equal(response.status, 500, name);
    assert.deepEqual(JSON.parse(text), { error: { http_code: 500, message: "Email hook is not configured" } });
    for (const secret of [DUMMY_API_KEY, DUMMY_SECRET, DUMMY_SECRET.replace(/^v1,whsec_/, "")]) assert.ok(!text.includes(secret));
    assert.equal(calls.length, 0, "nothing is sent when misconfigured");
  }
  for (const from of ["Fawxzzy <no-reply@fawxzzy.com>\r\nBcc: attacker@example.test", "no at sign"]) {
    const response = await handleAuthEmailRequest(await signedRequest(hookPayload()), {
      env: { ...goodEnv(), AUTH_EMAIL_FROM: from },
      fetchImpl: mockFetch().fetchImpl,
      nowSeconds: NOW,
    });
    assert.equal(response.status, 500, from);
  }
  const malformedSecret = await handleAuthEmailRequest(await signedRequest(hookPayload()), {
    env: { ...goodEnv(), SEND_EMAIL_HOOK_SECRET: "v1,whsec_!!!not-base64!!!" },
    fetchImpl: mockFetch().fetchImpl,
    nowSeconds: NOW,
  });
  assert.equal(malformedSecret.status, 500);
});

test("handler: bad signature, stale timestamp, tampered body, wrong method and bad payload never send mail", async () => {
  const { calls, fetchImpl } = mockFetch();
  const run = (request) => handleAuthEmailRequest(request, { env: goodEnv(), fetchImpl, nowSeconds: NOW });
  const payload = hookPayload();

  const wrongSecret = await run(await signedRequest(payload, { secret: OTHER_SECRET }));
  assert.equal(wrongSecret.status, 401);
  assert.deepEqual(await wrongSecret.json(), { error: { http_code: 401, message: "Invalid webhook signature" } });

  assert.equal((await run(await signedRequest(payload, { timestamp: NOW - 3600 }))).status, 401);

  const signed = await signedRequest(payload);
  const tampered = new Request(signed.url, { method: "POST", headers: signed.headers, body: JSON.stringify(hookPayload({ user: { email: "attacker@example.test" } })) });
  assert.equal((await run(tampered)).status, 401);

  assert.equal((await run(new Request("https://hook.test/", { method: "POST", body: JSON.stringify(payload) }))).status, 401);
  assert.equal((await run(await signedRequest(payload, { method: "GET" }))).status, 405);

  const notJson = await run(await signedRequest("not json"));
  assert.equal(notJson.status, 400);
  assert.deepEqual(await notJson.json(), { error: { http_code: 400, message: "Invalid hook payload" } });
  assert.equal((await run(await signedRequest({ user: {}, email_data: {} }))).status, 400);

  const big = await run(await signedRequest(JSON.stringify({ pad: "x".repeat(70 * 1024) })));
  assert.equal(big.status, 413);
  assert.equal(calls.length, 0);
});

test("index.ts wires Deno env and global fetch into the handler", async () => {
  const source = await readFile(new URL("../supabase/functions/auth-send-email/index.ts", import.meta.url), "utf8");
  let served;
  const seen = {};
  const sentinelFetch = () => {};
  vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import [^\r\n]*;\r?\n/gm, "")), {
    Deno: {
      serve: (handler) => {
        served = handler;
      },
      env: { get: (name) => `value-of-${name}` },
    },
    fetch: sentinelFetch,
    handleAuthEmailRequest: (request, deps) => {
      Object.assign(seen, { request, deps });
      return "handled";
    },
  });
  assert.equal(typeof served, "function");
  assert.equal(served("req"), "handled");
  assert.equal(seen.request, "req");
  assert.equal(seen.deps.fetchImpl, sentinelFetch);
  assert.deepEqual({ ...seen.deps.env }, {
    SEND_EMAIL_HOOK_SECRET: "value-of-SEND_EMAIL_HOOK_SECRET",
    RESEND_API_KEY: "value-of-RESEND_API_KEY",
    AUTH_EMAIL_FROM: "value-of-AUTH_EMAIL_FROM",
    SUPABASE_URL: "value-of-SUPABASE_URL",
  });
});

// ------------------------------------------------------------------- config

test("supabase config disables JWT verification for auth-send-email (signature authenticated)", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const block = config.match(/^\[functions\.auth-send-email\]\s*$([^[]*)/m);
  assert.ok(block, "config.toml must declare [functions.auth-send-email]");
  assert.match(block[1], /^\s*verify_jwt\s*=\s*false\s*$/m);
});

test("hook budget: one send stays inside Supabase's ~5 s hook limit", () => {
  assert.ok(SEND_TIMEOUT_MS <= 4_000, `send timeout ${SEND_TIMEOUT_MS} ms leaves no room in a ~5 s hook budget`);
});

test("hook budget: the two secure email-change messages are sent concurrently, not one after the other", async () => {
  const payload = hookPayload({
    user: { new_email: "new-address@example.test" },
    email_data: { email_action_type: "email_change", redirect_to: accountConfirmUrl("mazer", "s"), token_hash: "N", token_hash_new: "C" },
  });
  let started = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async () => {
    started += 1;
    await gate; // neither send can finish until both have started
    return new Response("{}", { status: 200 });
  };
  const pending = handleAuthEmailRequest(await signedRequest(payload), { env: goodEnv(), fetchImpl, nowSeconds: NOW });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(started, 2, "second send must start before the first one finishes");
  release();
  assert.equal((await pending).status, 200);
});

test("handler: an oversized declared content-length is rejected before the body is read", async () => {
  const { calls, fetchImpl } = mockFetch();
  let textCalls = 0;
  const request = {
    method: "POST",
    headers: new Headers({ "content-length": String(1024 * 1024), "webhook-id": "x", "webhook-timestamp": String(NOW), "webhook-signature": "v1,x" }),
    text: async () => { textCalls += 1; return "{}"; },
  };
  const response = await handleAuthEmailRequest(request, { env: goodEnv(), fetchImpl, nowSeconds: NOW });
  assert.equal(response.status, 413);
  assert.equal(textCalls, 0, "body must not be read when the declared length is already too big");
  assert.equal(calls.length, 0);
});

test("handler: a rejected non-JSON payload is never echoed into the logs", async () => {
  const { fetchImpl } = mockFetch();
  const seen = [];
  const original = console.error;
  console.error = (...args) => { seen.push(args.join(" ")); };
  try {
    // The parse error lands on the first sensitive-looking token, so V8's message would quote it.
    const secretBody = '{"x": TOKENHASHLEAK leak-me@example.test}';
    const response = await handleAuthEmailRequest(await signedRequest(secretBody), { env: goodEnv(), fetchImpl, nowSeconds: NOW });
    assert.equal(response.status, 400);
  } finally {
    console.error = original;
  }
  const logged = seen.join("\n");
  assert.ok(logged.includes("payload rejected"), "a rejection line is still logged");
  assert.ok(!/leak-me|TOKENHASH/.test(logged), "log must not quote any part of the request body");
});
