// Mirror of the Supabase Auth "Redirect URLs" allow list, read live from the Supabase dashboard
// (read-only) on 2026-11-15. Supabase matches these EXACTLY, query string included; an unmatched
// redirect falls back to the Site URL. Provider settings cannot be changed from this repo: if the
// dashboard list changes, update this fixture in the same PR as the code that needs it.
export const SUPABASE_REDIRECT_ALLOWLIST = Object.freeze([
  "https://account.fawxzzy.com/auth/confirm",
  "https://account.fawxzzy.com/auth/confirm?app=fitness&returnTo=https%3A%2F%2Ffitness.fawxzzy.com%2F",
  "https://account.fawxzzy.com/auth/confirm?app=mazer&returnTo=https%3A%2F%2Fmazer.fawxzzy.com%2F",
  "https://account.fawxzzy.com/auth/callback",
  "https://account.fawxzzy.com/reset-password?recovery=1",
  "https://account.fawxzzy.com/reset-password?recovery=1&app=fitness",
  "https://account.fawxzzy.com/reset-password?recovery=1&app=mazer",
  "https://mazer.fawxzzy.com/",
  "https://mazer.fawxzzy.com/update-password",
]);
