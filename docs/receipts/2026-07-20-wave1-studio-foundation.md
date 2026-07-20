# Wave 1 studio foundation

Date: 2026-07-20

## Change

- Reframed Home around the full software, fitness, games, and creator ecosystem.
- Moved current Fitness and Mazer proof ahead of product philosophy.
- Added one centralized media-led product showcase for Home and Apps.
- Converted Apps from stacked status rows into a two-column visual catalog.
- Removed catalog-level review placeholders until real governed review data exists.
- Added a current build note, restrained newsletter invitation, and complete
  route-grounded footer.
- Strengthened shared typography, spacing, surface hierarchy, navigation, focus,
  mobile, and reduced-motion behavior.
- Kept the July 20 one-minute production walkthroughs, posters, captions, icons,
  current app origins, compatibility route, and shared-account source behavior.

## Architecture

The product showcase reads all live identity and media from `src/data/apps.ts`.
Home renders the poster-led variant; Apps adds the existing native trailer
disclosure and proven player. The new footer is a reusable public-page primitive.
No new UI library or design-system dependency was added.

## Scope boundary

This is Wave 1 only. Fitness/Mazer product-detail composition, Discover,
Newsletter editorial treatment, Login/Auth, and Account remain behaviorally and
visually unchanged except for mechanical shared navigation styles. No provider,
domain, DNS, environment, Supabase, Auth, data, or production mutation belongs
to this change.

## Required proof

- `npm run verify`
- Chromium and iPhone-class WebKit route/media checks
- WCAG A/AA automation
- 1440x900, 1280x800, and 390x844 captures for Home and Apps
- no horizontal overflow, browser errors, or framework overlays
- product posters, videos, captions, current routes, and metadata remain intact
