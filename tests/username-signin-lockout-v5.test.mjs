import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  noteUsernameSignInFailureV2Rpc,
  resolveUsernameSignIn,
  resolveUsernameSignInV5Rpc,
} from "../supabase/functions/username-password-signin/rpc-response.mjs";
import {
  clientAddressFromHeaders,
  deriveThrottleKeys,
} from "../supabase/functions/username-password-signin/throttle-keys.mjs";
import { loadSigninHandler } from "./helpers/load-signin-handler.mjs";

const url = "https://project.example.test";
const serviceRole = "service-role-fixture";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const userId = "adc7ca28-7271-5599-826f-fd7e4477b542";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const absent = () => json({ code: "PGRST202", message: "Could not find the function" }, 404);
const names = (calls) => calls.map((call) => call.input.split("/").pop());

function recordingFetch(responder) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ init, input });
    return responder(input, init);
  };
  return { calls, fetchImpl };
}

test("throttle keys: v5 namespaces are fixed, distinct from v3 and v4, and per-purpose independent", async () => {
  const keys = await deriveThrottleKeys({ client: "203.0.113.9", normalized: "fawxzzy" });
  assert.deepEqual(keys.v5, {
    p_attempt_key: sha("username-aggregate-v5:fawxzzy"),
    p_client_attempt_key: sha("client-failure-v5:203.0.113.9"),
    p_normalized_username: "fawxzzy",
    p_pair_attempt_key: sha("username-client-v5:fawxzzy|203.0.113.9"),
  });
  assert.deepEqual(keys.v4, {
    p_attempt_key: sha("username-aggregate-v4:fawxzzy"),
    p_client_attempt_key: sha("client:203.0.113.9"),
    p_normalized_username: "fawxzzy",
    p_pair_attempt_key: sha("username-client-v4:fawxzzy:203.0.113.9"),
  });
  assert.deepEqual(keys.v3, {
    p_attempt_key: sha("username:fawxzzy"),
    p_client_attempt_key: sha("client:203.0.113.9"),
    p_normalized_username: "fawxzzy",
  });
  const all = [
    ...Object.values(keys.v5).slice(0, 2), keys.v5.p_pair_attempt_key,
    keys.v4.p_attempt_key, keys.v4.p_pair_attempt_key, keys.v3.p_attempt_key, keys.v3.p_client_attempt_key,
  ];
  assert.equal(new Set(all).size, all.length, "no key is shared between counters or generations");
  for (const key of all) assert.match(key, /^[0-9a-f]{64}$/);

  const other = await deriveThrottleKeys({ client: "198.51.100.7", normalized: "fawxzzy" });
  assert.equal(other.v5.p_attempt_key, keys.v5.p_attempt_key, "the aggregate key does not depend on the client");
  assert.notEqual(other.v5.p_pair_attempt_key, keys.v5.p_pair_attempt_key, "the pair key depends on the client");
  assert.notEqual(other.v5.p_client_attempt_key, keys.v5.p_client_attempt_key);
  const otherUser = await deriveThrottleKeys({ client: "203.0.113.9", normalized: "someone" });
  assert.equal(otherUser.v5.p_client_attempt_key, keys.v5.p_client_attempt_key, "the client key does not depend on the username");
  assert.notEqual(otherUser.v5.p_pair_attempt_key, keys.v5.p_pair_attempt_key);
  assert.notEqual(otherUser.v5.p_attempt_key, keys.v5.p_attempt_key);

  // The "|" delimiter cannot appear in a username, so (user, client) pairs never collide across the boundary.
  const left = await deriveThrottleKeys({ client: "b-c", normalized: "a" });
  const right = await deriveThrottleKeys({ client: "c", normalized: "a-b" });
  assert.notEqual(left.v5.p_pair_attempt_key, right.v5.p_pair_attempt_key);
});

test("client address: only cf-connecting-ip is trusted; x-forwarded-for is ignored; absence shares one 'unknown' bucket", () => {
  const headers = (entries) => new Headers(entries);
  assert.equal(clientAddressFromHeaders(headers({ "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(
    clientAddressFromHeaders(headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 10.0.0.1" })),
    "203.0.113.9",
    "a forged x-forwarded-for cannot change the bucket",
  );
  for (const forged of ["198.51.100.1", "203.0.113.9", "2001:db8::1", "unknown", "garbage"]) {
    assert.equal(
      clientAddressFromHeaders(headers({ "x-forwarded-for": forged })),
      "unknown",
      `x-forwarded-for alone (${forged}) falls to the unknown bucket`,
    );
  }
  assert.equal(clientAddressFromHeaders(headers({})), "unknown");
  assert.equal(clientAddressFromHeaders(headers({ "cf-connecting-ip": "" })), "unknown");
  assert.equal(clientAddressFromHeaders(headers({ "cf-connecting-ip": "not an address" })), "unknown");
  assert.equal(
    clientAddressFromHeaders(headers({ "cf-connecting-ip": "2001:db8::1" })),
    clientAddressFromHeaders(headers({ "cf-connecting-ip": "2001:db8::ffff:1" })),
    "IPv6 clients are grouped by /64",
  );
});

test("v5 resolver is a check: same row shape as v4, reports a throttle separately, fails closed", async () => {
  const args = (await deriveThrottleKeys({ client: "203.0.113.9", normalized: "fawxzzy" })).v5;
  const { calls, fetchImpl } = recordingFetch(() => json([{ resolved_user_id: userId, throttled: false }]));
  assert.deepEqual(
    await resolveUsernameSignInV5Rpc({ args, fetchImpl, serviceRole, url }),
    { throttled: false, userId, version: 5 },
  );
  assert.equal(calls[0].input, `${url}/rest/v1/rpc/account_resolve_username_signin_v5`);
  assert.equal(calls[0].init.headers["Accept-Profile"], "account_api");
  assert.equal(calls[0].init.headers["Content-Profile"], "account_api");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.body, JSON.stringify(args));
  assert.deepEqual(
    await resolveUsernameSignInV5Rpc({
      args,
      fetchImpl: async () => json([{ resolved_user_id: null, throttled: true }]),
      serviceRole,
      url,
    }),
    { throttled: true, userId: null, version: 5 },
  );
  const closed = { throttled: false, userId: null, version: 5 };
  for (const responder of [
    async () => json([]),
    async () => json([{ resolved_user_id: userId }]),
    async () => json([{ resolved_user_id: null, throttled: false }]),
    async () => json([{ resolved_user_id: "not-a-uuid", throttled: false }]),
    async () => json({ message: "boom" }, 500),
    async () => { throw new Error("network detail must not escape"); },
  ]) {
    assert.deepEqual(await resolveUsernameSignInV5Rpc({ args, fetchImpl: responder, serviceRole, url }), closed);
  }
  assert.deepEqual(
    await resolveUsernameSignInV5Rpc({ args, fetchImpl: async () => absent(), serviceRole, url }),
    { throttled: false, userId: null, version: null },
  );
});

test("resolveUsernameSignIn tries v5, then v4, v3, v2 one step at a time and never skips an installed throttle", async () => {
  const keys = await deriveThrottleKeys({ client: "203.0.113.9", normalized: "fawxzzy" });
  const options = { args: keys.v3, serviceRole, url, v4Args: keys.v4, v5Args: keys.v5 };
  const row = [{ resolved_user_id: userId, throttled: false }];

  const all = recordingFetch(() => json(row));
  assert.deepEqual(await resolveUsernameSignIn({ ...options, fetchImpl: all.fetchImpl }), { throttled: false, userId, version: 5 });
  assert.deepEqual(names(all.calls), ["account_resolve_username_signin_v5"]);
  assert.equal(all.calls[0].init.body, JSON.stringify(keys.v5), "v5 receives the v5 arguments");

  const v4Only = recordingFetch((input) => (input.endsWith("_v5") ? absent() : json(row)));
  assert.deepEqual(await resolveUsernameSignIn({ ...options, fetchImpl: v4Only.fetchImpl }), { throttled: false, userId, version: 4 });
  assert.deepEqual(names(v4Only.calls), ["account_resolve_username_signin_v5", "account_resolve_username_signin_v4"]);
  assert.equal(v4Only.calls[1].init.body, JSON.stringify(keys.v4), "v4 receives the v4 arguments");

  const v3Only = recordingFetch((input) => (/_v[45]$/.test(input) ? absent() : json(row)));
  assert.deepEqual(await resolveUsernameSignIn({ ...options, fetchImpl: v3Only.fetchImpl }), { throttled: false, userId, version: 3 });
  assert.deepEqual(names(v3Only.calls), [
    "account_resolve_username_signin_v5",
    "account_resolve_username_signin_v4",
    "account_resolve_username_signin_v3",
  ]);
  assert.equal(v3Only.calls[2].init.body, JSON.stringify(keys.v3));

  const v2Only = recordingFetch((input) => (input.endsWith("_v2") ? json([{ resolved_user_id: userId }]) : absent()));
  assert.deepEqual(await resolveUsernameSignIn({ ...options, fetchImpl: v2Only.fetchImpl }), { throttled: false, userId, version: 2 });
  assert.equal(v2Only.calls.length, 4);

  // An installed v5 that answers 500 is NOT "absent": it fails closed and is never retried on v4/v3/v2 (that would skip the throttle).
  const failing = recordingFetch(() => json({ message: "boom" }, 500));
  assert.deepEqual(await resolveUsernameSignIn({ ...options, fetchImpl: failing.fetchImpl }), { throttled: false, userId: null, version: 5 });
  assert.equal(failing.calls.length, 1);

  // A v5 throttle is final.
  const locked = recordingFetch(() => json([{ resolved_user_id: null, throttled: true }]));
  assert.deepEqual(await resolveUsernameSignIn({ ...options, fetchImpl: locked.fetchImpl }), { throttled: true, userId: null, version: 5 });
  assert.equal(locked.calls.length, 1);

  // Without v5Args the v4-first behavior is unchanged; without both the v3-first behavior is unchanged.
  const legacy = recordingFetch(() => json(row));
  await resolveUsernameSignIn({ args: keys.v3, fetchImpl: legacy.fetchImpl, serviceRole, url, v4Args: keys.v4 });
  assert.deepEqual(names(legacy.calls), ["account_resolve_username_signin_v4"]);
  const oldest = recordingFetch(() => json(row));
  await resolveUsernameSignIn({ args: keys.v3, fetchImpl: oldest.fetchImpl, serviceRole, url });
  assert.deepEqual(names(oldest.calls), ["account_resolve_username_signin_v3"]);
});

test("note-failure v2 posts all three keys to account_api and never throws", async () => {
  const { calls, fetchImpl } = recordingFetch(() => new Response(null, { status: 204 }));
  const options = {
    attemptKey: "a".repeat(64),
    clientAttemptKey: "b".repeat(64),
    fetchImpl,
    pairAttemptKey: "c".repeat(64),
    serviceRole,
    url,
  };
  assert.equal(await noteUsernameSignInFailureV2Rpc(options), true);
  assert.equal(calls[0].input, `${url}/rest/v1/rpc/account_note_username_signin_failure_v2`);
  assert.equal(
    calls[0].init.body,
    JSON.stringify({ p_attempt_key: "a".repeat(64), p_client_attempt_key: "b".repeat(64), p_pair_attempt_key: "c".repeat(64) }),
  );
  assert.equal(calls[0].init.headers["Content-Profile"], "account_api");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(await noteUsernameSignInFailureV2Rpc({ ...options, fetchImpl: async () => absent() }), false);
  assert.equal(await noteUsernameSignInFailureV2Rpc({ ...options, fetchImpl: async () => { throw new Error("offline"); } }), false);
});

// ---- the real index.ts request flow, executed with a fake backend --------------------------------------------------

const publishableKey = "sb_publishable_testkey";
const env = {
  SUPABASE_ANON_KEY: "anon-fixture",
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify([publishableKey]),
  SUPABASE_SERVICE_ROLE_KEY: serviceRole,
  SUPABASE_URL: url,
};

function makeBackend({ installed = [5, 4, 3, 2], knownUsers = { fawxzzy: userId }, password = "correct-password", resolver } = {}) {
  const events = [];
  const rpc = (name, body) => {
    events.push({ body, kind: "rpc", name });
    const version = Number(/_v(\d)$/.exec(name)?.[1]);
    if (/resolve_username_signin_v\d$/.test(name)) {
      if (!installed.includes(version)) return absent();
      if (resolver) return resolver(version, body);
      return json(version === 2 ? [{ resolved_user_id: knownUsers[body.p_normalized_username] ?? null }]
        : [{ resolved_user_id: knownUsers[body.p_normalized_username] ?? null, throttled: false }]);
    }
    return new Response(null, { status: 204 });
  };
  const fetchImpl = async (input, init) => {
    const target = String(input);
    if (target.includes("/rest/v1/rpc/")) return rpc(target.split("/").pop(), JSON.parse(init.body));
    return json({}); // /auth/v1/settings for an unknown public key (not used: the key is configured)
  };
  const createClient = (_url, key) => ({
    auth: {
      admin: {
        getUserById: async (id) => {
          events.push({ id, kind: "getUserById" });
          const email = Object.entries(knownUsers).find(([, value]) => value === id)?.[0];
          return { data: { user: email ? { email: `${email}@example.test` } : null } };
        },
      },
      signInWithPassword: async ({ email, password: attempt }) => {
        events.push({ email, kind: "signInWithPassword", key });
        const ok = email.endsWith("@example.test") && attempt === password;
        return ok
          ? { data: { session: { access_token: "at", refresh_token: "rt" } }, error: null }
          : { data: {}, error: new Error("Invalid login credentials") };
      },
    },
  });
  return { createClient, events, fetchImpl };
}

async function post(handler, { address, forwarded, identifier = "fawxzzy", password = "correct-password" } = {}) {
  const headers = {
    apikey: publishableKey,
    "content-type": "application/json",
    origin: "https://account.fawxzzy.com",
  };
  if (address !== undefined) headers["cf-connecting-ip"] = address;
  if (forwarded !== undefined) headers["x-forwarded-for"] = forwarded;
  const response = await handler(new Request(`${url}/functions/v1/username-password-signin`, {
    body: JSON.stringify({ identifier, password }),
    headers,
    method: "POST",
  }));
  return { body: await response.json(), headers: Object.fromEntries(response.headers), status: response.status };
}

const rpcNames = (events) => events.filter((event) => event.kind === "rpc").map((event) => event.name.replace("account_", ""));

test("edge flow v5: a wrong password is checked, then recorded as ONE failure with the three v5 keys", async () => {
  const backend = makeBackend();
  const handler = await loadSigninHandler({ ...backend, env, fetchImpl: backend.fetchImpl });
  const result = await post(handler, { address: "203.0.113.9", password: "wrong" });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: "Invalid credentials" });
  assert.deepEqual(rpcNames(backend.events), ["resolve_username_signin_v5", "note_username_signin_failure_v2"]);
  const keys = (await deriveThrottleKeys({ client: "203.0.113.9", normalized: "fawxzzy" })).v5;
  const [check, failure] = backend.events.filter((event) => event.kind === "rpc");
  assert.deepEqual(check.body, keys);
  assert.deepEqual(failure.body, {
    p_attempt_key: keys.p_attempt_key,
    p_client_attempt_key: keys.p_client_attempt_key,
    p_pair_attempt_key: keys.p_pair_attempt_key,
  });
  assert.ok(
    backend.events.findIndex((event) => event.kind === "signInWithPassword")
      < backend.events.findIndex((event) => event.name === "account_note_username_signin_failure_v2"),
    "the failure is recorded only after the password check",
  );
});

test("edge flow v5: a correct password resets only the pair counter and records no failure", async () => {
  const backend = makeBackend();
  const handler = await loadSigninHandler({ ...backend, env, fetchImpl: backend.fetchImpl });
  const result = await post(handler, { address: "203.0.113.9" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { access_token: "at", refresh_token: "rt" });
  assert.deepEqual(rpcNames(backend.events), ["resolve_username_signin_v5", "note_username_signin_success_v1"]);
  const keys = (await deriveThrottleKeys({ client: "203.0.113.9", normalized: "fawxzzy" })).v5;
  assert.deepEqual(backend.events.find((event) => event.name === "account_note_username_signin_success_v1").body, {
    p_attempt_key: keys.p_pair_attempt_key,
  });
});

test("edge flow v5: a throttled caller is answered 429 before any user lookup or password check and nothing is counted", async () => {
  const backend = makeBackend({ resolver: () => json([{ resolved_user_id: null, throttled: true }]) });
  const handler = await loadSigninHandler({ ...backend, env, fetchImpl: backend.fetchImpl });
  const result = await post(handler, { address: "203.0.113.9", password: "correct-password" });
  assert.equal(result.status, 429);
  assert.deepEqual(result.body, { code: "username_throttled", error: "Too many attempts" });
  assert.equal(result.headers["retry-after"], "900");
  assert.deepEqual(rpcNames(backend.events), ["resolve_username_signin_v5"]);
  assert.equal(backend.events.some((event) => event.kind === "getUserById" || event.kind === "signInWithPassword"), false);
});

test("edge flow v5: known and unknown usernames take the same path and get the same 401", async () => {
  const known = makeBackend();
  const unknown = makeBackend();
  const knownResult = await post(await loadSigninHandler({ ...known, env, fetchImpl: known.fetchImpl }), { address: "203.0.113.9", password: "wrong" });
  const unknownResult = await post(await loadSigninHandler({ ...unknown, env, fetchImpl: unknown.fetchImpl }), { address: "203.0.113.9", identifier: "nosuchusr", password: "wrong" });
  assert.deepEqual(unknownResult, knownResult, "status, body and headers are identical");
  assert.deepEqual(rpcNames(unknown.events), rpcNames(known.events), "the same RPC sequence runs for an unknown username");
  assert.deepEqual(
    unknown.events.map((event) => event.kind),
    known.events.map((event) => event.kind),
    "the same call kinds (user lookup, password check) run for an unknown username",
  );
});

test("edge flow: x-forwarded-for is ignored for every throttle key; no cf-connecting-ip means the strict unknown bucket", async () => {
  const resolveBody = async ({ address, forwarded }) => {
    const backend = makeBackend();
    const handler = await loadSigninHandler({ ...backend, env, fetchImpl: backend.fetchImpl });
    await post(handler, { address, forwarded, password: "wrong" });
    return backend.events.filter((event) => event.kind === "rpc").map((event) => event.body);
  };
  const base = await resolveBody({ address: "203.0.113.9" });
  assert.deepEqual(await resolveBody({ address: "203.0.113.9", forwarded: "198.51.100.1" }), base);
  assert.deepEqual(await resolveBody({ address: "203.0.113.9", forwarded: "9.9.9.9, 203.0.113.9" }), base);

  const unknownKeys = (await deriveThrottleKeys({ client: "unknown", normalized: "fawxzzy" })).v5;
  const spoofedOnly = await resolveBody({ forwarded: "203.0.113.9" });
  assert.equal(spoofedOnly[0].p_client_attempt_key, unknownKeys.p_client_attempt_key, "a spoofed header alone lands in the unknown bucket");
  assert.equal(spoofedOnly[0].p_client_attempt_key, sha("client-failure-v5:unknown"));
  assert.notEqual(spoofedOnly[0].p_client_attempt_key, base[0].p_client_attempt_key, "and never in the address it claims");
  assert.deepEqual(await resolveBody({}), spoofedOnly, "a different spoofed value cannot mint a different bucket");
  assert.deepEqual(await resolveBody({ forwarded: "7.7.7.7" }), spoofedOnly);
});

test("edge flow fallbacks: v4 when v5 is absent (failure_v1, v4 pair reset), v3 when both are absent (no failure counting)", async () => {
  const v4 = makeBackend({ installed: [4, 3, 2] });
  const v4Handler = await loadSigninHandler({ ...v4, env, fetchImpl: v4.fetchImpl });
  await post(v4Handler, { address: "203.0.113.9", password: "wrong" });
  assert.deepEqual(rpcNames(v4.events), ["resolve_username_signin_v5", "resolve_username_signin_v4", "note_username_signin_failure_v1"]);
  const keys = await deriveThrottleKeys({ client: "203.0.113.9", normalized: "fawxzzy" });
  assert.deepEqual(v4.events.find((event) => event.name === "account_note_username_signin_failure_v1").body, {
    p_attempt_key: keys.v4.p_attempt_key,
    p_pair_attempt_key: keys.v4.p_pair_attempt_key,
  });
  const v4Ok = makeBackend({ installed: [4, 3, 2] });
  await post(await loadSigninHandler({ ...v4Ok, env, fetchImpl: v4Ok.fetchImpl }), { address: "203.0.113.9" });
  assert.deepEqual(v4Ok.events.find((event) => event.name === "account_note_username_signin_success_v1").body, { p_attempt_key: keys.v4.p_pair_attempt_key });

  const v3 = makeBackend({ installed: [3, 2] });
  await post(await loadSigninHandler({ ...v3, env, fetchImpl: v3.fetchImpl }), { address: "203.0.113.9", password: "wrong" });
  assert.deepEqual(rpcNames(v3.events), ["resolve_username_signin_v5", "resolve_username_signin_v4", "resolve_username_signin_v3"]);
  const v3Ok = makeBackend({ installed: [3, 2] });
  await post(await loadSigninHandler({ ...v3Ok, env, fetchImpl: v3Ok.fetchImpl }), { address: "203.0.113.9" });
  assert.deepEqual(v3Ok.events.find((event) => event.name === "account_note_username_signin_success_v1").body, { p_attempt_key: keys.v3.p_attempt_key });
});

test("edge flow: a failing recorder never changes the 401, and an installed v5 that errors never falls back", async () => {
  const backend = makeBackend();
  const failingNote = async (input, init) => {
    if (String(input).endsWith("note_username_signin_failure_v2")) throw new Error("offline");
    return backend.fetchImpl(input, init);
  };
  const result = await post(await loadSigninHandler({ ...backend, env, fetchImpl: failingNote }), { address: "203.0.113.9", password: "wrong" });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: "Invalid credentials" });

  const broken = makeBackend({ resolver: () => json({ message: "boom" }, 500) });
  const closed = await post(await loadSigninHandler({ ...broken, env, fetchImpl: broken.fetchImpl }), { address: "203.0.113.9", password: "correct-password" });
  assert.equal(closed.status, 401, "a failing v5 check fails closed even with the correct password");
  assert.deepEqual(rpcNames(broken.events).filter((name) => name.startsWith("resolve")), ["resolve_username_signin_v5"]);
});

test("edge function source: only cf-connecting-ip, check before password, no counting outside the failed branch", () => {
  const source = readFileSync("supabase/functions/username-password-signin/index.ts", "utf8");
  const keysSource = readFileSync("supabase/functions/username-password-signin/throttle-keys.mjs", "utf8");
  for (const text of [source, keysSource]) {
    assert.doesNotMatch(text, /headers\.get\(\s*["']x-forwarded-for["']\s*\)/i, "x-forwarded-for is never read");
    assert.doesNotMatch(text, /x-real-ip|forwarded["']\s*\)/i);
  }
  assert.match(keysSource, /headers\.get\("cf-connecting-ip"\) \?\? "unknown"/);
  const throttle = source.indexOf("resolution.throttled");
  const password = source.indexOf("signInWithPassword");
  const guard = source.indexOf("if (!resolvedUserId || !resolvedEmail || error || !data.session)");
  const failureV2 = source.indexOf("noteUsernameSignInFailureV2Rpc({");
  const generic = source.indexOf("return genericFailure(origin);", guard);
  const success = source.indexOf("noteUsernameSignInSuccessRpc({");
  assert.ok(throttle > 0 && throttle < password, "the throttle is answered before any password check");
  assert.ok(guard > password && failureV2 > guard && failureV2 < generic, "failures are recorded inside the failed branch only");
  assert.ok(success > generic, "the success reset follows the failed branch");
  assert.equal(source.split("noteUsernameSignInFailureV2Rpc({").length - 1, 1, "exactly one v5 failure recorder call site");
  assert.ok(source.includes("resolution.version === 5"));
  assert.ok(source.includes("keys.v5.p_pair_attempt_key"));
});

test("v5 migration is additive, check-only resolver, failure-only writer, and matches the proposed apply file", () => {
  const sql = readFileSync("supabase/migrations/20261113000000_account_username_signin_throttle_v5.sql", "utf8");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /set local lock_timeout = '5s';/);
  assert.match(sql, /set local statement_timeout = '30s';/);
  assert.doesNotMatch(sql, /drop function|drop table|alter table|truncate/i);
  for (const object of [
    "public.account_resolve_username_signin_v3(text,text,text)",
    "account_api.account_resolve_username_signin_v3(text,text,text)",
    "public.account_note_username_signin_success_v1(text)",
    "account_api.account_note_username_signin_success_v1(text)",
  ]) assert.ok(sql.includes(`'${object}'`), object);
  for (const limit of [
    "coalesce(pair_failures, 0) >= 10",
    "coalesce(aggregate_failures, 0) >= 50",
    "coalesce(client_failures, 0) >= client_limit",
    "coalesce(global_failures, 0) >= 500",
    "case when p_client_attempt_key = unknown_client_key then 10 else 30 end",
  ]) assert.ok(sql.includes(limit), limit);
  // The resolver body is the part between its create and the next create: it must contain no write.
  const resolver = sql.slice(
    sql.indexOf("create or replace function public.account_resolve_username_signin_v5"),
    sql.indexOf("create or replace function public.account_note_username_signin_failure_v2"),
  );
  assert.doesNotMatch(resolver, /\b(insert|update|delete|truncate)\b\s+(into|from|account_private)/i);
  assert.equal(sql.split("security definer").length - 1, 4);
  assert.equal(sql.split("set search_path = pg_catalog").length - 1, 4);
  assert.equal(sql.split("from public, anon, authenticated").length - 1, 4);
  assert.equal(sql.split("to service_role").length - 1, 4);
  assert.ok(sql.includes("for update skip locked"));
  assert.ok(sql.includes("array[p_pair_attempt_key, p_attempt_key, p_client_attempt_key, global_key]"), "fixed lock order");
});
