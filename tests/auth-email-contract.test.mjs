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
  escapeHtml,
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
  // The kicker is uppercased and tracked by the same rule on the screen.
  assert.match(utility, /\.account-auth-intro > p \{[^}]*color: rgb\(var\(--auth-color\)\);[^}]*text-transform: uppercase;/s);
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
      assert.ok(message.text.includes("person@example.test") || message.text.includes("new-address@example.test"), `${type} recipient in text`);
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

test("emails carry no remote images, webfonts, trackers or scripts", () => {
  for (const [type, data] of ACTION_CASES) {
    const [message] = planMessages(
      hookPayload({ user: { new_email: "n@example.test" }, email_data: { email_action_type: type, ...data } }),
      { supabaseUrl: SUPABASE_URL },
    );
    for (const forbidden of [/<img/i, /<link/i, /<script/i, /<iframe/i, /@import/i, /@font-face/i, /url\(/i, /http:\/\//i, /<form/i]) {
      assert.doesNotMatch(message.html, forbidden, `${type} ${forbidden}`);
    }
    const hrefs = [...message.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    for (const href of hrefs) assert.match(href, /^https:\/\//);
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
  for (const raw of ["<script", "<img", "<b>", "<i>", "<u>", "<s>", "<code>"]) {
    assert.ok(!html.includes(raw), `unescaped ${raw}`);
  }
  assert.ok(html.includes("?a=&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;&amp;b=1"), "url attribute escaped");
  assert.ok(html.includes("a&quot;b&lt;i&gt;@example.test"));
  assert.ok(html.includes("&amp;b=1"));
});

test("escaping: a recipient with markup-significant characters is escaped in a planned message", () => {
  const [message] = planMessages(hookPayload({ user: { email: "o'brien&co@example.test" } }), { supabaseUrl: SUPABASE_URL });
  assert.ok(message.html.includes("o&#39;brien&amp;co@example.test"));
  assert.doesNotMatch(message.html, /o'brien&co/);
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
