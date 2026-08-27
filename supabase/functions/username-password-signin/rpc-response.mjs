const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveUsernameSignInRpc({ args, fetchImpl, serviceRole, url }) {
  try {
    const response = await fetchImpl(`${url}/rest/v1/rpc/account_resolve_username_signin_v2`, {
      body: JSON.stringify(args),
      headers: {
        Accept: "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      method: "POST",
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
