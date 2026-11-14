# FawxzzyWeb Repo Rules

Scope
- Applies to this repo root.

Purpose
- FawxzzyWeb is the public root experience for Fawxzzy-owned applications.
- Public surfaces display `Fawxzzy`; `FawxzzyWeb` and `fawxzzyweb` are repository/provider identities.
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

Playbook
- The `Playbook verify` check (job `playbook-verify` in `.github/workflows/ci.yml`) runs the Playbook repository-governance `verify` on every pull request. It is separate from `npm run verify`; both must pass.
- Run it locally: `npm run playbook:install` once (downloads the pinned Playbook release asset and checks its SHA-256 into the git-ignored `.playbook/`), then `npm run playbook:verify`. For repo orientation run `npm run playbook:index` then `npm run playbook:ai-context`. The bridge's own tests are `npm run playbook:test`.
- Nothing is installed globally and no Playbook package is added to `package.json`; `scripts/playbook-runtime.mjs` is a thin bridge that resolves and runs the pinned runtime. Never commit anything under `.playbook/`.
- The pinned version, release URL and SHA-256 live only in `scripts/playbook-runtime.mjs` (`DEFAULT_PLAYBOOK_VERSION`, `DEFAULT_OFFICIAL_FALLBACK_SHA256`). Bump them there and nowhere else (CI reads the same defaults).
