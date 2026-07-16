# Trove Lifeline Wave 1 Pilot

This repo carries the Trove-side contract for the Wave 1 pilot cutover. The goal is to keep Trove app-local while matching the pinned Lifeline runtime and deploy surfaces without pulling platform logic into the app.
The source manifest still carries `repo` plus `branch: main` because the Lifeline app-manifest contract requires them, but Wave 1 deploy truth now lives in artifact and release fields instead of branch-shaped deploy assumptions.

## Build and runtime path

- Source manifest: `.lifeline/trove.lifeline.yml`
- Deploy manifest: `.lifeline/wave1-deploy.manifest.json`
- Static build output: `out/`
- Local runtime command: `npm run start`
- Lifeline health path: `/healthz.json`

The app remains a static-export Next.js surface. `npm run build` emits the export, and `serve` hosts the built `out/` directory on port `3000`.
The checked-in runtime entrypoint is `node scripts/start-static.mjs --port 3000`, which fails closed if the pinned port is unavailable instead of silently rebinding.

## Container path

Use the checked-in `Dockerfile` to build a pilot image that matches the app-local static export runtime:

```bash
docker build -t fawxzzy-trove:wave1-main-da6fe2a .
docker run --rm -p 3000:3000 fawxzzy-trove:wave1-main-da6fe2a
```

The container does not depend on Vercel-specific runtime behavior. It serves the static export directly.

## Environment mapping

Wave 1 keeps Trove environment-light on purpose.

- Lifeline deploy contract `envRefs`: `[]`
- Required app env keys: none
- Container runtime env:
  - `PORT` optional, defaults to `3000`

No Vercel runtime env is required for the pilot path.

## Health and smokeability

- Static health endpoint: `/healthz.json`
- Repo-local smoke command: `npm run smoke:lifeline`
- Repo-local verify command: `npm run verify`

`npm run smoke:lifeline` serves the exported `out/` directory through the checked-in static server, confirms `/` renders the Trove shell, validates `/healthz.json`, and checks that `manifest.webmanifest` remains reachable.

## Deploy against pinned Lifeline floors

Run Trove against the pinned Lifeline runtime from the Lifeline repo:

```bash
pnpm lifeline up repos/fawxzzy-trove/.lifeline/trove.lifeline.yml
pnpm lifeline status trove
pnpm lifeline logs trove 20
```

The deploy manifest is shaped for the pinned `atlas.lifeline.deploy-contract.v1` contract and keeps rollback metadata explicit.
For Wave 1 planning on Lifeline `main`, the canonical deploy target is `artifactRef: docker://fawxzzy-trove:wave1-main-da6fe2a`, which deterministically yields release id `release-trove-884871743d515964`.
The rollback target is the concrete prior release `release-trove-91140e3b6fdb0cfb` backed by `artifactRef: docker://fawxzzy-trove:pre-w4-a9c347b`.

## Parity checklist

- Catalog remains one-page and static-export compatible.
- Grounded live URLs and app-owned install actions are unchanged.
- PWA manifest and public assets remain intact.
- Health is explicit and machine-checkable at `/healthz.json`.
- Local build and runtime do not require Vercel hosting features.
- Lifeline can start, inspect, and stop Trove through the app-local manifest.

## Rollback rehearsal

Rollback for the pilot is intentionally narrow:

```bash
pnpm lifeline down trove
pnpm lifeline status trove
```

Rehearsal is complete when status reports the app stopped cleanly after the managed runtime was healthy. The deploy manifest rollback target points at release `release-trove-91140e3b6fdb0cfb` and artifact `docker://fawxzzy-trove:pre-w4-a9c347b`.
