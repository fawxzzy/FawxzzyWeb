# FawxzzyWeb architecture

Short map of the repository. Details live in the linked docs; this file only points at them.

## Identity

- Public brand is `Fawxzzy`; the repository, package and Vercel project are `fawxzzyweb`. Canonical identity is `src/config/product.ts`. See `docs/brand-and-app-origin-contract.md`.
- Stack: Next.js App Router, TypeScript, Supabase (`@supabase/supabase-js`), deployed on Vercel.

## Layout

- `src/app`: App Router routes (`apps`, `account`, `auth`, `login`, `reset-password`, `oauth`, `projects`, `operations`, `legal`, `privacy`, `terms`, plus `discover` and `trove` compatibility routes).
- `src/components`: UI components, grouped by area (account, catalog, operations, analytics, and others).
- `src/config`, `src/data`: product, account and legal configuration; the apps catalog (`src/data/apps.ts`).
- `src/lib`: shared client and server-safe helpers (`auth`, `account`, `analytics`, `presence`, `projects`, `operations`).
- `src/server`: server-only modules (`projects`, `operations`).
- `api/`: Vercel function entry points (`account`, `operations`, `projects`).
- `supabase/`: `config.toml`, `migrations`, `functions`, `tests`.
- `planning/`, `exports/`: board sources and the owner export (see Projects board).
- `scripts/`, `tests/`: build, QA and contract scripts and their tests; `npm run` entries are in `package.json`.

## Deploy and hosts

- Hosting is Vercel. `vercel.json` sets `git.deploymentEnabled: false` (no git-triggered deploys), security headers, the `/signout/ping` rewrite and the route redirects (`/` to `/apps`, `/apps/fitness` to the Fitness origin, `/apps/mazer` to the Mazer origin).
- The account surface runs on its own host, `account.fawxzzy.com`; `https://fitness.fawxzzy.com` and `https://mazer.fawxzzy.com` are separate product origins. See `docs/shared-account-portal-phase1.md` and `docs/auth-surface-family.md`.
- Production deploy and rollback rules: `docs/deployment-safety.md`, `docs/release-evidence.md`, `docs/fawxzzyweb-migration-and-rollback.md`.

## Auth surface

- The account host owns sign-in, sign-up, password reset, the email confirm and PKCE callback routes, and `/oauth/authorize`, which approves the first-party Mazer client without a consent card (threat model: `docs/mazer-oauth-threat-model.md`). Shared auth helpers are in `src/lib/auth`; bot-check logic is `src/lib/auth/captcha.ts`.
- Contracts: `docs/auth-surface-family.md`, `docs/shared-account-portal-phase1.md`, `docs/runbooks/auth-email-hook.md`.

## Projects board (owner-only)

- `/projects` is the owner-only board; `/operations` redirects to it. Owner access is checked server-side (`api/projects/access.ts`, `src/server/projects/owner-projects-http.mjs`).
- Board data comes from `planning/project-board-owner-source.v1.json` (Web cards) and `planning/board-sources/*.project-board.owner-export.v1.json` (other projects), exported by `scripts/export-project-board-owner.mjs` to `exports/` and pinned into `src/data` / `src/server/projects` snapshots by `scripts/build-project-board-owner-snapshot.mjs`.
- The board is a milestone snapshot, not a live feed. See `docs/project-board-adapter.md` and `docs/project-board-owner-export.md`.

## Operations ingestion

- `api/operations/*`, `src/server/operations` and `src/lib/operations` hold the private operations reader and ingest path; they currently have no UI. See `docs/private-operations-reader.md` and `docs/private-operations-ingestion.md`.

## Quality gates

- CI and local gates: `docs/qa.md`, `docs/test-contract-matrix.md`.
- Playbook governance: `npm run playbook:verify`; a change under `src/**` needs an entry in `docs/PLAYBOOK_NOTES.md`.
- Agent rules: `AGENTS.md`.
