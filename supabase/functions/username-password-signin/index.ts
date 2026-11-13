import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { createPublicKeyAdmission } from "./public-key.mjs";
import {
  noteUsernameSignInFailureRpc,
  noteUsernameSignInFailureV2Rpc,
  noteUsernameSignInSuccessRpc,
  resolveUsernameSignIn,
} from "./rpc-response.mjs";
import { clientAddressFromHeaders, deriveThrottleKeys } from "./throttle-keys.mjs";

const USERNAME = /^[A-Za-z0-9._-]{2,15}$/;
const ALLOWED_ORIGINS = new Set(["https://account.fawxzzy.com"]);
const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": origin,
  Vary: "Origin",
});
const genericFailure = (origin = "") => new Response(JSON.stringify({ error: "Invalid credentials" }), {
  headers: { "Content-Type": "application/json", ...(ALLOWED_ORIGINS.has(origin) ? corsHeaders(origin) : {}) },
  status: 401,
});
const throttledFailure = (origin = "") => new Response(
  JSON.stringify({ code: "username_throttled", error: "Too many attempts" }),
  {
    headers: {
      "Content-Type": "application/json",
      "Retry-After": "900",
      ...(ALLOWED_ORIGINS.has(origin) ? corsHeaders(origin) : {}),
    },
    status: 429,
  },
);
const admitPublicClientKey = createPublicKeyAdmission();

function acceptedPublicKeys() {
  const keys = new Set<string>();
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) keys.add(legacy);
  try {
    const configured = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    if (Array.isArray(configured)) {
      for (const value of configured) if (typeof value === "string") keys.add(value);
    } else if (configured && typeof configured === "object") {
      for (const value of Object.values(configured)) if (typeof value === "string") keys.add(value);
    }
  } catch {
    // A malformed runtime key map fails closed below.
  }
  return keys;
}

async function isAcceptedPublicKey(requestKey: string) {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return false;
  return admitPublicClientKey(requestKey, acceptedPublicKeys(), async (candidate) => {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: candidate },
      method: "GET",
    });
    return response.ok;
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (request.method === "OPTIONS" && ALLOWED_ORIGINS.has(origin)) {
    return new Response(null, { headers: corsHeaders(origin), status: 204 });
  }
  if (request.method !== "POST" || !ALLOWED_ORIGINS.has(origin)) return genericFailure(origin);
  const requestKey = request.headers.get("apikey") ?? "";
  if (!requestKey || !await isAcceptedPublicKey(requestKey)) return genericFailure(origin);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return genericFailure(origin);
  }
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return genericFailure(origin);

  try {
    const body = await request.json();
    const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!USERNAME.test(identifier) || password.length < 1 || password.length > 1024) return genericFailure(origin);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceRole || !anonKey) return genericFailure(origin);

    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const normalized = identifier.toLowerCase();
    // Only cf-connecting-ip is trusted (x-forwarded-for is caller-controlled and is not used). An IPv6 client is grouped by
    // its /64 and a missing or unparsable address shares the single "unknown" bucket, which the database caps strictly.
    const clientAddress = clientAddressFromHeaders(request.headers);
    const keys = await deriveThrottleKeys({ client: clientAddress, normalized });
    const resolution = await resolveUsernameSignIn({
      args: keys.v3,
      fetchImpl: fetch,
      serviceRole,
      url,
      v4Args: keys.v4,
      v5Args: keys.v5,
    });
    // A lockout is reported distinctly (it is independent of whether the username exists).
    if (resolution.throttled) return throttledFailure(origin);
    const resolvedUserId = resolution.userId;
    const { data: userResult } = await admin.auth.admin.getUserById(
      resolvedUserId ?? "00000000-0000-0000-0000-000000000000",
    );
    const resolvedEmail = userResult?.user?.email;
    const email = resolvedEmail ?? "invalid-login@invalid.fawxzzy.local";

    const auth = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (!resolvedUserId || !resolvedEmail || error || !data.session) {
      // v5 and v4 count failures only (known and unknown usernames alike) after the password check; best effort.
      if (resolution.version === 5) {
        await noteUsernameSignInFailureV2Rpc({
          attemptKey: keys.v5.p_attempt_key,
          clientAttemptKey: keys.v5.p_client_attempt_key,
          fetchImpl: fetch,
          pairAttemptKey: keys.v5.p_pair_attempt_key,
          serviceRole,
          url,
        });
      } else if (resolution.version === 4) {
        await noteUsernameSignInFailureRpc({
          attemptKey: keys.v4.p_attempt_key,
          fetchImpl: fetch,
          pairAttemptKey: keys.v4.p_pair_attempt_key,
          serviceRole,
          url,
        });
      }
      return genericFailure(origin);
    }
    // Verified sign-in: clear this caller's (username, client) failure counter and nothing else (best effort).
    await noteUsernameSignInSuccessRpc({
      attemptKey: resolution.version === 5
        ? keys.v5.p_pair_attempt_key
        : resolution.version === 4 ? keys.v4.p_pair_attempt_key : keys.v3.p_attempt_key,
      fetchImpl: fetch,
      serviceRole,
      url,
    });
    return new Response(JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }), {
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
      },
      status: 200,
    });
  } catch {
    return genericFailure(origin);
  }
});
