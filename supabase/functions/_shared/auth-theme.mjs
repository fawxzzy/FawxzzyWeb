/**
 * Single source of truth for the per-app presentation tokens shared by the
 * account portal sign-in/reset screens (src/config/account.ts) and the
 * transactional auth email renderer (supabase/functions/auth-send-email).
 *
 * Plain ESM with no imports so the Next.js build and the Deno edge runtime can
 * both load it. tests/auth-email-contract.test.mjs fails if either consumer
 * (or the portal CSS base colors) drifts from these values.
 *
 * Presentation only. A theme never selects an Auth provider, callback, session
 * or return target.
 */

/** Base colors/fonts of the account auth screens (see utility.css). */
export const authThemeBase = Object.freeze({
  canvasHex: "#070b09",
  textHex: "#f5f5f7",
  /** `--muted` in tokens-and-reset.css, space separated RGB. */
  mutedRgb: "174 174 182",
  fontFamily: '"Segoe UI Variable", "Helvetica Neue", Arial, sans-serif',
});

/**
 * Per-app tokens. `kicker` is the product marker printed above the screen
 * title; `accentRgb` is the `--auth-accent` value; `accountLabel` is the
 * neutral wording used in the "why you are receiving this" line.
 */
export const authThemes = Object.freeze({
  website: Object.freeze({
    id: "website",
    kicker: "Fawxzzy",
    accentRgb: "147 184 148",
    accountLabel: "Fawxzzy account",
  }),
  fitness: Object.freeze({
    id: "fitness",
    kicker: "Fitness",
    accentRgb: "160 223 56",
    accountLabel: "Fitness account",
  }),
  mazer: Object.freeze({
    id: "mazer",
    kicker: "Mazer",
    accentRgb: "53 238 224",
    accountLabel: "Mazer account",
  }),
});

/** Same fallback rule as resolveAccountExperienceContext in the portal. */
export function resolveAuthTheme(rawApp) {
  if (typeof rawApp !== "string") return authThemes.website;
  if (!Object.prototype.hasOwnProperty.call(authThemes, rawApp)) return authThemes.website;
  return authThemes[rawApp];
}

/**
 * Select the theme from the `app` query parameter of the Auth redirect URL.
 * Mirrors the portal (useAccountExperienceContext): exactly one `app` value is
 * honoured; anything else (missing, repeated, unknown, malformed URL) is the
 * default Fawxzzy theme.
 */
export function resolveAuthThemeFromRedirect(redirectTo) {
  try {
    const apps = new URL(String(redirectTo)).searchParams.getAll("app");
    return resolveAuthTheme(apps.length === 1 ? apps[0] : null);
  } catch {
    return authThemes.website;
  }
}
