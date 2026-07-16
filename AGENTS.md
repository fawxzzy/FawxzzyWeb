# FawxzzyWeb Repo Rules

Scope
- Applies to this repo root.

Purpose
- FawxzzyWeb is the public root experience for Fawxzzy-owned applications.
- Trove remains the app-catalog capability at `/apps` and the reversible compatibility route at `/trove`.
- Fitness, Mazer, and future apps remain independently owned and deployed.

Rules
- Read the relevant App Router guidance in `node_modules/next/dist/docs/01-app/` before making framework-level changes.
- Keep app-catalog truth centralized in `src/data/apps.ts`.
- Keep current product/provider identity centralized in `src/config/product.ts`.
- Only publish live URLs grounded by local stack or provider evidence.
- Treat install behavior as content plus routing, not a synthetic browser install API.
- Use branding-pipeline outputs synced into `public/`; do not create repo-owned canonical app icons.
- Preserve historical Trove receipts, releases, patches, and rollback assets as provenance.
- Keep `.vercel/` and pulled env files local-only; do not commit machine-local Vercel linkage state.

Verification
- Run `npm run verify` before claiming completion.
