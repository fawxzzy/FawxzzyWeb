# Fawxzzy discovery-routing contract

## Canonical experience

`/apps` is the canonical Fawxzzy public surface and the site's landing page. It
holds the app catalog, installation guidance, and direct app launches, and links
to the Account surface. There is no home page, no second discovery page, and no
external social destination on the site.

`/` and `/discover` exist only for compatibility. Vercel redirects `/` to `/apps`
(temporary) and `/discover` to `/apps?compatibility=discover` (permanent); the
deterministic static export keeps a small no-index transition page for each so
local and non-Vercel hosts still provide a useful recovery action. The `/` page
also asks the browser to continue to Apps immediately (`<meta http-equiv="refresh">`).

## Current public scope

- Apps are sourced only from `src/data/apps.ts`.
- Product cards, installation guidance, previews, and app launches live only on `/apps`.
- Account access leaves the public hub for `https://account.fawxzzy.com/account`.
- Fitness and Mazer remain independently owned and deployed.
- Apps uses responsive display derivatives instead of loading full trailer
  assets; historical detail pages and trailers are provenance only.

The home page, every social-profile destination (including YouTube, X, Discord,
and Snapchat), newsletters, custom intake, support links, payment links, and
gaming-profile identities are retired from active public discovery. Their historical documents are knowledge-only provenance and do not
authorize navigation, collection, or provider behavior.

## Verification

1. `/apps` contains the centralized app catalog; the shared navigation and footer
   link only to Apps and Account.
2. `/` and `/discover` contain no duplicated product catalog or trailer surface.
3. Canonical metadata for `/`, `/discover`, and `/trove` points to `/apps`; all
   three are no-index, and the sitemap lists only `/apps` and the legal pages.
4. `vercel.json` carries the temporary `/` to `/apps` redirect and the permanent
   `/discover` to `/apps?compatibility=discover` redirect.
5. The static `/` fallback continues to Apps and renders no home content.
6. Mobile and desktop checks prove focus visibility, 44-pixel targets, reduced
   motion, no horizontal overflow, and no unexpected runtime errors.

**Decision — one app catalog, no home page (2026-11-13).** Apps owns product
discovery and launching and is where the root lands. Compatibility URLs lead into
that canonical surface instead of preserving parallel content.
