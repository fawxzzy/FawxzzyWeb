import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  noteUsernameSignInSuccessRpc,
  resolveUsernameSignIn,
  resolveUsernameSignInV3Rpc,
} from "../supabase/functions/username-password-signin/rpc-response.mjs";
import { loadPortalModule } from "./helpers/load-portal-ts.mjs";

const url = "https://project.example.test";
const serviceRole = "service-role-fixture";
const args = {
  p_attempt_key: "a".repeat(64),
  p_client_attempt_key: "b".repeat(64),
  p_normalized_username: "fawxzzy",
};
const userId = "adc7ca28-7271-5599-826f-fd7e4477b542";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function recordingFetch(responder) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ init, input });
    return responder(input, init);
  };
  return { calls, fetchImpl };
}

test("v3 resolver reports a throttle separately from a resolved or missing user", async () => {
  const { calls, fetchImpl } = recordingFetch(() => json([{ resolved_user_id: userId, throttled: false }]));
  assert.deepEqual(
    await resolveUsernameSignInV3Rpc({ args, fetchImpl, serviceRole, url }),
    { throttled: false, userId, version: 3 },
  );
  assert.equal(calls[0].input, `${url}/rest/v1/rpc/account_resolve_username_signin_v3`);
  assert.equal(calls[0].init.headers["Accept-Profile"], "account_api");
  assert.equal(calls[0].init.headers["Content-Profile"], "account_api");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.body, JSON.stringify(args));

  assert.deepEqual(
    await resolveUsernameSignInV3Rpc({
      args,
      fetchImpl: async () => json([{ resolved_user_id: null, throttled: true }]),
      serviceRole,
      url,
    }),
    { throttled: true, userId: null, version: 3 },
  );
  // Unknown username: not throttled, no user (indistinguishable from a wrong password).
  assert.deepEqual(
    await resolveUsernameSignInV3Rpc({
      args,
      fetchImpl: async () => json([{ resolved_user_id: null, throttled: false }]),
      serviceRole,
      url,
    }),
    { throttled: false, userId: null, version: 3 },
  );
});

test("v3 resolver fails closed on malformed shapes and transport errors", async () => {
  const closed = { throttled: false, userId: null, version: 3 };
  for (const responder of [
    async () => json([]),
    async () => json([{ resolved_user_id: userId, throttled: false }, { resolved_user_id: userId, throttled: false }]),
    async () => json({ resolved_user_id: userId, throttled: false }),
    async () => json([{ resolved_user_id: userId }]),
    async () => json([{ resolved_user_id: userId, throttled: "false" }]),
    async () => json([{ resolved_user_id: "not-a-uuid", throttled: false }]),
    async () => json({ message: "not acceptable" }, 406),
    async () => json({ message: "boom" }, 500),
    async () => { throw new Error("network detail must not escape"); },
  ]) {
    assert.deepEqual(
      await resolveUsernameSignInV3Rpc({ args, fetchImpl: responder, serviceRole, url }),
      closed,
    );
  }
});

test("resolveUsernameSignIn falls back to v2 only when v3 is absent", async () => {
  const { calls, fetchImpl } = recordingFetch((input) => {
    if (input.endsWith("account_resolve_username_signin_v3")) {
      return json({ code: "PGRST202", message: "Could not find the function" }, 404);
    }
    return json([{ resolved_user_id: userId }]);
  });
  assert.deepEqual(
    await resolveUsernameSignIn({ args, fetchImpl, serviceRole, url }),
    { throttled: false, userId, version: 2 },
  );
  assert.deepEqual(calls.map((call) => call.input.split("/").pop()), [
    "account_resolve_username_signin_v3",
    "account_resolve_username_signin_v2",
  ]);

  // A 500 from v3 is NOT "absent": do not silently skip the throttle by calling v2.
  const failing = recordingFetch(() => json({ message: "boom" }, 500));
  assert.deepEqual(
    await resolveUsernameSignIn({ args, fetchImpl: failing.fetchImpl, serviceRole, url }),
    { throttled: false, userId: null, version: 3 },
  );
  assert.equal(failing.calls.length, 1);

  // v3 present: v2 is never called.
  const present = recordingFetch(() => json([{ resolved_user_id: null, throttled: true }]));
  assert.deepEqual(
    await resolveUsernameSignIn({ args, fetchImpl: present.fetchImpl, serviceRole, url }),
    { throttled: true, userId: null, version: 3 },
  );
  assert.equal(present.calls.length, 1);
});

test("note-success clears the per-username counter and never throws", async () => {
  const { calls, fetchImpl } = recordingFetch(() => new Response(null, { status: 204 }));
  assert.equal(
    await noteUsernameSignInSuccessRpc({ attemptKey: "a".repeat(64), fetchImpl, serviceRole, url }),
    true,
  );
  assert.equal(calls[0].input, `${url}/rest/v1/rpc/account_note_username_signin_success_v1`);
  assert.equal(calls[0].init.body, JSON.stringify({ p_attempt_key: "a".repeat(64) }));
  assert.equal(calls[0].init.headers["Content-Profile"], "account_api");
  assert.equal(
    await noteUsernameSignInSuccessRpc({
      attemptKey: "a".repeat(64),
      fetchImpl: async () => json({ code: "PGRST202" }, 404),
      serviceRole,
      url,
    }),
    false,
  );
  assert.equal(
    await noteUsernameSignInSuccessRpc({
      attemptKey: "a".repeat(64),
      fetchImpl: async () => { throw new Error("offline"); },
      serviceRole,
      url,
    }),
    false,
  );
});

test("edge function checks the throttle first and notes success only after a verified sign-in", () => {
  const source = readFileSync("supabase/functions/username-password-signin/index.ts", "utf8");
  assert.match(source, /resolveUsernameSignIn\(/);
  assert.match(source, /status: 429/);
  assert.match(source, /code: "username_throttled"/);
  const throttle = source.indexOf("resolution.throttled");
  const password = source.indexOf("signInWithPassword");
  const verified = source.indexOf("if (!resolvedUserId || !resolvedEmail || error || !data.session)");
  const note = source.indexOf("noteUsernameSignInSuccessRpc({");
  assert.ok(throttle > 0 && throttle < password, "throttle must be answered before any password check");
  assert.ok(verified > password && note > verified, "note-success must follow the verified-success guard");
});

test("v3 migration is additive, keeps v2, and mirrors the v2 limits, grants and hardening", () => {
  const sql = readFileSync(
    "supabase/migrations/20261112140000_account_username_signin_throttle_v3.sql",
    "utf8",
  );
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.doesNotMatch(sql, /drop function|drop table|alter table/i);
  assert.match(sql, /to_regprocedure\('public\.account_resolve_username_signin_v2\(text,text,text\)'\)/);
  assert.match(sql, /to_regclass\('account_private\.username_signin_attempts'\)/);
  assert.match(sql, /returns table \(resolved_user_id uuid, throttled boolean\)/);
  for (const limit of ["current_count > 10", "client_count > 30", "global_count > 500"]) {
    assert.ok(sql.includes(limit), limit);
  }
  assert.equal(sql.split("security definer").length - 1, 4);
  assert.equal(sql.split("set search_path = pg_catalog").length - 1, 4);
  assert.equal(sql.split("from public, anon, authenticated").length - 1, 4);
  assert.equal(sql.split("to service_role").length - 1, 4);
  assert.match(sql, /p_attempt_key = repeat\('0', 64\)/);
  // v3 input validation is NULL-safe and never accepts the shared global counter key.
  assert.match(sql, /coalesce\(p_normalized_username !~ '\^\[a-z0-9\._-\]\{2,15\}\$', true\)/);
  assert.match(sql, /coalesce\(p_attempt_key !~ '\^\[0-9a-f\]\{64\}\$', true\)/);
  assert.match(sql, /coalesce\(p_client_attempt_key !~ '\^\[0-9a-f\]\{64\}\$', true\)/);
  assert.match(sql, /or p_client_attempt_key = repeat\('0', 64\) then/);
  assert.match(sql, /delete from account_private\.username_signin_attempts\s+where attempt_key = p_attempt_key/);
});

test("lockout copy is distinct, names the way out, and reveals nothing about accounts", () => {
  const errors = loadPortalModule("src/lib/auth/errors.ts");
  const copy = errors.safeAuthError("login-throttled");
  assert.equal(copy, "Too many tries. Wait 15 minutes or use your email.");
  assert.notEqual(copy, errors.safeAuthError("login"));
  assert.doesNotMatch(copy, /exists|registered|no account|not found/i);
  assert.equal(errors.USERNAME_THROTTLED_CODE, "username_throttled");
  assert.equal(new errors.UsernameSignInThrottledError().name, "UsernameSignInThrottledError");
  // The generic login copy stays short and neutral.
  assert.equal(errors.safeAuthError("login"), "Wrong details. Try again.");
});

test("sign-up username disclosure copy is the owner-approved line", () => {
  const guidance = loadPortalModule("src/lib/auth/form-guidance.ts");
  assert.equal(guidance.USERNAME_VISIBILITY_NOTE, "This username shows on the Mazer leaderboard.");
});
