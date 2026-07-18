# FawxzzyWeb

FawxzzyWeb is the repository identity and codebase for the public `Fawxzzy` home: apps, product
updates, and grounded links to independently owned experiences. It preserves the source history
of Trove while moving the app catalog to its canonical `/apps` route. The provider and package
slug remains `fawxzzyweb`.

## Route contract

- `/` — canonical Fawxzzy root experience
- `/apps` — canonical app catalog, sourced from `src/data/apps.ts`
- `/discover` — centralized links to Fitness, custom-workout setup, Discord, TikTok, and YouTube
- `/trove` — reversible, no-index compatibility route for the former Trove identity
- `/apps/fitness/preview` — preserved deep link for the Fitness reference board
- `/login` — email/password sign-in and account creation
- `/account` — origin-scoped session status and safe account settings
- `/auth/confirm` — one-time `token_hash` confirmation handler
- `/auth/callback` — PKCE authorization-code callback scaffold
- `/reset-password` — recovery request and password completion surface
- `/healthz.json` — static health and compatibility identity
- `/manifest.webmanifest` — Fawxzzy install metadata

Fitness and Mazer remain independently owned and link to their existing production origins.
The catalog does not synthesize cross-origin install behavior.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Commands

```bash
npm run dev
npm run lint
npm run build
npm run qa:site-smoke
npm run smoke:lifeline
npm run test:e2e
npm run verify
```

`npm run verify` runs lint, a static export, route/identity smoke checks, and route-aware
Playwright checks for metadata, catalog and discovery truth, accessibility, mobile overflow,
deep links, account safety contracts, and compatibility rollback.

## Shared account portal

Phase one adds a client-only account surface for the future canonical origin
`https://account.fawxzzy.com`. The static source fails closed with a setup-pending state until
both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are supplied by a
separately governed provider-binding packet. No key values belong in this repository.

Sessions remain scoped to the browser origin. FawxzzyWeb does not set parent-domain cookies,
accept access or refresh tokens in URLs, or claim username/profile capability before the shared
platform schema is live. Exact redirects, return-target rules, provider settings, rollback, and
post-bind verification are frozen in `docs/shared-account-portal-phase1.md`.

## Catalog contract

Update `src/data/apps.ts` when the catalog changes. Each entry owns its current launch origin,
planned canonical subdomain, rollback origins, current app icon, trailer, poster, captions,
provenance hashes, copy, and tags. Home, Apps, and Discover consume this record so an icon or
origin update cannot drift between surfaces. The Playwright suite verifies every vendored icon,
poster, and trailer against its recorded SHA-256 hash.

The Apps catalog uses always-visible, user-controlled HTML video with `preload="none"` and a
caption track. The historical screenshot rail and inline Fitness preview board were replaced by
these trailer surfaces; `/apps/fitness/preview` remains available as a preserved deep link.

Current media sources:

- Fawxzzy brand artwork: operator-approved Socials OS derivatives from
  `assets/brand/manifest.json`.
- Fitness icon: exact public readback of the current production PWA `icon-512.png`.
- Fitness trailer: approved Socials OS `FITNESS-LAUNCH-TRAILER-V1` master and cover.
- Mazer icon: exact public readback of the current production `mazer-app-icon.png`.
- Mazer trailer: Fawxzzy-owned montage from the existing owned Mazer catalog captures.

Current grounded origins:

- Fitness: `https://fawxzzy-fitness-local.vercel.app`
- Mazer: `https://fawxzzy-mazer.vercel.app`

Planned owner-lane canonical origins (not live and not authorized by this repository change):

- Fitness: `https://fitness.fawxzzy.com`
- Mazer: `https://mazer.fawxzzy.com`

Do not guess app domains. Prefer an attached custom domain proven by provider readback;
otherwise use the stable project `.vercel.app` production origin. Omit an ungrounded CTA.

## Discovery contract

Update `src/data/discovery.ts` when a public discovery destination changes. The `/discover`
surface renders Fitness, the current Fitness-owned custom-workout offer, Discord, main TikTok,
and canonical YouTube from that single record. YouTube stays a separate destination.

The custom-workout Stripe URL is a temporary external bridge. Fitness owns the future canonical
intake route; the Fawxzzy public hub must not duplicate intake, authentication, training data, or
payment state. The replacement and Socials OS removal gates are documented in
`docs/discovery-routing.md`.

## Static export

FawxzzyWeb remains a Next.js static export. Keep routes build-time deterministic, avoid
server-only runtime behavior, and use real static compatibility pages because Next.js config
redirects are not supported with `output: "export"`.

Internal route links render through `src/components/site/static-link.tsx`. They deliberately use
native document navigation so the exported site never depends on speculative React Server
Component route-data requests that a generic static host may not expose.

## Identity and rollback

- `docs/fawxzzyweb-identity-classification.md`
- `docs/brand-and-app-origin-contract.md`
- `docs/fawxzzyweb-migration-and-rollback.md`
- `docs/fawxzzyweb-dependency-packet.md`

Frozen Wave 1 Lifeline manifests, releases, QA evidence, and preservation bundles retain
their historical Trove identifiers. They are not current product-name authority.

## Local-only files

Never commit `.vercel/`, pulled environment files, or machine-local provider linkage state.
