import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  ALLOWED_ORIGINS,
  RESET_WAIT_CODE,
  SEND_WINDOW_SECONDS,
  CLIENT_ADDRESS_SOURCE,
  createUsernameResetHandler,
  DECOY_RECIPIENT,
  DECOY_USER_ID,
  MAX_BODY_BYTES,
  MINIMUM_RESPONSE_MS,
  providerPublicKey,
  readBodyLimited,
  RECOVERY_REDIRECTS,
  recipientFrom,
  recoverRequest,
  resetAttemptKeys,
  resetClientAddress,
  resolveUsernameResetRpc,
  sendOutcome,
} from "../supabase/functions/username-password-reset/handler.mjs";
import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * Signed-out password reset by USERNAME (design direction #9). Runs the Edge Function's real request
 * handler (supabase/functions/username-password-reset/handler.mjs) and the portal's real modules:
 * one fixed answer for known, unknown, banned, unconfirmed, deleted and email-less usernames (same
 * status, body and headers, same duration), no email or id in any answer, the rate limit, input
 * rejection, the provider recovery call, and the browser PKCE verifier contract against the installed
 * supabase-js. The SQL side (counters, privileges) is proven by
 * supabase/proposed/account_username_reset_v2.scratch-test.mjs.
 */
const account = loadPortalModule("src/config/account.ts");
const matrix = loadPortalModule("src/lib/auth/copy-matrix.ts");
const outcomes = loadPortalModule("src/lib/auth/auth-outcomes.ts");
const pkce = loadPortalModule("src/lib/auth/recovery-pkce.ts");

const ORIGIN = "https://account.fawxzzy.com";
const PUBLIC_KEY = "sb_publishable_fixture";
const NOW = Date.parse("2026-11-15T12:00:00Z");
const sha256 = async (text) => createHash("sha256").update(text).digest("hex");
const challenge = "A".repeat(43);
const redirect = `${ORIGIN}/reset-password?recovery=1`;

// Every kind of username the answer must not tell apart.
const USERS = {
  known: { id: "11111111-1111-4111-8111-111111111111", email: "known@example.test" },
  unconfirmed: { id: "22222222-2222-4222-8222-222222222222", email: "unconfirmed@example.test", email_confirmed_at: null },
  banned: { id: "33333333-3333-4333-8333-333333333333", email: "banned@example.test", banned_until: "2099-01-01T00:00:00Z" },
  deleted: { id: "44444444-4444-4444-8444-444444444444", email: "deleted@example.test", deleted_at: "2026-11-01T00:00:00Z" },
  noemail: { id: "55555555-5555-4555-8555-555555555555", email: "" },
};
const usernames = [...Object.keys(USERS), "nobody", "ghost.user"];

function harness({ minimumResponseMs = 150, resolve, sendStatus = 200, sendRecovery } = {}) {
  const sent = [];
  const scheduled = [];
  const resolveCalls = [];
  const logs = [];
  const handle = createUsernameResetHandler({
    admitKey: async (key) => key === PUBLIC_KEY,
    background: (task) => scheduled.push(task),
    log: (entry) => logs.push(entry),
    // The account lookup is deliberately slow and differs by account: it must never reach the answer.
    async findRecipient(userId) {
      await new Promise((done) => setTimeout(done, 120));
      const user = Object.values(USERS).find((entry) => entry.id === userId) ?? null;
      return recipientFrom(user, NOW);
    },
    minimumResponseMs,
    resolve: resolve ?? (async (input) => {
      resolveCalls.push(input);
      await new Promise((done) => setTimeout(done, 5));
      return { throttled: false, userId: USERS[input.normalized]?.id ?? null };
    }),
    sendRecovery: sendRecovery ?? (async (input) => {
      sent.push(input);
      return sendStatus;
    }),
    sha256,
  });
  return { handle, logs, resolveCalls, scheduled, sent };
}

function resetRequest(body, { headers = {}, method = "POST" } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://project.example.test/functions/v1/username-password-reset", {
    body: method === "POST" ? text : undefined,
    headers: {
      apikey: PUBLIC_KEY,
      "cf-connecting-ip": "203.0.113.9",
      "content-type": "application/json",
      origin: ORIGIN,
      ...headers,
    },
    method,
  });
}

const validBody = (identifier, extra = {}) => ({
  code_challenge: challenge,
  code_challenge_method: "s256",
  identifier,
  redirect_to: redirect,
  ...extra,
});

async function snapshot(response) {
  return {
    body: await response.text(),
    headers: [...response.headers.entries()].sort(),
    status: response.status,
  };
}

test("every username gets the same answer: status, body and headers are identical", async () => {
  const { handle, scheduled, sent } = harness();
  const answers = [];
  for (const name of usernames) answers.push(await snapshot(await handle(resetRequest(validBody(name)))));
  for (const answer of answers) assert.deepEqual(answer, answers[0]);
  assert.equal(answers[0].status, 200);
  assert.equal(answers[0].body, JSON.stringify({ status: "accepted" }));
  // Case and surrounding spaces do not change the answer either.
  assert.deepEqual(await snapshot(await handle(resetRequest(validBody("  KNOWN ")))), answers[0]);
  await Promise.all(scheduled);
  // Exactly one provider call per request. Mail goes out only for an account that can receive it
  // (known twice, unconfirmed); every other username's call goes to the undeliverable decoy.
  assert.equal(scheduled.length, usernames.length + 1);
  assert.equal(sent.length, usernames.length + 1);
  assert.deepEqual(
    sent.map((entry) => entry.email).sort(),
    [
      "known@example.test",
      "known@example.test",
      "unconfirmed@example.test",
      ...Array(5).fill(DECOY_RECIPIENT),
    ].sort(),
  );
  for (const entry of sent) {
    assert.deepEqual(Object.keys(entry).sort(), ["captchaToken", "codeChallenge", "email", "redirectTo"]);
    assert.equal(entry.codeChallenge, challenge);
    assert.equal(entry.redirectTo, redirect);
  }
});

test("every username takes the same time: the account lookup never delays the answer", async () => {
  const floor = 150;
  const { handle, scheduled } = harness({ minimumResponseMs: floor });
  const durations = {};
  for (let round = 0; round < 3; round += 1) {
    for (const name of usernames) {
      const started = performance.now();
      const response = await handle(resetRequest(validBody(name)));
      await response.text();
      (durations[name] ??= []).push(performance.now() - started);
    }
  }
  const medians = Object.fromEntries(Object.entries(durations).map(([name, values]) => [
    name,
    [...values].sort((a, b) => a - b)[1],
  ]));
  const values = Object.values(medians);
  for (const value of values) assert.ok(value >= floor - 2, `answer under the floor: ${JSON.stringify(medians)}`);
  // The slow account lookup (120 ms) runs only for existing accounts; it must not show in the timing.
  assert.ok(Math.max(...values) - Math.min(...values) < 60, `timing spread: ${JSON.stringify(medians)}`);
  await Promise.all(scheduled);
});

test("no answer carries an email, a masked email or a user id", async () => {
  const { handle, scheduled } = harness({ minimumResponseMs: 0 });
  const texts = [];
  for (const name of usernames) texts.push(await (await handle(resetRequest(validBody(name)))).text());
  const throttled = harness({ minimumResponseMs: 0, resolve: async () => ({ throttled: true, userId: null }) });
  texts.push(await (await throttled.handle(resetRequest(validBody("known")))).text());
  const down = harness({ minimumResponseMs: 0, resolve: async () => null });
  texts.push(await (await down.handle(resetRequest(validBody("known")))).text());
  for (const text of texts) {
    assert.doesNotMatch(text, /@|•|example\.test|[0-9a-f]{8}-[0-9a-f]{4}/i, text);
  }
  await Promise.all(scheduled);
});

test("the rate limit answers 429 the same way for known and unknown usernames", async () => {
  const { handle, scheduled, sent } = harness({
    minimumResponseMs: 0,
    resolve: async () => ({ throttled: true, userId: null }),
  });
  const known = await snapshot(await handle(resetRequest(validBody("known"))));
  const unknown = await snapshot(await handle(resetRequest(validBody("nobody"))));
  assert.deepEqual(known, unknown);
  assert.equal(known.status, 429);
  assert.equal(known.body, JSON.stringify({ code: "reset_throttled" }));
  assert.ok(known.headers.some(([name, value]) => name === "retry-after" && value === "900"));
  assert.equal(scheduled.length, 0);
  assert.equal(sent.length, 0);
});

test("a held send window answers 429 reset_wait the same way for known and unknown usernames, and sends nothing", async () => {
  const { handle, scheduled, sent } = harness({
    minimumResponseMs: 0,
    // What the database answers for a repeat inside the minute, keyed by account or by name (the SQL
    // makes both wait identically; see the scratch test): no account comes back, whatever the name.
    resolve: async () => ({ throttled: false, userId: null, waitSeconds: 37 }),
  });
  const known = await snapshot(await handle(resetRequest(validBody("known"))));
  const unknown = await snapshot(await handle(resetRequest(validBody("nobody"))));
  assert.deepEqual(known, unknown);
  assert.equal(known.status, 429);
  assert.equal(known.body, JSON.stringify({ code: "reset_wait" }));
  assert.equal(RESET_WAIT_CODE, "reset_wait");
  assert.ok(known.headers.some(([name, value]) => name === "retry-after" && value === "37"));
  assert.doesNotMatch(known.body, /@|[0-9a-f]{8}-[0-9a-f]{4}|example\.test/i);
  assert.equal(scheduled.length, 0, "no background lookup or provider call for a held window");
  assert.equal(sent.length, 0);
  // Its own code: the portal tells "wait a minute" from "too many requests".
  assert.notEqual(known.body, JSON.stringify({ code: "reset_throttled" }));
});

test("the rate limit wins over a wait, a wait of 0 sends, and Retry-After stays within 1..60", async () => {
  const both = harness({ minimumResponseMs: 0, resolve: async () => ({ throttled: true, userId: null, waitSeconds: 30 }) });
  const rate = await both.handle(resetRequest(validBody("known")));
  assert.equal(rate.status, 429);
  assert.equal((await rate.json()).code, "reset_throttled");

  const send = harness({ minimumResponseMs: 0, resolve: async () => ({ throttled: false, userId: USERS.known.id, waitSeconds: 0 }) });
  const sendAnswer = await send.handle(resetRequest(validBody("known")));
  assert.equal(sendAnswer.status, 200);
  await Promise.all(send.scheduled);
  assert.equal(send.sent.length, 1);

  for (const [waitSeconds, expected] of [[1, "1"], [SEND_WINDOW_SECONDS, "60"], [999, "60"]]) {
    const { handle } = harness({ minimumResponseMs: 0, resolve: async () => ({ throttled: false, userId: null, waitSeconds }) });
    const answer = await handle(resetRequest(validBody("known")));
    assert.equal(answer.status, 429);
    assert.equal(answer.headers.get("retry-after"), expected, String(waitSeconds));
  }
});

test("a wait takes as long as every other answer", async () => {
  const waiting = harness({ minimumResponseMs: 150, resolve: async () => ({ throttled: false, userId: null, waitSeconds: 12 }) });
  const sending = harness({ minimumResponseMs: 150 });
  const time = async (h) => {
    const start = Date.now();
    await h.handle(resetRequest(validBody("known")));
    return Date.now() - start;
  };
  const waited = await time(waiting);
  const sentIn = await time(sending);
  assert.ok(waited >= 140 && sentIn >= 140, `${waited} / ${sentIn}`);
  assert.ok(Math.abs(waited - sentIn) < 100, `${waited} vs ${sentIn}`);
  await Promise.all(sending.scheduled);
});

test("a missing or failing resolver answers 503 for every username and sends nothing", async () => {
  for (const resolve of [async () => null, async () => { throw new Error("db down"); }]) {
    const { handle, scheduled } = harness({ minimumResponseMs: 0, resolve });
    const known = await snapshot(await handle(resetRequest(validBody("known"))));
    const unknown = await snapshot(await handle(resetRequest(validBody("nobody"))));
    assert.deepEqual(known, unknown);
    assert.equal(known.status, 503);
    assert.equal(known.body, JSON.stringify({ code: "reset_unavailable" }));
    assert.equal(scheduled.length, 0);
  }
});

test("a background failure never changes the answer", async () => {
  const handle = createUsernameResetHandler({
    admitKey: async () => true,
    background: () => { throw new Error("scheduler gone"); },
    findRecipient: async () => { throw new Error("admin down"); },
    minimumResponseMs: 0,
    resolve: async () => ({ throttled: false, userId: USERS.known.id }),
    sendRecovery: async () => { throw new Error("provider down"); },
    sha256,
  });
  const response = await handle(resetRequest(validBody("known")));
  assert.equal(response.status, 200);
});

test("malformed requests are refused before any lookup, with one generic answer", async () => {
  const cases = [
    ["wrong origin", resetRequest(validBody("known"), { headers: { origin: "https://evil.example" } })],
    ["no origin", resetRequest(validBody("known"), { headers: { origin: "" } })],
    ["GET", resetRequest(validBody("known"), { method: "GET" })],
    ["no key", resetRequest(validBody("known"), { headers: { apikey: "" } })],
    ["unknown key", resetRequest(validBody("known"), { headers: { apikey: "sb_publishable_other" } })],
    ["form body", resetRequest(validBody("known"), { headers: { "content-type": "text/plain" } })],
    ["oversize", resetRequest(JSON.stringify(validBody("known", { pad: "x".repeat(5000) })))],
    ["not JSON", resetRequest("{")],
    ["array", resetRequest([])],
    ["email typed", resetRequest(validBody("known@example.test"))],
    ["too short", resetRequest(validBody("a"))],
    ["too long", resetRequest(validBody("a".repeat(16)))],
    ["space inside", resetRequest(validBody("a b"))],
    ["no challenge", resetRequest(validBody("known", { code_challenge: "" }))],
    ["short challenge", resetRequest(validBody("known", { code_challenge: "A".repeat(42) }))],
    ["plain method", resetRequest(validBody("known", { code_challenge_method: "plain" }))],
    ["foreign redirect", resetRequest(validBody("known", { redirect_to: "https://evil.example/reset" }))],
    ["redirect with code", resetRequest(validBody("known", { redirect_to: `${redirect}&code=x` }))],
    ["http redirect", resetRequest(validBody("known", { redirect_to: redirect.replace("https:", "http:") }))],
  ];
  const { handle, resolveCalls, scheduled } = harness({ minimumResponseMs: 0 });
  for (const [label, request] of cases) {
    const response = await handle(request);
    assert.equal(response.status, 400, label);
    assert.equal(await response.text(), JSON.stringify({ code: "reset_invalid" }), label);
  }
  assert.equal(resolveCalls.length, 0);
  assert.equal(scheduled.length, 0);
});

test("refusals are held to the same minimum duration as accepted requests", async () => {
  const { handle } = harness({ minimumResponseMs: 120 });
  const started = performance.now();
  await handle(resetRequest(validBody("a b")));
  assert.ok(performance.now() - started >= 118);
  assert.equal(MINIMUM_RESPONSE_MS, 900, "the deployed floor is pinned; change it with a reason");
});

test("CORS: only the account host gets a preflight, and every answer carries the CORS headers", async () => {
  const { handle } = harness({ minimumResponseMs: 0 });
  const preflight = await handle(resetRequest(null, { method: "OPTIONS" }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  const response = await handle(resetRequest(validBody("nobody")));
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual([...ALLOWED_ORIGINS], [ORIGIN]);
  const foreign = await handle(resetRequest(null, { headers: { origin: "https://evil.example" }, method: "OPTIONS" }));
  assert.equal(foreign.status, 400);
  assert.equal(foreign.headers.get("access-control-allow-origin"), null);
});

test("counter keys: namespaced away from sign-in, per username and client, IPv6 grouped by /64", async () => {
  const keys = await resetAttemptKeys("fawxzzy", "203.0.113.9", sha256);
  assert.equal(keys.clientKey, await sha256("username-reset-client-v1:203.0.113.9"));
  assert.equal(keys.pairKey, await sha256("username-reset-pair-v1:fawxzzy:203.0.113.9"));
  // Never a sign-in key for the same caller, never a shared counter row.
  const signIn = [
    await sha256("client:203.0.113.9"),
    await sha256("username:fawxzzy"),
    await sha256("username-aggregate-v4:fawxzzy"),
    await sha256("username-client-v4:fawxzzy:203.0.113.9"),
    "0".repeat(64),
    await sha256("username-reset-global-v1"),
  ];
  for (const key of [keys.clientKey, keys.pairKey]) assert.ok(!signIn.includes(key));
  assert.equal(await sha256("username-reset-global-v1"), "608c73fae58fb41e5747af73c685cc415a7940212c5b616c6d47942f97e2fc5e");
  assert.notEqual((await resetAttemptKeys("other", "203.0.113.9", sha256)).pairKey, keys.pairKey);
  const headers = (entries) => new Headers(entries);
  assert.equal(
    resetClientAddress(headers({ "cf-connecting-ip": "2001:db8:1:2:aaaa::1" })),
    resetClientAddress(headers({ "cf-connecting-ip": "2001:db8:1:2:bbbb::9" })),
  );
  // Only the platform-set source counts: cf-connecting-ip, else the RIGHTMOST x-forwarded-for hop.
  assert.deepEqual(CLIENT_ADDRESS_SOURCE, { fallback: "x-forwarded-for", fallbackHop: "rightmost", primary: "cf-connecting-ip" });
  assert.equal(resetClientAddress(headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" })), "10.0.0.1");
  assert.equal(resetClientAddress(headers({ "x-forwarded-for": " 203.0.113.7 " })), "203.0.113.7");
  assert.equal(resetClientAddress(headers({ "x-forwarded-for": " , " })), "unknown");
  assert.equal(resetClientAddress(headers({})), "unknown");
});

test("client address: forged leftmost x-forwarded-for entries never change the bucket or the counter keys", async () => {
  const headers = (entries) => new Headers(entries);
  // Behind a proxy that appends the real peer (x-forwarded-for fallback).
  const honest = resetClientAddress(headers({ "x-forwarded-for": "198.51.100.20" }));
  for (const forged of ["1.2.3.4, 198.51.100.20", "9.9.9.9, 8.8.8.8, 198.51.100.20", "unknown, 198.51.100.20", "2001:db8::1, 198.51.100.20"]) {
    assert.equal(resetClientAddress(headers({ "x-forwarded-for": forged })), honest, forged);
  }
  // Behind Cloudflare: cf-connecting-ip wins over anything in x-forwarded-for.
  const cf = resetClientAddress(headers({ "cf-connecting-ip": "203.0.113.30" }));
  assert.equal(resetClientAddress(headers({ "cf-connecting-ip": "203.0.113.30", "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), cf);
  // End to end: rotating forged leftmost entries from one client still fills ONE per-client counter.
  const clientKeys = new Set();
  const { handle } = harness({
    minimumResponseMs: 0,
    resolve: async (input) => {
      clientKeys.add(input.clientKey);
      return { throttled: false, userId: null };
    },
  });
  for (let i = 0; i < 5; i += 1) {
    const request = new Request("https://project.example.test/functions/v1/username-password-reset", {
      body: JSON.stringify(validBody(`ghost${i}`)),
      headers: { apikey: PUBLIC_KEY, "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.9.${i}.1, 198.51.100.20` },
      method: "POST",
    });
    assert.equal((await handle(request)).status, 200);
  }
  assert.equal(clientKeys.size, 1);
  assert.deepEqual([...clientKeys], [(await resetAttemptKeys("ghost0", "198.51.100.20", sha256)).clientKey]);
});

test("captcha: the token is spent at the provider for a miss exactly like a hit (one call, same shape)", async () => {
  const { handle, scheduled, sent } = harness({ minimumResponseMs: 0 });
  for (const name of ["known", "nobody", "banned", "noemail"]) {
    await handle(resetRequest(validBody(name, { captchaToken: `token-${name}` })));
  }
  await Promise.all(scheduled);
  // (A miss skips the slow account lookup, so its call may finish first; order is not the contract.)
  sent.sort((left, right) => ["token-known", "token-nobody", "token-banned", "token-noemail"].indexOf(left.captchaToken)
    - ["token-known", "token-nobody", "token-banned", "token-noemail"].indexOf(right.captchaToken));
  assert.deepEqual(sent.map((entry) => [entry.captchaToken, entry.email]), [
    ["token-known", "known@example.test"],
    ["token-nobody", DECOY_RECIPIENT],
    ["token-banned", DECOY_RECIPIENT],
    ["token-noemail", DECOY_RECIPIENT],
  ]);
  // The provider request for a hit and a miss differ ONLY in the address.
  const build = (entry) => recoverRequest({ ...entry, anonKey: "sb_publishable_fixture", url: "https://project.example.test" });
  const [hitUrl, hitInit] = build(sent[0]);
  const [missUrl, missInit] = build({ ...sent[1], captchaToken: sent[0].captchaToken });
  assert.equal(missUrl, hitUrl);
  assert.deepEqual(missInit.headers, hitInit.headers);
  assert.deepEqual({ ...JSON.parse(missInit.body), email: null }, { ...JSON.parse(hitInit.body), email: null });
  assert.equal(JSON.parse(hitInit.body).gotrue_meta_security.captcha_token, "token-known");
  assert.match(DECOY_RECIPIENT, /^[a-z0-9.-]+@[a-z0-9-]+\.invalid$/);
  // A miss makes the same account lookup as a hit (for an id no account has), so the provider call
  // comes after the same work on both paths.
  const lookups = [];
  const timed = createUsernameResetHandler({
    admitKey: async () => true,
    background: (task) => scheduled.push(task),
    findRecipient: async (userId) => { lookups.push(userId); return userId === USERS.known.id ? USERS.known.email : null; },
    minimumResponseMs: 0,
    resolve: async (input) => ({ throttled: false, userId: USERS[input.normalized]?.id ?? null }),
    sendRecovery: async () => 200,
    sha256,
  });
  await timed(resetRequest(validBody("known")));
  await timed(resetRequest(validBody("nobody")));
  await Promise.all(scheduled);
  assert.deepEqual(lookups, [USERS.known.id, DECOY_USER_ID]);
  assert.equal(recipientFrom(null, NOW), null);
  // A failing account lookup still spends the token (decoy).
  const scheduledBroken = [];
  const sentBroken = [];
  const handleBroken = createUsernameResetHandler({
    admitKey: async () => true,
    background: (task) => scheduledBroken.push(task),
    findRecipient: async () => { throw new Error("admin api down"); },
    minimumResponseMs: 0,
    resolve: async () => ({ throttled: false, userId: USERS.known.id }),
    sendRecovery: async (input) => { sentBroken.push(input); return 200; },
    sha256,
  });
  assert.equal((await handleBroken(resetRequest(validBody("known", { captchaToken: "token-x" })))).status, 200);
  await Promise.all(scheduledBroken);
  assert.deepEqual(sentBroken.map((entry) => [entry.captchaToken, entry.email]), [["token-x", DECOY_RECIPIENT]]);
});

test("send outcome log: one line per background send, status class only, nothing identifying", async () => {
  assert.equal(sendOutcome(200), "2xx");
  assert.equal(sendOutcome(204), "2xx");
  assert.equal(sendOutcome(422), "4xx");
  assert.equal(sendOutcome(429), "4xx");
  assert.equal(sendOutcome(503), "5xx");
  for (const value of [null, undefined, 0, 99, 600, 200.5, "200"]) assert.equal(sendOutcome(value), "not_sent", String(value));
  for (const [status, outcome] of [[200, "2xx"], [429, "4xx"], [500, "5xx"], [null, "not_sent"]]) {
    const { handle, logs, scheduled } = harness({ minimumResponseMs: 0, sendStatus: status });
    const headers = { "cf-connecting-ip": "203.0.113.77" };
    await handle(resetRequest(validBody("known", { captchaToken: "secret-token" }), { headers }));
    await handle(resetRequest(validBody("nobody", { captchaToken: "secret-token" }), { headers }));
    await Promise.all(scheduled);
    assert.deepEqual(logs, [{ event: "username_reset_send", outcome }, { event: "username_reset_send", outcome }]);
    const text = JSON.stringify(logs);
    for (const secret of ["known", "nobody", "example.test", "203.0.113", "secret-token", USERS.known.id, DECOY_RECIPIENT]) {
      assert.ok(!text.includes(secret), secret);
    }
  }
  const failing = harness({ minimumResponseMs: 0, sendRecovery: async () => { throw new Error("known@example.test 203.0.113.77"); } });
  const response = await failing.handle(resetRequest(validBody("known")));
  await Promise.all(failing.scheduled);
  assert.equal(response.status, 200);
  assert.deepEqual(failing.logs, [{ event: "username_reset_send", outcome: "network_error" }]);
  // A throwing logger never changes the answer.
  const loud = createUsernameResetHandler({
    admitKey: async () => true,
    background: () => undefined,
    findRecipient: async () => "known@example.test",
    log: () => { throw new Error("log sink down"); },
    minimumResponseMs: 0,
    resolve: async () => ({ throttled: false, userId: USERS.known.id }),
    sendRecovery: async () => 200,
    sha256,
  });
  assert.equal((await loud(resetRequest(validBody("known")))).status, 200);
});

test("body: read as a stream with a 4 KB cap; oversize and invalid UTF-8 are refused", async () => {
  assert.equal(MAX_BODY_BYTES, 4096);
  const target = "https://project.example.test/x";
  const streamed = (chunks) => new Request(target, {
    body: new ReadableStream({
      pull(controller) {
        const next = chunks.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(next);
      },
    }),
    duplex: "half",
    method: "POST",
  });
  assert.equal(await readBodyLimited(new Request(target, { body: "x".repeat(4096), method: "POST" })), "x".repeat(4096));
  assert.equal(await readBodyLimited(new Request(target, { body: "x".repeat(4097), method: "POST" })), null);
  // An endless stream is cut off just past the limit instead of being buffered whole.
  let pulled = 0;
  const endless = new Request(target, {
    body: new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024).fill(120));
      },
    }),
    duplex: "half",
    method: "POST",
  });
  assert.equal(await readBodyLimited(endless), null);
  assert.ok(pulled <= 8, `pulled ${pulled} chunks`);
  assert.equal(await readBodyLimited(streamed([new Uint8Array([0xff, 0xfe])])), null);
  const encoder = new TextEncoder();
  assert.equal(await readBodyLimited(streamed([encoder.encode('{"a":'), encoder.encode('"é"}')])), '{"a":"é"}');
  assert.equal(await readBodyLimited(new Request(target, { method: "POST" })), null);
  // Through the handler: an endless streamed body is the generic invalid answer and resolves nothing.
  const { handle, resolveCalls } = harness({ minimumResponseMs: 0 });
  const big = new Request("https://project.example.test/functions/v1/username-password-reset", {
    body: new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(2048).fill(32));
      },
    }),
    duplex: "half",
    headers: { apikey: PUBLIC_KEY, "cf-connecting-ip": "203.0.113.9", "content-type": "application/json", origin: ORIGIN },
    method: "POST",
  });
  assert.equal((await handle(big)).status, 400);
  assert.equal(resolveCalls.length, 0);
});

test("provider key: the new publishable key first, the legacy anon key as the fallback", () => {
  const envOf = (values) => (name) => values[name];
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl";
  assert.equal(providerPublicKey(envOf({ SUPABASE_ANON_KEY: jwt, SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_new","other":"sb_publishable_x"}' })), "sb_publishable_new");
  assert.equal(providerPublicKey(envOf({ SUPABASE_ANON_KEY: jwt, SUPABASE_PUBLISHABLE_KEYS: '{"web":"sb_publishable_web"}' })), "sb_publishable_web");
  assert.equal(providerPublicKey(envOf({ SUPABASE_ANON_KEY: jwt, SUPABASE_PUBLISHABLE_KEYS: '["sb_publishable_list"]' })), "sb_publishable_list");
  assert.equal(providerPublicKey(envOf({ SUPABASE_ANON_KEY: jwt, SUPABASE_PUBLISHABLE_KEYS: "not json" })), jwt);
  assert.equal(providerPublicKey(envOf({ SUPABASE_ANON_KEY: jwt, SUPABASE_PUBLISHABLE_KEYS: "{}" })), jwt);
  assert.equal(providerPublicKey(envOf({ SUPABASE_ANON_KEY: jwt })), jwt);
  assert.equal(providerPublicKey(envOf({})), null);
  // A publishable key is not a JWT: it goes only in apikey. A legacy JWT also goes in Authorization.
  const base = { captchaToken: undefined, codeChallenge: challenge, email: "known@example.test", redirectTo: redirect, url: "https://project.example.test" };
  const [, publishable] = recoverRequest({ ...base, anonKey: "sb_publishable_new" });
  assert.equal(publishable.headers.apikey, "sb_publishable_new");
  assert.equal(publishable.headers.Authorization, undefined);
  const [, legacy] = recoverRequest({ ...base, anonKey: jwt });
  assert.equal(legacy.headers.apikey, jwt);
  assert.equal(legacy.headers.Authorization, `Bearer ${jwt}`);
});

test("the resolver call: service role, account_api profile, strict answer parsing, fails closed", async () => {
  const calls = [];
  const reply = (body, status = 200) => async (input, init) => {
    calls.push({ init, input });
    return new Response(JSON.stringify(body), { status });
  };
  const args = { p_client_key: "a".repeat(64), p_normalized_username: "fawxzzy", p_pair_key: "b".repeat(64) };
  const base = { args, serviceRole: "service-role-fixture", url: "https://project.example.test" };
  const id = USERS.known.id;
  assert.deepEqual(
    await resolveUsernameResetRpc({ ...base, fetchImpl: reply([{ resolved_user_id: id, throttled: false, wait_seconds: 0 }]) }),
    { throttled: false, userId: id, waitSeconds: 0 },
  );
  assert.equal(calls[0].input, "https://project.example.test/rest/v1/rpc/account_resolve_username_reset_v2");
  assert.equal(calls[0].init.headers["Accept-Profile"], "account_api");
  assert.equal(calls[0].init.headers["Content-Profile"], "account_api");
  assert.equal(calls[0].init.headers.apikey, "service-role-fixture");
  assert.deepEqual(JSON.parse(calls[0].init.body), args);
  assert.deepEqual(
    await resolveUsernameResetRpc({ ...base, fetchImpl: reply([{ resolved_user_id: null, throttled: false, wait_seconds: 0 }]) }),
    { throttled: false, userId: null, waitSeconds: 0 },
  );
  assert.deepEqual(
    await resolveUsernameResetRpc({ ...base, fetchImpl: reply([{ resolved_user_id: id, throttled: true, wait_seconds: 0 }]) }),
    { throttled: true, userId: null, waitSeconds: 0 },
  );
  // A held send window: wait_seconds 1..60, never an account, never counted as the rate limit.
  assert.deepEqual(
    await resolveUsernameResetRpc({ ...base, fetchImpl: reply([{ resolved_user_id: id, throttled: false, wait_seconds: 41 }]) }),
    { throttled: false, userId: null, waitSeconds: 41 },
  );
  for (const [body, status] of [
    [{ code: "PGRST202" }, 404],
    [[], 200],
    [[{ resolved_user_id: "not-a-uuid", throttled: false, wait_seconds: 0 }], 200],
    [[{ resolved_user_id: id, wait_seconds: 0 }], 200],
    [[{ resolved_user_id: id, throttled: false }], 200],
    [[{ resolved_user_id: id, throttled: false, wait_seconds: -1 }], 200],
    [[{ resolved_user_id: id, throttled: false, wait_seconds: 61 }], 200],
    [[{ resolved_user_id: id, throttled: false, wait_seconds: "5" }], 200],
    [[{ resolved_user_id: id, throttled: false, wait_seconds: 1.5 }], 200],
    [[{ resolved_user_id: id, throttled: false, wait_seconds: 0 }, { resolved_user_id: id, throttled: false, wait_seconds: 0 }], 200],
    [{ resolved_user_id: id, throttled: false, wait_seconds: 0 }, 200],
  ]) {
    assert.equal(await resolveUsernameResetRpc({ ...base, fetchImpl: reply(body, status) }), null, JSON.stringify(body));
  }
  assert.equal(
    await resolveUsernameResetRpc({ ...base, fetchImpl: async () => { throw new Error("network"); } }),
    null,
  );
});

test("the provider recovery call carries the browser's PKCE challenge and the allowed redirect", () => {
  const [target, init] = recoverRequest({
    anonKey: "anon-fixture",
    captchaToken: "turnstile-token",
    codeChallenge: challenge,
    email: "known@example.test",
    redirectTo: `${ORIGIN}/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize`,
    url: "https://project.example.test",
  });
  const parsed = new URL(target);
  assert.equal(parsed.origin + parsed.pathname, "https://project.example.test/auth/v1/recover");
  assert.equal(parsed.searchParams.get("redirect_to"), `${ORIGIN}/reset-password?recovery=1&app=mazer&returnTo=%2Foauth%2Fauthorize`);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.apikey, "anon-fixture");
  assert.deepEqual(JSON.parse(init.body), {
    code_challenge: challenge,
    code_challenge_method: "s256",
    email: "known@example.test",
    gotrue_meta_security: { captcha_token: "turnstile-token" },
  });
});

test("the function forwards exactly the redirects the portal builds, nothing else", () => {
  const built = new Set();
  for (const context of Object.keys(account.accountExperienceContexts)) {
    for (const target of [undefined, "/oauth/authorize", "https://evil.example/"]) {
      built.add(account.accountRecoveryUrl(context, target));
    }
  }
  assert.deepEqual([...RECOVERY_REDIRECTS].sort(), [...built].sort());
});

test("who gets the email: deleted, banned and email-less accounts get nothing; unconfirmed does", () => {
  assert.equal(recipientFrom(USERS.known, NOW), "known@example.test");
  assert.equal(recipientFrom(USERS.unconfirmed, NOW), "unconfirmed@example.test");
  assert.equal(recipientFrom(USERS.banned, NOW), null);
  assert.equal(recipientFrom({ ...USERS.banned, banned_until: "2020-01-01T00:00:00Z" }, NOW), "banned@example.test");
  assert.equal(recipientFrom(USERS.deleted, NOW), null);
  assert.equal(recipientFrom(USERS.noemail, NOW), null);
  assert.equal(recipientFrom(null, NOW), null);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
    values,
  };
}

test("PKCE: the browser-made recovery verifier is stored exactly like the SDK's own", async () => {
  const storageKey = "fawxzzy.account.auth.v1";
  // The SDK's own recovery request, captured without sending anything.
  const sdkStorage = memoryStorage();
  let sdkBody = null;
  const sdk = createClient("https://project.example.test", PUBLIC_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce", persistSession: true, storage: sdkStorage, storageKey },
    global: {
      fetch: async (input, init) => {
        if (String(input).includes("/auth/v1/recover")) sdkBody = JSON.parse(init.body);
        return new Response("{}", { headers: { "content-type": "application/json" }, status: 200 });
      },
    },
  });
  await sdk.auth.resetPasswordForEmail("known@example.test", { redirectTo: redirect });
  const sdkStored = JSON.parse(sdkStorage.values.get(`${storageKey}-code-verifier`));

  const ours = memoryStorage();
  const started = await pkce.startRecoveryPkce(ours, storageKey);
  const stored = JSON.parse(ours.values.get(pkce.recoveryVerifierKey(storageKey)));
  assert.equal(pkce.recoveryVerifierKey(storageKey), `${storageKey}-code-verifier`);
  // Same shape: 112 hex characters + "/recovery"; same method; challenge derived the same way.
  assert.match(sdkStored, /^[0-9a-f]{112}\/recovery$/);
  assert.match(stored, /^[0-9a-f]{112}\/recovery$/);
  assert.equal(sdkBody.code_challenge_method, "s256");
  assert.equal(started.codeChallengeMethod, sdkBody.code_challenge_method);
  const base64url = (text) => createHash("sha256").update(text).digest("base64url");
  assert.equal(sdkBody.code_challenge, base64url(sdkStored.split("/")[0]));
  assert.equal(started.codeChallenge, base64url(stored.split("/")[0]));
  assert.match(started.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(started.codeChallenge, (await pkce.startRecoveryPkce(memoryStorage(), storageKey)).codeChallenge);
  await pkce.clearRecoveryPkce(ours, storageKey);
  assert.equal(ours.values.size, 0);
});

test("PKCE: the recovery landing's exchangeCodeForSession sends the verifier this browser stored", async () => {
  const storageKey = "fawxzzy.account.auth.v1";
  const storage = memoryStorage();
  const started = await pkce.startRecoveryPkce(storage, storageKey);
  let exchange = null;
  const client = createClient("https://project.example.test", PUBLIC_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce", persistSession: true, storage, storageKey },
    global: {
      fetch: async (input, init) => {
        if (String(input).includes("/auth/v1/token")) exchange = { body: JSON.parse(init.body), url: String(input) };
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "fixture" }), {
          headers: { "content-type": "application/json" },
          status: 400,
        });
      },
    },
  });
  await client.auth.exchangeCodeForSession("one-time-code");
  assert.ok(exchange, "the SDK made the exchange call");
  assert.match(exchange.url, /grant_type=pkce/);
  assert.equal(exchange.body.auth_code, "one-time-code");
  assert.equal(createHash("sha256").update(exchange.body.code_verifier).digest("base64url"), started.codeChallenge);
});

test("portal copy and outcomes: one fixed success line, failures name only the request", () => {
  const line = matrix.authNotice("reset.sentuser");
  assert.equal(line.text, "If that username has an account, we sent a reset link to its email.");
  assert.equal(line.tone, "success");
  assert.doesNotMatch(line.text, /\{e\}|@/);
  assert.equal(outcomes.usernameResetFailure({ code: "reset_throttled", status: 429 }), "reset.rate");
  assert.equal(outcomes.usernameResetFailure({ status: 429 }), "reset.rate");
  // The account's send window: "No new email sent. Wait a minute", not the 15-minute rate limit.
  assert.equal(outcomes.usernameResetFailure({ code: "reset_wait", status: 429 }), "reset.wait");
  assert.equal(matrix.authNotice("reset.wait").text, "No new email sent. Wait a minute, then try again.");
  assert.doesNotMatch(matrix.authNotice("reset.wait").text, /exist|found|unknown|registered|no account/i);
  for (const error of [{ code: "reset_unavailable", status: 503 }, { code: "reset_invalid", status: 400 }, { status: 500 }, {}]) {
    assert.equal(outcomes.usernameResetFailure(error), "reset.sendfail", JSON.stringify(error));
  }
  for (const id of ["reset.rate", "reset.sendfail"]) {
    assert.doesNotMatch(matrix.authNotice(id).text, /exist|found|unknown|registered|no account/i, id);
  }
  for (const bad of ["", "a", "a b", "known@example.test", "a".repeat(16)]) {
    assert.deepEqual(outcomes.resetUsernameProblem(bad), { id: "signup.userinvalid", fields: ["username"] }, bad);
  }
  assert.equal(outcomes.resetUsernameProblem(" Fawxzzy "), null);
});

test("wiring: the live adapter posts a username and a challenge, never an email, and the flag is dark", () => {
  const adapter = readFileSync("src/lib/auth/browser-adapter.ts", "utf8");
  const method = adapter.slice(
    adapter.indexOf("async requestPasswordResetByUsername(username, contextId, returnTarget, captchaToken)"),
    adapter.indexOf("async reauthenticate(password, captchaToken)"),
  );
  assert.ok(method.includes("/functions/v1/username-password-reset"));
  assert.ok(method.includes("startRecoveryPkce("));
  assert.ok(method.includes("identifier: username"));
  assert.ok(method.includes("redirect_to: accountRecoveryUrl(contextId, returnTarget)"));
  assert.doesNotMatch(method, /resetPasswordForEmail|email:/);
  // Live since 2026-11-15 (go-live step 7): the signed-out portal asks for a username, not an email.
  assert.equal(account.RESET_BY_USERNAME_LIVE, true);
  const config = readFileSync("supabase/config.toml", "utf8");
  assert.match(config, /\[functions\.username-password-reset\]\s*\nverify_jwt = false/);
  const index = readFileSync("supabase/functions/username-password-reset/index.ts", "utf8");
  assert.ok(index.includes('from "./handler.mjs"'));
  assert.ok(index.includes("EdgeRuntime"));
  assert.doesNotMatch(index, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)[^;]*Response/);
  // The only log line is the handler's non-identifying send outcome.
  assert.deepEqual(index.match(/console\.[a-z]+\(/g), ["console.log("]);
  assert.ok(index.includes("console.log(JSON.stringify(entry));"));
  assert.ok(index.includes("providerPublicKey("));
});

test("SQL v2 file shape: additive, service_role only, keyed by hash, rollback leaves v1 alone", () => {
  const dir = "supabase/proposed/";
  const apply = readFileSync(`${dir}20261126190000_account_username_reset_v2.sql`, "utf8");
  const rollback = readFileSync(`${dir}20261126190000_account_username_reset_v2.rollback.sql`, "utf8");
  const preimage = readFileSync(`${dir}20261126190000_account_username_reset_v2.preimage.sql`, "utf8");
  assert.match(apply, /^-- PROPOSED, OWNER-GATED\. NOT APPLIED\./);
  assert.match(apply, /\nbegin;\n[\s\S]*\ncommit;\n$/);
  assert.equal(apply.match(/create function /g)?.length, 2, "only the two v2 functions are created");
  assert.match(apply, /create function account_private\.resolve_username_reset_v2\(/);
  assert.match(apply, /create function account_api\.account_resolve_username_reset_v2\(/);
  assert.doesNotMatch(apply, /create or replace|drop function|alter |truncate/i, "additive: nothing existing is replaced or dropped");
  assert.equal(apply.match(/security definer/g)?.length, 2);
  assert.equal(apply.match(/set search_path = ''/g)?.length, 2);
  for (const target of [
    "account_private.resolve_username_reset_v2(text, text, text)",
    "account_api.account_resolve_username_reset_v2(text, text, text)",
  ]) {
    assert.ok(apply.includes(`revoke all on function ${target}\n  from public, anon, authenticated;`), target);
    assert.ok(apply.includes(`grant execute on function ${target}\n  to service_role;`), target);
  }
  assert.doesNotMatch(apply, /grant [^;]*\b(anon|authenticated|public)\b/i);
  // The send window is 60 s and its key is a hash computed in the database: no raw username, email or
  // account id is stored (the counter table rejects anything but 64 hex characters).
  assert.match(apply, /send_window constant interval := interval '60 seconds'/);
  assert.match(apply, /pg_catalog\.sha256\(/);
  assert.match(apply, /'account:' \|\| account_id::text/);
  assert.doesNotMatch(apply, /auth\.users/, "the resolver never reads accounts directly");
  // v1 stays; the rollback removes only v2 and says the previous function goes back first.
  assert.match(rollback, /drop function if exists account_api\.account_resolve_username_reset_v2\(text, text, text\);/);
  assert.match(rollback, /drop function if exists account_private\.resolve_username_reset_v2\(text, text, text\);/);
  assert.doesNotMatch(rollback, /drop function[^\n]*reset_v1/);
  assert.match(rollback, /redeploy the previous Edge Function/);
  assert.match(preimage, /v2 already present/);
  // The function calls the v2 resolver and nothing older.
  const handler = readFileSync("supabase/functions/username-password-reset/handler.mjs", "utf8");
  assert.ok(handler.includes("rpc/account_resolve_username_reset_v2"));
  assert.ok(!handler.includes("rpc/account_resolve_username_reset_v1"));
});
