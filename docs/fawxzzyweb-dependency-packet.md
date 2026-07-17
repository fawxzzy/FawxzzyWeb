# FawxzzyWeb downstream dependency packet

Observed: 2026-07-16

This is owner-repository evidence for downstream owners. It does not authorize edits outside
this repository.

Production cutover status: trailer/discovery redesign complete and proof-green as of
`2026-07-17T02:38:07Z`.

Canonical production contracts:

- public display brand: `Fawxzzy`; repository/provider identities remain `FawxzzyWeb` and
  `fawxzzyweb`;
- public origin: `https://fawxzzy.com`;
- canonical www behavior: `https://www.fawxzzy.com/` permanently redirects with `308` to
  `https://fawxzzy.com/`;
- GitHub: `fawxzzy/FawxzzyWeb`, current production merge commit
  `16c2730a3137a437a8b191e7f12aba25e6ba6cea`;
- Vercel: project `fawxzzyweb`, ID `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV`, production deployment
  `dpl_6Z519Rjjo32HSCcZCX92DKQzYeSY`;
- rollback deployment: `dpl_D3sfUyaCAmJ32M8dULx465Bty384`;
- compatibility alias: `https://fawxzzy-trove.vercel.app`.
- discovery route: `https://fawxzzy.com/discover`;
- Socials OS four-destination removal gate: **OPEN**, with YouTube preserved separately.

| Owner | Exact dependency | Required downstream action | Gate |
| --- | --- | --- | --- |
| ATLAS Main | GitHub `fawxzzy/FawxzzyWeb`; Vercel `fawxzzyweb`; package key `fawxzzyweb`; public origin `https://fawxzzy.com`; local path still `repos/trove` | Update registry and public-origin projections first; admit the local path move to `repos/fawxzzyweb` separately after all path consumers are enumerated | Production owner receipt, clean parity, provider readback |
| DiscordOS | Human board label `FawxzzyWeb` | Reconcile and rename through the serialized DiscordOS writer; preserve stable card history | Exact live readback before write |
| Foundation | Existing GitHub/Vercel capabilities, project ID, and Cloudflare-authoritative public origin | Update capability labels and public-origin inventory without copying tokens or changing secret handling | Foundation-owned secret and audit policy |
| Lifeline / `_stack` | Frozen Trove Wave 1 pins plus the live package/repo/origin identity | Preserve old release IDs and artifacts; add a successor manifest for `fawxzzyweb` only after the ATLAS path cutover | Manifest validation and rollback rehearsal |
| Fitness | Current catalog origin `https://fawxzzy-fitness-local.vercel.app`; planned owner-lane canonical origin `https://fitness.fawxzzy.com` | Keep the current origin until Fitness independently captures rollback, proves preview and public cutover, and supplies an exact origin-update packet | Fitness owner proof and separate production/domain authority |
| Mazer | Current catalog origin `https://fawxzzy-mazer.vercel.app`; planned owner-lane canonical origin `https://mazer.fawxzzy.com` | Keep the current origin until Mazer independently captures rollback, proves preview and public cutover, and supplies an exact origin-update packet | Mazer owner proof and separate production/domain authority |
| Playbook | Identity classification, same-object provider rename, exact-commit deploy, external-DNS cutover, and rollback pattern | Capture Rule, Pattern, Failure Mode, and rollback runbook candidates | Proof-backed production owner receipt |
| Socials OS | Production `/discover` exposes the verified Fitness app, Custom Workout Setup, Discord, main TikTok, and separate YouTube targets; four-destination removal gate is open | Remove only the four superseded LinkMe cards through the Socials OS owner lane, preserve YouTube separately, and verify the resulting public navigation | Exact FawxzzyWeb production receipt plus Socials OS-owned post-write proof |

## Reusable discoveries

Rule: provider display names, provider slugs, package keys, local paths, and human product names
are separate contracts. Record the mapping before mutation.

Pattern: preserve object identity by renaming the existing GitHub repository and Vercel project,
then verify immutable IDs, history, redirects, rollback assets, and local remotes.

Failure Mode: global search-and-replace destroys historical evidence and can turn release or
rollback identifiers into fiction. Classify each legacy identifier first.

Decision: static exports use a real compatibility page backed by the canonical component because
Next.js config redirects are unsupported under `output: "export"`.

## Production-cutover outcome

The operator supplied the exact approval:

`Deploy FawxzzyWeb to Vercel production and connect fawxzzy.com.`

The owner lane then completed the admitted production cluster without expanding scope:

1. PR #5 was exact-head reviewed, verified, and merged without a duplicate PR.
2. The exact merge commit was deployed to the existing Vercel project.
3. Vercel attached the apex and www companion; www redirects permanently to the canonical apex.
4. Cloudflare stayed authoritative and received only the two Vercel-required DNS records.
5. Provider, public-route, DNS, TLS, metadata, mobile, WCAG A/AA, console, and runtime-log proof
   passed.
6. The rollback deployment, stash, repository history, legacy alias, and historical Trove evidence
   remain preserved.

Exact evidence is in `docs/receipts/2026-07-16-fawxzzyweb-production-cutover.md`.

## Trailer and discovery production refresh

The operator later approved the proof-green trailer/discovery redesign for production. The owner
lane merged existing PR #7 at `16c2730a3137a437a8b191e7f12aba25e6ba6cea` and deployed that exact
merge to production deployment `dpl_6Z519Rjjo32HSCcZCX92DKQzYeSY` on the existing project. Public
route, TLS, canonical, desktop, mobile, WCAG A/AA, icon, trailer, destination, and runtime proof
passed without rollback.

Exact refresh evidence is in
`docs/receipts/2026-07-16-fawxzzyweb-trailer-discovery-production.md`.
