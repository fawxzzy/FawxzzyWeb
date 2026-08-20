import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://fawxzzy.com",
  "https://www.fawxzzy.com",
  "https://fitness.fawxzzy.com",
  "https://mazer.fawxzzy.com",
]);
const events = new Set([
  "page_view",
  "tiktok_open",
  "catalog_app_view",
  "app_launch",
  "compatibility_visit",
]);
const routes = new Set(["/", "/apps", "/apps/fitness", "/apps/mazer", "app"]);
const apps = new Set(["fitness", "mazer"]);
const products = new Set(["web", "fitness", "mazer"]);
const compatibilitySources = new Set([
  "discover",
  "trove",
  "fitness_legacy_origin",
  "mazer_legacy_origin",
]);

type Payload = {
  app?: unknown;
  compatibility?: unknown;
  event?: unknown;
  product?: unknown;
  route?: unknown;
};

function hasValidProductShape(payload: Payload) {
  if (payload.product === "web") {
    return (
      payload.route !== "app" &&
      payload.event !== "compatibility_visit" &&
      (payload.compatibility === undefined ||
        payload.compatibility === "discover" ||
        payload.compatibility === "trove")
    );
  }
  if (payload.product === "fitness") {
    return (
      payload.event === "compatibility_visit" &&
      payload.route === "app" &&
      payload.app === undefined &&
      payload.compatibility === "fitness_legacy_origin"
    );
  }
  if (payload.product === "mazer") {
    return (
      payload.event === "compatibility_visit" &&
      payload.route === "app" &&
      payload.app === undefined &&
      payload.compatibility === "mazer_legacy_origin"
    );
  }
  return false;
}

function headers(origin: string) {
  return {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
}

function response(origin: string, status: number) {
  return new Response(status === 204 ? null : JSON.stringify({ accepted: status === 202 }), {
    headers: headers(origin),
    status,
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.has(origin)) return response("null", 403);
  if (request.method === "OPTIONS") return response(origin, 204);
  if (request.method !== "POST") return response(origin, 405);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 1024) return response(origin, 413);

  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return response(origin, 400);
  }

  if (
    typeof payload.event !== "string" ||
    !events.has(payload.event) ||
    typeof payload.route !== "string" ||
    !routes.has(payload.route) ||
    typeof payload.product !== "string" ||
    !products.has(payload.product) ||
    (payload.app !== undefined && (typeof payload.app !== "string" || !apps.has(payload.app))) ||
    (payload.compatibility !== undefined &&
      (typeof payload.compatibility !== "string" ||
        !compatibilitySources.has(payload.compatibility))) ||
    !hasValidProductShape(payload)
  ) {
    return response(origin, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { error } = await supabase.schema("fawxzzy_analytics").from("events").insert({
    app: payload.app ?? null,
    compatibility_source: payload.compatibility ?? null,
    event_name: payload.event,
    product: payload.product,
    route: payload.route,
  });

  return response(origin, error ? 503 : 202);
});
