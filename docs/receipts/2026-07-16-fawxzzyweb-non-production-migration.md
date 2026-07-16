# FawxzzyWeb non-production migration receipt

Observed: 2026-07-16

Status: owner implementation and provider identity migration complete; draft PR remains unmerged;
production cutover is not authorized.

## Identity readback

| Surface | Preimage | Postimage | Identity proof |
| --- | --- | --- | --- |
| Local directory | `repos/trove` | unchanged | ATLAS Main owns any later path move |
| GitHub | `fawxzzy/trove` | `fawxzzy/FawxzzyWeb` | same repository object `R_kgDOSISp-w` |
| GitHub visibility | public | public | provider readback |
| GitHub default branch | `main` | `main` | provider readback |
| Draft PR | `#5` | `#5` | same PR object `PR_kwDOSISp-87jF2Gw` |
| Preserved issue | `#1` | `#1` | same issue object `I_kwDOSISp-88AAAABAKOQIw` |
| Vercel project | `fawxzzy-trove` | `fawxzzyweb` | same project ID `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV` |
| Vercel Git link | none | `github:fawxzzy/FawxzzyWeb` | repo ID `1216653819`, production branch `main` |
| Package | `fawxzzy-trove` | `fawxzzyweb` | package manifest and lockfile |

Git deployment creation remains provider-disabled. Connecting Git did not create a production
deployment.

## Commits and pull request

- Opening baseline: `437c7604adee02e0403d77f75162a6c5f232221f`.
- Implementation commit: `176f2225da3718b47c03290ac37a7776a43f0749`.
- Pull request: `https://github.com/fawxzzy/FawxzzyWeb/pull/5`.
- Branch: `codex/path-discipline-warning-slice-trove`.
- PR state at implementation proof: draft, mergeable/clean, exact head pushed.
- Human GitHub review decision: none available; no approval is claimed.

## Changed files

Application and route contract:

- `src/app/page.tsx`
- `src/app/apps/page.tsx`
- `src/app/trove/page.tsx`
- `src/app/apps/fitness/preview/page.tsx`
- `src/app/layout.tsx`
- `src/app/manifest.ts`
- `src/app/healthz.json/route.ts`
- `src/app/not-found.tsx`
- `src/app/globals.css`
- `src/components/catalog/catalog-experience.tsx`
- `src/config/product.ts`
- `src/data/apps.ts`
- `src/data/fitness-preview-board.ts`

Verification and automation:

- `tests/e2e/fawxzzyweb.spec.ts`
- `playwright.config.ts`
- `scripts/assert-site-smoke.mjs`
- `scripts/assert-home-smoke.mjs` (removed)
- `scripts/qa-home-smoke.mjs`
- `scripts/smoke-lifeline.mjs`
- `scripts/start-static.mjs`
- `.github/workflows/ci.yml`
- `.gitignore`
- `package.json`
- `package-lock.json`

Governance and documentation:

- `AGENTS.md`
- `README.md`
- `docs/qa.md`
- `docs/fawxzzyweb-identity-classification.md`
- `docs/fawxzzyweb-migration-and-rollback.md`
- `docs/fawxzzyweb-dependency-packet.md`
- this receipt

## Verification

- Local `npm run verify`: passed.
- Static export: seven product routes plus the not-found surface generated successfully.
- Playwright: 9/9 passed, including route identity, app-catalog truth, compatibility canonical,
  deep link, four WCAG A/AA scans, and 390-by-844 mobile overflow/navigation.
- GitHub Actions run `29528509442`: passed on implementation commit `176f222`.
- GitHub review decision: absent; no reviewer approval is claimed.
- GitHub old and new repository URLs resolve to the same `main` head.

Separate production-dependency audit:

- `npm audit --omit=dev`: reports one high Next.js advisory group and one moderate PostCSS
  advisory. The suggested fix is a forced Next.js 16.2.10 update outside the pinned 16.2.4
  range. It is recorded as follow-up risk, not silently folded into this migration.
- GitHub CI emits a Node 20 deprecation annotation for `actions/checkout@v4` and
  `actions/setup-node@v4`; the job passes under the runner's forced Node 24 action runtime.

## Preview proof

Pre-rename preview:

- Deployment: `dpl_Bm5KK91ZfEN5F932j7HB3Ejczmfq`.
- URL: `https://fawxzzy-trove-h7orzi52c-fawxzzy.vercel.app`.
- Target/status: preview / READY.
- Browser proof: desktop and 390-by-844 root/catalog screenshots, `/trove`, Fitness deep link,
  expected app origins, no error overlay, no console warnings/errors, and no horizontal overflow.

Post-rename preview:

- Deployment: `dpl_2U8V35dunsF6gWEnWfnvukgmLjAh`.
- URL: `https://fawxzzyweb-cfnxalfof-fawxzzy.vercel.app`.
- Target/status: preview / READY.
- Project: `fawxzzyweb`, ID `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV`.
- Source metadata: commit `176f2225da3718b47c03290ac37a7776a43f0749`, repo
  `fawxzzy/FawxzzyWeb`.
- Authenticated route proof: `/`, `/apps`, `/trove`, `/apps/fitness/preview`, both app origins,
  `/healthz.json`, and `/manifest.webmanifest` match the migration contract.
- Unauthenticated access redirects to Vercel SSO because preview protection is enabled. This is
  access policy, not an application failure.

## Preserved rollback assets

- Preserved stash: `codex-preserve-before-sync-2026-05-01`.
- GitHub old URL redirect: `https://github.com/fawxzzy/trove` resolves to the renamed object.
- Production rollback candidate: `dpl_Esx36xmewDbqKGMSuN3YMrFC6YSG`.
- Legacy stable alias: `https://fawxzzy-trove.vercel.app` still resolves to that production
  deployment.
- No `fawxzzyweb.vercel.app` production alias was created.
- Frozen Wave 1 manifests, release IDs, preserved patches, historical docs, tags, and releases
  were not rewritten or deleted. No tags or releases were present at preflight.

## Unchanged boundaries

- No Vercel production deployment, promotion, rollback, or production alias cutover.
- No `fawxzzy.com`, Fitness, or Mazer domain attachment.
- No Cloudflare, DNS, DNSSEC, email, Worker, R2, or registrar mutation.
- No Discord/DiscordOS mutation.
- No ATLAS-root, Socials OS, Fitness, Mazer, Foundation, Lifeline, `_stack`, or Playbook edit.
- No local repository directory move.
- No stash, history, tag, release, issue, PR, or compatibility-surface deletion.
- No credential value is recorded in committed artifacts.

## Residual blockers and next packet

- PR #5 remains draft and unmerged; local/remote branch parity must remain clean through review.
- The local directory remains `repos/trove` until ATLAS Main admits the registry/path cutover.
- Preview protection requires an authenticated or authorized preview session.
- Dependency advisories and the GitHub Actions Node-runtime annotation require bounded follow-up.
- `fawxzzy.com` remains unattached and production approval is absent.

The exact production-cutover packet is defined in `docs/fawxzzyweb-dependency-packet.md`. The
future approval string is exactly:

`Deploy FawxzzyWeb to Vercel production and connect fawxzzy.com.`
