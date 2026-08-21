# FawxzzyWeb

FawxzzyWeb is the public app-distribution surface owned by the Socials OS program. Its active public scope is the app catalog, focused discovery, and product-account capability. TikTok is the only active external discovery destination. Retired channel and newsletter history remains repository knowledge, not active navigation or routing. The provider and package slug remains `fawxzzyweb`.

## Route contract

- `/` — canonical Fawxzzy storefront, app directory, and TikTok discovery surface
- `/apps` — canonical full app catalog, installation guide, and direct app-launch surface sourced from `src/data/apps.ts`
- `/discover` — permanent provider redirect to `/` with a lightweight no-index static fallback
- `/trove` — temporary provider redirect to `/apps` with a reversible no-index static fallback
- `/apps/fitness`, `/apps/fitness/preview`, `/apps/mazer` — permanent compatibility redirects to the branded app origins
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

Portable UI evidence covers every governed page with four Playwright target
profiles: Windows-class desktop Chromium, macOS-class desktop WebKit, iPhone
14-class WebKit, and Pixel 7-class Android Chromium. These are browser/device
emulations on the actual capture host, not native OS or physical-device
certification. Run `npm run evidence:visual` after a successful build to create
the four-target contact sheet, manifest, and individual screenshots.

## Catalog contract

Update `src/data/apps.ts` when the catalog changes. Each entry owns its current launch origin, planned canonical subdomain, rollback origins, active storefront icon and preview, provenance hashes, and product copy.

Home is the concise discovery storefront. Apps is the single installation and app-launch surface. Both use the same product identity and responsive-media contract. On Apps, each phone-style icon and its primary `Open` control launch the independently owned branded app origin without an intermediate detail page; `Preview` and the truthful `Feedback` state remain separate secondary actions in that order.

The storefront uses compact WebP derivatives of current product evidence. Rebuild a derivative only from its declared canonical source and update the centralized derivative hash in `src/data/apps.ts`. Historical detail images and trailers remain repository provenance only; they are not active route media. Never publish a whole internal visual-reference catalog as route media.

Current branded origins:

- Fitness: `https://fitness.fawxzzy.com`
- Mazer: `https://mazer.fawxzzy.com`

Legacy compatibility origins remain redirect and rollback entrypoints only:

- Fitness: `https://fawxzzy-fitness-local.vercel.app`
- Mazer: `https://fawxzzy-mazer.vercel.app`

Do not guess app domains or synthesize cross-origin install behavior.

## Discovery and analytics contract

Update `src/data/discovery.ts` when the canonical TikTok destination changes. `/` renders the centralized app shelf and that exact TikTok destination; `/discover` is routing compatibility only. YouTube, X, Discord, Snapchat, newsletters, custom intake, support links, gaming identities, and other retired surfaces must not re-enter active navigation without a new current owner decision.

Stable `data-analytics-event` attributes define the future website measurement vocabulary for catalog views, app launches, and TikTok exits. No analytics collector or provider is installed; website analytics remain explicitly unmeasured until a separate privacy-safe implementation.

## Static export

FawxzzyWeb remains a Next.js static export. Keep routes build-time deterministic. Vercel owns explicit compatibility redirects: `/discover` and the retired app-detail paths are permanent, while `/trove` stays temporary so the compatibility handoff remains reversible. Real static fallback pages exist only for `/discover` and `/trove` because Next.js config redirects are not supported with `output: "export"`. The retired `/apps/fitness`, `/apps/fitness/preview`, and `/apps/mazer` paths are provider-only redirects; local and non-Vercel static hosts intentionally return 404 for them.

Internal route links render through `src/components/site/static-link.tsx` so the exported site does not depend on speculative route-data requests.

## Identity, history, and rollback

Historical Trove, Discord, newsletter, LinkMe, retired-channel, release, and deployment materials remain knowledge-only provenance. They are not current product or routing authority.

- `docs/fawxzzyweb-identity-classification.md`
- `docs/brand-and-app-origin-contract.md`
- `docs/fawxzzyweb-migration-and-rollback.md`
- `docs/fawxzzyweb-dependency-packet.md`

Never commit `.vercel/`, pulled environment files, or machine-local provider linkage state.
