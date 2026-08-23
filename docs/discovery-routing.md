# Fawxzzy discovery-routing contract

## Canonical experience

`/` is the canonical Fawxzzy creator and discovery surface. It introduces
Fawxzzy, links into the dedicated Apps and Account surfaces, and exposes the one
active external discovery destination: TikTok. It does not duplicate the app
catalog, and there is no second discovery page.

`/discover` exists only for compatibility. Vercel permanently redirects it to
`/`; the deterministic static export keeps a small no-index transition page so
local and non-Vercel hosts still provide a useful recovery action.

## Current public scope

- Apps are sourced only from `src/data/apps.ts`.
- Product cards, installation guidance, previews, and app launches live only on `/apps`.
- Account access leaves the public hub for `https://account.fawxzzy.com/account`.
- TikTok is sourced only from `src/data/discovery.ts`.
- Fitness and Mazer remain independently owned and deployed.
- App detail pages own trailers, full product explanation, and grounded launch
  links. Home and Apps use responsive display derivatives instead of loading
  full trailer assets.

YouTube, X, Discord, Snapchat, newsletters, custom intake, support links,
payment links, and gaming-profile identities are retired from active public
discovery. Their historical documents are knowledge-only provenance and do not
authorize navigation, collection, or provider behavior.

## Verification

1. `/` contains the centralized app shelf and exact TikTok destination.
2. `/discover` contains no duplicated product catalog or trailer surface.
3. Canonical metadata points to `/`; `/discover` is no-index.
4. `vercel.json` carries the permanent `/discover` to `/` redirect.
5. Home contains no app cards, launcher tiles, product previews, or trailers.
6. Mobile and desktop checks prove focus visibility, 44-pixel targets, reduced
   motion, no horizontal overflow, and no unexpected runtime errors.

**Decision — one creator home and one app catalog.** Home owns Fawxzzy identity
and top-level navigation; Apps owns product discovery and launching. Compatibility
URLs lead into those canonical surfaces instead of preserving parallel content.
