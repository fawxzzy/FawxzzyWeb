// Live "online now" contract for the website header (docs/live-presence.md).
// Pure functions only: no I/O, safe to import from the browser bundle and from tests.
//
// Definition: the number of site tabs that are visible in a browser right now, one per tab,
// anonymous. A person with two visible windows counts twice. Nothing identifying is sent or
// stored: each tab joins with a random in-memory key that disappears when the tab closes.
export const PRESENCE_CHANNEL = 'web-presence-v1';

// Only the real production site origins run presence. Previews, local test origins, the www
// alias and every other host stay inert.
export const PRESENCE_ORIGINS = Object.freeze(['https://fawxzzy.com', 'https://account.fawxzzy.com']);

export const isPresenceOrigin = (origin) => PRESENCE_ORIGINS.includes(origin);

// Snapshot semantics: always recompute from the current presence state, never accumulate
// join/leave deltas. State shape is { [presenceKey]: [meta, ...] }.
export function countPresence(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return 0;
  return Object.values(state).filter((entries) => Array.isArray(entries) && entries.length > 0).length;
}

// Realtime websocket URL for a Supabase project URL, or null when the URL is not an
// https://<ref>.supabase.co project origin.
export function realtimeUrl(supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'https:' || !/^[a-z0-9]{10,40}\.supabase\.co$/u.test(parsed.hostname)
      || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return null;
    return `wss://${parsed.hostname}/realtime/v1`;
  } catch {
    return null;
  }
}

// Text for the header. Never a number for an unknown, zero or invalid count (no false precision).
export function formatOnline(count) {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  if (count < 1000) return String(count);
  if (count < 10000) return `${(Math.floor(count / 100) / 10).toString().replace(/\.0$/u, '')}k`;
  return `${Math.floor(count / 1000)}k`;
}
