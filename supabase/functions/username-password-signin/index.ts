import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { createPublicKeyAdmission } from "./public-key.mjs";

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

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const clientAddress = request.headers.get("cf-connecting-ip")
      ?? request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
      ?? "unknown";
    const attemptKey = await sha256(`username:${normalized}`);
    const clientAttemptKey = await sha256(`client:${clientAddress}`);
    const { data: lookupRows, error: lookupError } = await admin.rpc("account_resolve_username_signin_v2", {
      p_attempt_key: attemptKey,
      p_client_attempt_key: clientAttemptKey,
      p_normalized_username: normalized,
    });
    const resolvedUserId = !lookupError
        && Array.isArray(lookupRows)
        && lookupRows.length === 1
        && typeof lookupRows[0]?.resolved_user_id === "string"
      ? lookupRows[0].resolved_user_id
      : "00000000-0000-0000-0000-000000000000";
    const { data: userResult } = await admin.auth.admin.getUserById(resolvedUserId);
    const resolvedEmail = userResult?.user?.email;
    const email = resolvedEmail ?? "invalid-login@invalid.fawxzzy.local";

    const auth = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (lookupError || !resolvedEmail || error || !data.session) return genericFailure(origin);
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
