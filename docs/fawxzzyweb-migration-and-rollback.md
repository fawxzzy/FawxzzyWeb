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
3. Preserve `/apps/fitness/preview` and all external Fitness/Mazer origins.
4. Normalize live package, health, metadata, manifest, and docs identity.
5. Keep the static-export constraint; do not introduce unsupported config redirects.
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

## Production boundary

No production deployment, promotion, rollback, alias cutover, domain attachment, DNS mutation,
or local directory move is authorized. The future approval string is exactly:

`Deploy FawxzzyWeb to Vercel production and connect fawxzzy.com.`
