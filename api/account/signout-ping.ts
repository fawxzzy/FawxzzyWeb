// Capability ping for GET https://account.fawxzzy.com/signout (MAZER-ACCT-041).
// Served at https://account.fawxzzy.com/signout/ping through the vercel.json rewrite. Mazer calls it
// with fetch() before navigating, to tell a deployed /signout from a 404. It carries no data and
// sets no cookie: 204, a fixed Access-Control-Allow-Origin for the Mazer origin only (never "*",
// never the request's Origin, never credentials), and no caching.
const MAZER_ORIGIN = "https://mazer.fawxzzy.com";

const HEADERS = {
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": MAZER_ORIGIN,
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "Vary": "Origin",
  "X-Content-Type-Options": "nosniff",
} as const;

function answer() {
  return new Response(null, { headers: HEADERS, status: 204 });
}

export function GET() {
  return answer();
}

export function HEAD() {
  return answer();
}

export function OPTIONS() {
  return answer();
}

export function POST() {
  return new Response(null, { headers: { ...HEADERS, Allow: "GET, HEAD, OPTIONS" }, status: 405 });
}
