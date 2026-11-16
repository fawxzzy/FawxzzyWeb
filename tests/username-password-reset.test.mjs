import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  ALLOWED_ORIGINS,
  createUsernameResetHandler,
  MINIMUM_RESPONSE_MS,
  RECOVERY_REDIRECTS,
  recipientFrom,
  recoverRequest,
  resetAttemptKeys,
  resetClientAddress,
  resolveUsernameResetRpc,
} from "../supabase/functions/username-password-reset/handler.mjs";
import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

/**
 * Signed-out password reset by USERNAME (design direction #9). Runs the Edge Function's real request
 * handler (supabase/functions/username-password-reset/handler.mjs) and the portal's real modules:
 * one fixed answer for known, unknown, banned, unconfirmed, deleted and email-less usernames (same
 * status, body and headers, same duration), no email or id in any answer, the rate limit, input
 * rejection, the provider recovery call, and the browser PKCE verifier contract against the installed
 * supabase-js. The SQL side (counters, privileges) is proven by
 * supabase/proposed/account_username_reset_v1.scratch-test.mjs.
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

function harness({ minimumResponseMs = 150, resolve } = {}) {
  const sent = [];
  const scheduled = [];
  const resolveCalls = [];
  const handle = createUsernameResetHandler({
    admitKey: async (key) => key === PUBLIC_KEY,
    background: (task) => scheduled.push(task),
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
    async sendRecovery(input) {
      sent.push(input);
    },
    sha256,
  });
  return { handle, resolveCalls, scheduled, sent };
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
  // Mail goes out only for an account that can receive it: known and unconfirmed (twice for KNOWN).
  assert.deepEqual(
    sent.map((entry) => entry.email).sort(),
    ["known@example.test", "known@example.test", "unconfirmed@example.test"],
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
  assert.equal(resetClientAddress(headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" })), "198.51.100.4");
  assert.equal(resetClientAddress(headers({})), "unknown");
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
    await resolveUsernameResetRpc({ ...base, fetchImpl: reply([{ resolved_user_id: id, throttled: false }]) }),
    { throttled: false, userId: id },
  );
  assert.equal(calls[0].input, "https://project.example.test/rest/v1/rpc/account_resolve_username_reset_v1");
  assert.equal(calls[0].init.headers["Accept-Profile"], "account_api");
  assert.equal(calls[0].init.headers["Content-Profile"], "account_api");
  assert.equal(calls[0].init.headers.apikey, "service-role-fixture");
  assert.deepEqual(JSON.parse(calls[0].init.body), args);
  assert.deepEqual(
    await resolveUsernameResetRpc({ ...base, fetchImpl: reply([{ resolved_user_id: null, throttled: false }]) }),
    { throttled: false, userId: null },
  );
  assert.deepEqual(
    await resolveUsernameResetRpc({ ...base, fetchImpl: reply([{ resolved_user_id: id, throttled: true }]) }),
    { throttled: true, userId: null },
  );
  for (const [body, status] of [
    [{ code: "PGRST202" }, 404],
    [[], 200],
    [[{ resolved_user_id: "not-a-uuid", throttled: false }], 200],
    [[{ resolved_user_id: id }], 200],
    [[{ resolved_user_id: id, throttled: false }, { resolved_user_id: id, throttled: false }], 200],
    [{ resolved_user_id: id, throttled: false }, 200],
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
  // Dark launch: the live portal keeps the email form until the owner applies the SQL and deploys the
  // function. The PR that flips this updates this line on purpose.
  assert.equal(account.RESET_BY_USERNAME_LIVE, false);
  const config = readFileSync("supabase/config.toml", "utf8");
  assert.match(config, /\[functions\.username-password-reset\]\s*\nverify_jwt = false/);
  const index = readFileSync("supabase/functions/username-password-reset/index.ts", "utf8");
  assert.ok(index.includes('from "./handler.mjs"'));
  assert.ok(index.includes("EdgeRuntime"));
  assert.doesNotMatch(index, /console\.|Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)[^;]*Response/);
});
