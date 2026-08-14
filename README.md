# FawxzzyWeb

FawxzzyWeb is the public app-distribution surface owned by the Socials OS program. Its active public scope is the app catalog, app detail, focused discovery, and product-account capability. TikTok is the only active external discovery destination. Retired channel and newsletter history remains repository knowledge, not active navigation or routing. The provider and package slug remains `fawxzzyweb`.

## Route contract

- `/` — canonical Fawxzzy storefront, app directory, and TikTok discovery surface
- `/apps` — canonical full app catalog sourced from `src/data/apps.ts`
- `/apps/[slug]` — canonical product detail and direct launch surface
- `/discover` — compatibility entry that renders the canonical storefront and points search engines to `/`
- `/trove` — reversible, no-index compatibility route for the former Trove identity
- `/apps/fitness/preview` — permanent redirect to the Fitness trailer
- `/login`, `/account`, `/auth/*`, `/reset-password` — product-account capability
- `/healthz.json` — static health and compatibility identity
- `/manifest.webmanifest` — Fawxzzy install metadata

The former newsletter route and custom-workout intake bridge are retired from the public product. Historical documents remain provenance only. Product-account email fields are authentication plumbing and are not a newsletter, marketing list, or discovery destination.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm run verify
```

Verification covers lint, static export, route and identity smoke checks, source and deployment guards, accessibility, responsive layout, media provenance, discovery truth, account boundaries, and compatibility rollback.

Portable UI evidence covers every governed page in Windows desktop Chromium,
macOS desktop WebKit, iPhone WebKit, and Android Chromium. Run
`npm run evidence:visual` after a successful build to create the four-target
contact sheet and individual screenshots.

## Catalog contract

Update `src/data/apps.ts` when the catalog changes. Each entry owns its current launch origin, planned canonical subdomain, rollback origins, icon, trailer, poster, captions, provenance hashes, and product copy.

Home and Discover share one storefront experience. Apps is the only full catalog. Each detail route owns the complete product explanation. This keeps navigation, product copy, media, and calls to action from being repeated across routes.

Current grounded origins:

- Fitness: `https://fawxzzy-fitness-local.vercel.app`
- Mazer: `https://fawxzzy-mazer.vercel.app`

Planned canonical origins are not live and are not authorized by this repository change:

- Fitness: `https://fitness.fawxzzy.com`
- Mazer: `https://mazer.fawxzzy.com`

Do not guess app domains or synthesize cross-origin install behavior.

## Discovery and analytics contract

Update `src/data/discovery.ts` when the canonical TikTok destination changes. `/` and its `/discover` compatibility entry render only the centralized app catalog and that exact TikTok destination. YouTube, X, Discord, Snapchat, newsletters, custom intake, support links, gaming identities, and other retired surfaces must not re-enter active navigation without a new current owner decision.

Stable `data-analytics-event` attributes define the future website measurement vocabulary for catalog views, app launches, and TikTok exits. No analytics collector or provider is installed; website analytics remain explicitly unmeasured until a separate privacy-safe implementation.

## Static export

FawxzzyWeb remains a Next.js static export. Keep routes build-time deterministic and use real static compatibility pages because Next.js config redirects are not supported with `output: "export"`.

Internal route links render through `src/components/site/static-link.tsx` so the exported site does not depend on speculative route-data requests.

## Identity, history, and rollback

Historical Trove, Discord, newsletter, LinkMe, retired-channel, release, and deployment materials remain knowledge-only provenance. They are not current product or routing authority.

- `docs/fawxzzyweb-identity-classification.md`
- `docs/brand-and-app-origin-contract.md`
- `docs/fawxzzyweb-migration-and-rollback.md`
- `docs/fawxzzyweb-dependency-packet.md`

Never commit `.vercel/`, pulled environment files, or machine-local provider linkage state.
