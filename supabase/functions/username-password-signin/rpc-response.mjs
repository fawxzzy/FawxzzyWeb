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

/**
 * v3 resolver: one row `{ resolved_user_id, throttled }`. A throttled call is reported
 * separately from "no such user / wrong password" so the client can show a distinct message.
 * Returns `{ userId, throttled, version: 3 }`; malformed or failed responses fail closed with
 * `userId: null, throttled: false`. `version: null` means v3 is not installed (caller falls back).
 */
export async function resolveUsernameSignInV3Rpc({ args, fetchImpl, serviceRole, url }) {
  const closed = { throttled: false, userId: null, version: 3 };
  try {
    const response = await rpcRequest({
      args,
      fetchImpl,
      name: "account_resolve_username_signin_v3",
      serviceRole,
      url,
    });
    if (!response.ok) {
      return await functionIsAbsent(response)
        ? { throttled: false, userId: null, version: null }
        : closed;
    }
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return closed;
    const { resolved_user_id: resolvedUserId, throttled } = rows[0] ?? {};
    if (typeof throttled !== "boolean") return closed;
    if (throttled) return { throttled: true, userId: null, version: 3 };
    if (resolvedUserId === null) return closed;
    return typeof resolvedUserId === "string" && UUID.test(resolvedUserId)
      ? { throttled: false, userId: resolvedUserId, version: 3 }
      : closed;
  } catch {
    return closed;
  }
}

/** Prefers v3; falls back to v2 (which cannot report a throttle) when v3 is not installed. */
export async function resolveUsernameSignIn(options) {
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
