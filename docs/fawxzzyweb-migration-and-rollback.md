# FawxzzyWeb migration and rollback

Observed: 2026-07-16

## Preimage

| Surface | Preserved preimage |
| --- | --- |
| Local directory | `repos/trove` (must not move in this owner lane) |
| GitHub repository | `fawxzzy/trove`, public, default branch `main` |
| Draft PR | `#5`, branch `codex/path-discipline-warning-slice-trove` |
| Opening execution head | `437c7604adee02e0403d77f75162a6c5f232221f` |
| Preserved stash | `codex-preserve-before-sync-2026-05-01` |
| Vercel project | `fawxzzy-trove` |
| Vercel project ID | `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV` |
| Stable legacy alias | `https://fawxzzy-trove.vercel.app` |
| Rollback candidate | `dpl_Esx36xmewDbqKGMSuN3YMrFC6YSG` |
| Rollback source | commit `e0566a6`, recorded `gitDirty=1` |
| Environment variables | none observed |
| Git integration | none observed |
| Custom account domains | none observed |
| Tags and releases | none observed |

Local `main` was six commits ahead and one behind `origin/main` at opening and is not a migration
baseline. The active PR branch was clean, exactly pushed, mergeable, and CI-green, so this
migration reuses draft PR #5 instead of creating a duplicate.

## Application migration

1. Keep the canonical root at `/` and move the shared catalog implementation to `/apps`.
2. Keep `/trove` as a static, no-index compatibility surface backed by the same component.
3. Preserve `/apps/fitness/preview` only as a permanent redirect to the Fitness trailer; preserve all
   external Fitness/Mazer origins.
4. Normalize live package, health, metadata, manifest, and docs identity.
5. Keep the static-export constraint; use a narrowly scoped Vercel redirect only where a retired
   public route needs a stable destination.
6. Verify route truth, SEO, WCAG A/AA, mobile overflow, deep links, and compatibility through
   `npm run verify` and a provider preview.

## Application rollback

- Immediate route rollback: point the root page at the shared `CatalogExperience`; `/apps` and
  `/trove` remain unchanged.
- Commit rollback: revert the bounded migration commit on PR #5 without rewriting history.
- Provider-independent access: use the preserved deployment URL recorded in the owner receipt.
- Legacy access: retain `https://fawxzzy-trove.vercel.app`; do not remove or reassign it in this
  non-production packet.

## Provider rename rollback

GitHub rollback renames the same repository object from `FawxzzyWeb` back to `trove`, verifies
public visibility, PR #5, commit history, issues, default branch, tags/releases, redirects, and
then updates the local `origin`. It does not create another repository.

Vercel rollback renames project ID `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV` from `fawxzzyweb` back to
`fawxzzy-trove`, verifies the project ID and rollback candidate are unchanged, and preserves the
legacy alias. It does not deploy, promote, roll back production, or attach a domain.

## Production cutover and rollback

The operator supplied the exact production approval on 2026-07-16. The resulting live state is:

| Surface | Current production state |
| --- | --- |
| Reviewed merge | `16c2730a3137a437a8b191e7f12aba25e6ba6cea` |
| Vercel production | `dpl_6Z519Rjjo32HSCcZCX92DKQzYeSY` on the same project ID |
| Canonical origin | `https://fawxzzy.com` |
| Companion domain | `https://www.fawxzzy.com` redirects `308` to the apex |
| Compatibility alias | `https://fawxzzy-trove.vercel.app` serves the current production deployment |
| Preserved rollback deployment | `dpl_D3sfUyaCAmJ32M8dULx465Bty384` |
| Cloudflare DNS | `A @ 76.76.21.21` and `A www 76.76.21.21`, DNS-only, TTL Auto |

Application rollback uses Vercel's rollback operation against
`dpl_D3sfUyaCAmJ32M8dULx465Bty384` on project
`prj_vhUyajI4AL6BgCF40VnKtdxrBLuV`, then verifies the production and compatibility aliases,
all required routes, and runtime logs. It does not create a replacement project or repository.

If the incident is domain-specific rather than application-specific, first capture exact Vercel
and Cloudflare residual state. Only then remove the two owner-added DNS records and the two custom
project domains, in that order, while retaining the legacy alias and prior deployment. Do not
change nameservers, DNSSEC, SSL mode, email routing, Workers, R2, registrar settings, Fitness, or
Mazer domains during rollback.

No rollback was required during cutover because provider, DNS, TLS, route, mobile, accessibility,
console, and log proof all passed.

The previous production deployment `dpl_D3sfUyaCAmJ32M8dULx465Bty384` remains the immediate
rollback target for the trailer/discovery refresh. The older opening deployment
`dpl_Esx36xmewDbqKGMSuN3YMrFC6YSG` remains preserved as historical migration provenance.
