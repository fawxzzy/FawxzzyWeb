const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveUsernameSignInRpc({ args, fetchImpl, serviceRole, url }) {
  try {
    const response = await fetchImpl(`${url}/rest/v1/rpc/account_resolve_username_signin_v2`, {
      body: JSON.stringify(args),
      headers: {
        Accept: "application/json",
        "Accept-Profile": "account_api",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
        "Content-Profile": "account_api",
      },
      method: "POST",
      redirect: "error",
    });
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const resolvedUserId = rows[0]?.resolved_user_id;
    return typeof resolvedUserId === "string" && UUID.test(resolvedUserId)
      ? resolvedUserId
      : null;
  } catch {
    return null;
  }
}

function rpcRequest({ args, fetchImpl, name, serviceRole, url }) {
  return fetchImpl(`${url}/rest/v1/rpc/${name}`, {
    body: JSON.stringify(args),
    headers: {
      Accept: "application/json",
      "Accept-Profile": "account_api",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      "Content-Profile": "account_api",
    },
    method: "POST",
    redirect: "error",
  });
}

async function functionIsAbsent(response) {
  if (response.status === 404) return true;
  const body = await response.json().catch(() => null);
  return body?.code === "PGRST202" || body?.code === "42883";
}

async function resolveThrottledRpc({ args, fetchImpl, name, serviceRole, url, version }) {
  const closed = { throttled: false, userId: null, version };
  try {
    const response = await rpcRequest({ args, fetchImpl, name, serviceRole, url });
    if (!response.ok) {
      return await functionIsAbsent(response)
        ? { throttled: false, userId: null, version: null }
        : closed;
    }
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return closed;
    const { resolved_user_id: resolvedUserId, throttled } = rows[0] ?? {};
    if (typeof throttled !== "boolean") return closed;
    if (throttled) return { throttled: true, userId: null, version };
    if (resolvedUserId === null) return closed;
    return typeof resolvedUserId === "string" && UUID.test(resolvedUserId)
      ? { throttled: false, userId: resolvedUserId, version }
      : closed;
  } catch {
    return closed;
  }
}

/**
 * v3 resolver: one row `{ resolved_user_id, throttled }`. A throttled call is reported
 * separately from "no such user / wrong password" so the client can show a distinct message.
 * Returns `{ userId, throttled, version: 3 }`; malformed or failed responses fail closed with
 * `userId: null, throttled: false`. `version: null` means v3 is not installed (caller falls back).
 */
export function resolveUsernameSignInV3Rpc({ args, fetchImpl, serviceRole, url }) {
  return resolveThrottledRpc({
    args,
    fetchImpl,
    name: "account_resolve_username_signin_v3",
    serviceRole,
    url,
    version: 3,
  });
}

/**
 * v4 resolver: same row shape and fail-closed behavior as v3, with a per-(username, client) failure
 * key added to `args` (`p_pair_attempt_key`). Returns `{ userId, throttled, version: 4 }`;
 * `version: null` means v4 is not installed (caller falls back to v3).
 */
export function resolveUsernameSignInV4Rpc({ args, fetchImpl, serviceRole, url }) {
  return resolveThrottledRpc({
    args,
    fetchImpl,
    name: "account_resolve_username_signin_v4",
    serviceRole,
    url,
    version: 4,
  });
}

/**
 * Prefers v4 when `v4Args` is given, then v3, then v2 (which cannot report a throttle). A step is
 * skipped only when PostgREST says that function is absent; a 500 or a malformed answer from an
 * installed version fails closed and is never retried on an older version.
 * `args` are the v3 arguments; `v4Args` are the v4 arguments.
 */
export async function resolveUsernameSignIn({ v4Args, ...options }) {
  if (v4Args) {
    const v4 = await resolveUsernameSignInV4Rpc({ ...options, args: v4Args });
    if (v4.version !== null) return v4;
  }
  const v3 = await resolveUsernameSignInV3Rpc(options);
  if (v3.version !== null) return v3;
  const userId = await resolveUsernameSignInRpc(options);
  return { throttled: false, userId, version: 2 };
}

/**
 * Clears the per-username counter after a VERIFIED password sign-in so only failures accumulate.
 * Best effort: never throws and never affects the sign-in result. No-op for v2 (not installed).
 */
export async function noteUsernameSignInSuccessRpc({ attemptKey, fetchImpl, serviceRole, url }) {
  try {
    const response = await rpcRequest({
      args: { p_attempt_key: attemptKey },
      fetchImpl,
      name: "account_note_username_signin_success_v1",
      serviceRole,
      url,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Records a FAILED password check (known or unknown username alike) against the per-username
 * aggregate counter and the per-(username, client) counter. Best effort: never throws and never
 * affects the sign-in result. Returns false when v4 is not installed.
 */
export async function noteUsernameSignInFailureRpc({ attemptKey, fetchImpl, pairAttemptKey, serviceRole, url }) {
  try {
    const response = await rpcRequest({
      args: { p_attempt_key: attemptKey, p_pair_attempt_key: pairAttemptKey },
      fetchImpl,
      name: "account_note_username_signin_failure_v1",
      serviceRole,
      url,
    });
    return response.ok;
  } catch {
    return false;
  }
}
