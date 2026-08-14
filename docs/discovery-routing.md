# Fawxzzy discovery-routing contract

## Canonical experience

`/` is the canonical Fawxzzy discovery surface. It combines the product entry
point, a concise app shelf, and the one active external discovery destination:
TikTok. There is no second discovery page.

`/discover` exists only for compatibility. Vercel permanently redirects it to
`/`; the deterministic static export keeps a small no-index transition page so
local and non-Vercel hosts still provide a useful recovery action.

## Current public scope

- Apps are sourced only from `src/data/apps.ts`.
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
5. Mobile and desktop checks prove focus visibility, 44-pixel targets, reduced
   motion, no horizontal overflow, and no unexpected runtime errors.

**Decision — one discovery surface.** Home owns product discovery; compatibility
URLs lead into that surface instead of preserving parallel page content.
