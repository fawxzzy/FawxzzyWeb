# FawxzzyWeb

FawxzzyWeb is the public home for Fawxzzy apps, product updates, and grounded links to
independently owned experiences. It preserves the source history of Trove while moving the
app catalog to its canonical `/apps` route.

## Route contract

- `/` — canonical FawxzzyWeb root experience
- `/apps` — canonical app catalog, sourced from `src/data/apps.ts`
- `/trove` — reversible, no-index compatibility route for the former Trove identity
- `/apps/fitness/preview` — preserved deep link for the Fitness reference board
- `/healthz.json` — static health and compatibility identity
- `/manifest.webmanifest` — FawxzzyWeb install metadata

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
Playwright checks for metadata, catalog truth, accessibility, mobile overflow, deep links,
and compatibility rollback.

## Catalog contract

Update `src/data/apps.ts` when the catalog changes. Each entry owns its grounded `liveUrl`,
optional install URL, asset provenance, screenshots, copy, and tags.

Current grounded origins:

- Fitness: `https://fawxzzy-fitness-local.vercel.app`
- Mazer: `https://fawxzzy-mazer.vercel.app`

Do not guess app domains. Prefer an attached custom domain proven by provider readback;
otherwise use the stable project `.vercel.app` production origin. Omit an ungrounded CTA.

## Static export

FawxzzyWeb remains a Next.js static export. Keep routes build-time deterministic, avoid
server-only runtime behavior, and use real static compatibility pages because Next.js config
redirects are not supported with `output: "export"`.

## Identity and rollback

- `docs/fawxzzyweb-identity-classification.md`
- `docs/fawxzzyweb-migration-and-rollback.md`
- `docs/fawxzzyweb-dependency-packet.md`

Frozen Wave 1 Lifeline manifests, releases, QA evidence, and preservation bundles retain
their historical Trove identifiers. They are not current product-name authority.

## Local-only files

Never commit `.vercel/`, pulled environment files, or machine-local provider linkage state.
