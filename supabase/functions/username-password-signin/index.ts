import { createClient } from "npm:@supabase/supabase-js@2.109.0";

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

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (request.method === "OPTIONS" && ALLOWED_ORIGINS.has(origin)) {
    return new Response(null, { headers: corsHeaders(origin), status: 204 });
  }
  if (request.method !== "POST" || !ALLOWED_ORIGINS.has(origin)) return genericFailure(origin);
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
    const matches: string[] = [];
    for (let page = 1; page <= 10 && matches.length < 2; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return genericFailure(origin);
      for (const user of data.users) {
        const metadata = user.user_metadata ?? {};
        const candidate = [metadata.username, metadata.display_name]
          .find((value) => typeof value === "string" && value.trim())?.trim().toLowerCase();
        if (candidate === normalized && user.email) matches.push(user.email);
      }
      if (data.users.length < 200) break;
    }
    if (matches.length !== 1) return genericFailure(origin);

    const auth = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email: matches[0], password });
    if (error || !data.session) return genericFailure(origin);
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
