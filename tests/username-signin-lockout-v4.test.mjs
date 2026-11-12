import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { clientBucket } from "../supabase/functions/username-password-signin/client-bucket.mjs";
import {
  noteUsernameSignInFailureRpc,
  resolveUsernameSignIn,
  resolveUsernameSignInV4Rpc,
} from "../supabase/functions/username-password-signin/rpc-response.mjs";

const url = "https://project.example.test";
const serviceRole = "service-role-fixture";
const args = {
  p_attempt_key: "a".repeat(64),
  p_client_attempt_key: "b".repeat(64),
  p_normalized_username: "fawxzzy",
};
const argsV4 = { ...args, p_pair_attempt_key: "c".repeat(64) };
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

test("v4 resolver reports a throttle separately, sends the pair key and fails closed", async () => {
  const { calls, fetchImpl } = recordingFetch(() => json([{ resolved_user_id: userId, throttled: false }]));
  assert.deepEqual(
    await resolveUsernameSignInV4Rpc({ args: argsV4, fetchImpl, serviceRole, url }),
    { throttled: false, userId, version: 4 },
  );
  assert.equal(calls[0].input, `${url}/rest/v1/rpc/account_resolve_username_signin_v4`);
  assert.equal(calls[0].init.headers["Accept-Profile"], "account_api");
  assert.equal(calls[0].init.headers["Content-Profile"], "account_api");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.body, JSON.stringify(argsV4));

  assert.deepEqual(
    await resolveUsernameSignInV4Rpc({
      args: argsV4,
      fetchImpl: async () => json([{ resolved_user_id: null, throttled: true }]),
      serviceRole,
      url,
    }),
    { throttled: true, userId: null, version: 4 },
  );

  const closed = { throttled: false, userId: null, version: 4 };
  for (const responder of [
    async () => json([]),
    async () => json([{ resolved_user_id: userId }]),
    async () => json([{ resolved_user_id: null, throttled: false }]),
    async () => json([{ resolved_user_id: "not-a-uuid", throttled: false }]),
    async () => json({ message: "boom" }, 500),
    async () => { throw new Error("network detail must not escape"); },
  ]) {
    assert.deepEqual(
      await resolveUsernameSignInV4Rpc({ args: argsV4, fetchImpl: responder, serviceRole, url }),
      closed,
    );
  }

  assert.deepEqual(
    await resolveUsernameSignInV4Rpc({ args: argsV4, fetchImpl: async () => absent(), serviceRole, url }),
    { throttled: false, userId: null, version: null },
  );
});

test("resolveUsernameSignIn prefers v4, falls back one step at a time, and never skips a throttle", async () => {
  const present = recordingFetch(() => json([{ resolved_user_id: userId, throttled: false }]));
  assert.deepEqual(
    await resolveUsernameSignIn({ args, fetchImpl: present.fetchImpl, serviceRole, url, v4Args: argsV4 }),
    { throttled: false, userId, version: 4 },
  );
  assert.deepEqual(names(present.calls), ["account_resolve_username_signin_v4"]);
  assert.equal(present.calls[0].init.body, JSON.stringify(argsV4), "v4 receives the v4 arguments");

  const v3Only = recordingFetch((input) => (input.endsWith("_v4")
    ? absent()
    : json([{ resolved_user_id: userId, throttled: false }])));
  assert.deepEqual(
    await resolveUsernameSignIn({ args, fetchImpl: v3Only.fetchImpl, serviceRole, url, v4Args: argsV4 }),
    { throttled: false, userId, version: 3 },
  );
  assert.deepEqual(names(v3Only.calls), [
    "account_resolve_username_signin_v4",
    "account_resolve_username_signin_v3",
  ]);
  assert.equal(v3Only.calls[1].init.body, JSON.stringify(args), "v3 receives the v3 arguments, not the pair key");

  const v2Only = recordingFetch((input) => (input.endsWith("_v2")
    ? json([{ resolved_user_id: userId }])
    : absent()));
  assert.deepEqual(
    await resolveUsernameSignIn({ args, fetchImpl: v2Only.fetchImpl, serviceRole, url, v4Args: argsV4 }),
    { throttled: false, userId, version: 2 },
  );
  assert.deepEqual(names(v2Only.calls), [
    "account_resolve_username_signin_v4",
    "account_resolve_username_signin_v3",
    "account_resolve_username_signin_v2",
  ]);

  // A 500 from an installed v4 is NOT "absent": it must not be retried on v3 or v2 (that would skip the throttle).
  const failing = recordingFetch(() => json({ message: "boom" }, 500));
  assert.deepEqual(
    await resolveUsernameSignIn({ args, fetchImpl: failing.fetchImpl, serviceRole, url, v4Args: argsV4 }),
    { throttled: false, userId: null, version: 4 },
  );
  assert.equal(failing.calls.length, 1);

  // Without v4Args the v3-first behavior is unchanged.
  const legacy = recordingFetch(() => json([{ resolved_user_id: null, throttled: true }]));
  assert.deepEqual(
    await resolveUsernameSignIn({ args, fetchImpl: legacy.fetchImpl, serviceRole, url }),
    { throttled: true, userId: null, version: 3 },
  );
  assert.deepEqual(names(legacy.calls), ["account_resolve_username_signin_v3"]);
});

test("note-failure posts both keys to account_api and never throws", async () => {
  const { calls, fetchImpl } = recordingFetch(() => new Response(null, { status: 204 }));
  const options = { attemptKey: "a".repeat(64), fetchImpl, pairAttemptKey: "c".repeat(64), serviceRole, url };
  assert.equal(await noteUsernameSignInFailureRpc(options), true);
  assert.equal(calls[0].input, `${url}/rest/v1/rpc/account_note_username_signin_failure_v1`);
  assert.equal(
    calls[0].init.body,
    JSON.stringify({ p_attempt_key: "a".repeat(64), p_pair_attempt_key: "c".repeat(64) }),
  );
  assert.equal(calls[0].init.headers["Content-Profile"], "account_api");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(
    await noteUsernameSignInFailureRpc({ ...options, fetchImpl: async () => absent() }),
    false,
  );
  assert.equal(
    await noteUsernameSignInFailureRpc({ ...options, fetchImpl: async () => { throw new Error("offline"); } }),
    false,
  );
});

test("edge function v4 flow: bucketed client address, failures noted after the password check, success clears the pair", () => {
  const source = readFileSync("supabase/functions/username-password-signin/index.ts", "utf8");
  assert.match(
    source,
    /clientBucket\(\s*request\.headers\.get\("cf-connecting-ip"\)\s*\?\?\s*request\.headers\.get\("x-forwarded-for"\)\?\.split\(",", 1\)\[0\]\s*\?\?\s*"unknown",?\s*\)/,
    "the client key is the grouped bucket with the same header precedence as v3",
  );
  assert.ok(source.includes("v4Args: {"));
  assert.ok(source.includes("sha256(`username-aggregate-v4:${normalized}`)"));
  assert.ok(source.includes("sha256(`username-client-v4:${normalized}:${clientAddress}`)"));

  const throttle = source.indexOf("resolution.throttled");
  const password = source.indexOf("signInWithPassword");
  const guard = source.indexOf("if (!resolvedUserId || !resolvedEmail || error || !data.session)");
  const failure = source.indexOf("noteUsernameSignInFailureRpc({");
  const generic = source.indexOf("return genericFailure(origin);", guard);
  const success = source.indexOf("noteUsernameSignInSuccessRpc({");
  assert.ok(throttle > 0 && throttle < password, "the throttle is answered before any password check");
  assert.ok(guard > password, "the failure guard follows the password check");
  assert.ok(failure > guard && failure < generic, "the failure note sits inside the failed-sign-in branch, before its response");
  assert.ok(success > generic, "the success note follows the failed-sign-in branch");
  assert.ok(source.includes("attemptKey: resolution.version === 4 ? pairAttemptKey : attemptKey"));
  assert.ok(source.includes("if (resolution.version === 4) {"), "failures are only recorded when v4 resolved the request");
});

test("v4 migration is additive, keeps v3, and checks client, then global, then failure counters", () => {
  const sql = readFileSync(
    "supabase/migrations/20261112190000_account_username_signin_throttle_v4.sql",
    "utf8",
  );
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.doesNotMatch(sql, /drop function|drop table|alter table|truncate/i);
  assert.doesNotMatch(sql, /delete from account_private\.username_signin_attempts\s+where attempt_key/);
  for (const object of [
    "public.account_resolve_username_signin_v3(text,text,text)",
    "account_api.account_resolve_username_signin_v3(text,text,text)",
    "public.account_note_username_signin_success_v1(text)",
    "account_api.account_note_username_signin_success_v1(text)",
  ]) {
    assert.ok(sql.includes(`to_regprocedure('${object}')`), object);
  }
  assert.match(sql, /returns table \(resolved_user_id uuid, throttled boolean\)/);
  for (const limit of [
    "client_count > 30",
    "global_count > 500",
    "coalesce(pair_count, 0) >= 10",
    "coalesce(aggregate_count, 0) >= 100",
  ]) {
    assert.ok(sql.includes(limit), limit);
  }
  const client = sql.indexOf("returning attempt_count into client_count");
  const global = sql.indexOf("returning attempt_count into global_count");
  const pair = sql.indexOf("into pair_count");
  const aggregate = sql.indexOf("into aggregate_count");
  assert.ok(
    client > 0 && client < global && global < pair && pair < aggregate,
    "the client limit is checked before the shared global counter is touched",
  );
  assert.equal(sql.split("security definer").length - 1, 4);
  assert.equal(sql.split("set search_path = pg_catalog").length - 1, 4);
  assert.equal(sql.split("from public, anon, authenticated").length - 1, 4);
  assert.equal(sql.split("to service_role").length - 1, 4);
  assert.match(sql, /p_pair_attempt_key = repeat\('0', 64\)/);
  assert.match(sql, /coalesce\(p_pair_attempt_key !~ '\^\[0-9a-f\]\{64\}\$', true\)/);
});

test("client bucket groups IPv6 by /64, canonicalizes IPv4 and sends anything unparsable to one shared bucket", () => {
  const sameSubscriber = "v6/64:2001:0db8:0000:0000";
  for (const address of [
    "2001:db8::1",
    "2001:DB8:0:0:ffff:ffff:ffff:ffff",
    "[2001:db8::5]",
    "2001:db8::1%eth0",
    " 2001:0db8:0000:0000:0000:0000:0000:0001 ",
  ]) {
    assert.equal(clientBucket(address), sameSubscriber, address);
  }
  assert.notEqual(clientBucket("2001:db8:0:1::1"), sameSubscriber, "a different /64 is a different bucket");
  assert.equal(clientBucket("2001:db8:0:1::1"), "v6/64:2001:0db8:0000:0001");
  assert.equal(clientBucket("::"), "v6/64:0000:0000:0000:0000");
  assert.equal(clientBucket("::1"), "v6/64:0000:0000:0000:0000");
  assert.equal(clientBucket("1:2:3:4:5:6:1.2.3.4"), "v6/64:0001:0002:0003:0004");
  assert.equal(clientBucket("64:ff9b::1.2.3.4"), "v6/64:0064:ff9b:0000:0000");

  assert.equal(clientBucket("1.2.3.4"), "1.2.3.4");
  assert.equal(clientBucket("001.2.3.4"), "1.2.3.4", "leading zeros cannot create a second bucket");
  assert.equal(clientBucket("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(clientBucket("::ffff:102:304"), "1.2.3.4");

  for (const bad of [
    undefined, null, 42, "", "   ", "garbage", "256.1.1.1", "1.2.3", "::ffff:1.2.3.999", "1::2::3",
    "2001:db8:1:2:3:4:5:6:7", "2001:db8:1:2:3:4:5", "12345::1", ":1:2:3:4:5:6:7", "unknown",
  ]) {
    assert.equal(clientBucket(bad), "unknown", String(bad));
  }
});
