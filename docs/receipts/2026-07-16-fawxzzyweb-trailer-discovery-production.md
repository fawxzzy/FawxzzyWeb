# FawxzzyWeb trailer and discovery production receipt

Observed: 2026-07-16

Terminal observation: `2026-07-17T02:38:07Z`

Status: production deployment and public proof complete. No rollback was required.

## Authority and bounded scope

The operator supplied current-thread production intent for FawxzzyWeb:

`deploy to production please if the web app has been heavily cleaned up as well`

The exact redesign was already proof-green in Preview. The owner lane used this authority only to
mark the existing implementation PR ready, merge it with an expected-head guard, deploy the exact
merge to the existing Vercel project, verify the existing production domains, and publish this
receipt. No database, Auth, billing, DNS, social-account, LinkMe, Discord, or other owner-repository
mutation was included.

## GitHub merge and verification

- Repository: `fawxzzy/FawxzzyWeb`, public.
- Existing implementation PR: `https://github.com/fawxzzy/FawxzzyWeb/pull/7`.
- Reviewed PR head: `c5388471f2e268ddc68e9fc29a99fa102f1b2dc6`.
- Preview deployment: `dpl_2VxRDQuNkszUznmJivaYDW9dchjk`, `READY`, exact PR head.
- Exact-head CI: run `29537972798`, verify job `87753611804`, successful.
- Fresh exact-head `npm run verify`: lint, static production build, Lifeline smoke, and 12/12
  Playwright tests passed.
- Independent exact-head diff review: no release-blocking finding; zero GitHub review threads and
  no repository rule requiring a hosted approval.
- Merge commit: `16c2730a3137a437a8b191e7f12aba25e6ba6cea`.
- Merge-commit CI: run `29550136710`, verify job `87790739993`, successful.
- `origin/main` read back at the exact merge before deployment.
- No duplicate implementation PR, history rewrite, branch deletion, stash deletion, tag deletion,
  or release deletion occurred.

Implementation PR files:

```text
README.md
docs/discovery-routing.md
public/apps/fitness/icon.png
public/apps/fitness/trailer-captions.vtt
public/apps/fitness/trailer-poster.png
public/apps/fitness/trailer.mp4
public/apps/mazer/icon.png
public/apps/mazer/trailer-captions.vtt
public/apps/mazer/trailer-poster.png
public/apps/mazer/trailer.mp4
public/brand/fawxzzy-banner.png
public/brand/fawxzzy-wolf.png
scripts/assert-site-smoke.mjs
src/app/apps/fitness/preview/page.tsx
src/app/discover/page.tsx
src/app/globals.css
src/app/layout.tsx
src/app/not-found.tsx
src/app/page.tsx
src/components/catalog/app-section.tsx
src/components/catalog/catalog-experience.tsx
src/components/catalog/fitness-preview-board.tsx
src/components/catalog/trailer-player.tsx
src/components/discovery/discovery-grid.tsx
src/components/site/site-nav.tsx
src/components/site/static-link.tsx
src/data/apps.ts
src/data/discovery.ts
tests/e2e/fawxzzyweb.spec.ts
```

## Vercel production

- Project: `fawxzzyweb`.
- Project ID: `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV`.
- Production deployment: `dpl_6Z519Rjjo32HSCcZCX92DKQzYeSY`.
- Deployment URL: `https://fawxzzyweb-4p9hfl2ij-fawxzzy.vercel.app`.
- Provider state: `READY`, target `production`, source `cli`.
- Provider Git metadata: repository ID `1216653819`, branch `main`, exact merge
  `16c2730a3137a437a8b191e7f12aba25e6ba6cea`, verified GitHub author login `fawxzzy`.
- Provider aliases: `fawxzzy.com`, `www.fawxzzy.com`, `fawxzzy-trove.vercel.app`,
  `fawxzzyweb-fawxzzy.vercel.app`, and `fawxzzyweb-git-main-fawxzzy.vercel.app`.
- Alias assignment completed without error.
- No replacement project, environment-variable change, domain addition, or DNS mutation occurred.

## Public production proof

Unauthenticated HTTPS requests returned `200` with `ssl_verify_result: 0` for:

- `/`;
- `/apps`;
- `/discover`;
- `/trove`;
- `/apps/fitness/preview`;
- `/healthz.json`;
- `/manifest.webmanifest`.

`https://www.fawxzzy.com/` returned `308` to `https://fawxzzy.com/`. Both apex and www returned
`Strict-Transport-Security: max-age=63072000`.

Route and metadata proof:

- `/` canonicalized to `https://fawxzzy.com/` and rendered the cleaned FawxzzyWeb home.
- `/apps` canonicalized to `https://fawxzzy.com/apps`, removed the Trove hero image and nested
  preview dropdown, and rendered the centralized Fitness and Mazer catalog.
- `/discover` canonicalized to `https://fawxzzy.com/discover` and rendered all five centralized
  destinations.
- `/trove` remained a reversible compatibility surface canonicalized to `/apps`.
- `/apps/fitness/preview` remained directly reachable.
- `/healthz.json` returned `status: ok`, `app: fawxzzyweb`, `catalogCapability: trove`, and
  `runtime: static-export`.
- `/manifest.webmanifest` returned `FawxzzyWeb`, `start_url: /`, and `display: standalone`.

Media and icon proof:

- Fitness icon: `512x512`, HTTP `200`, `image/png`.
- Mazer icon: `1024x1024`, HTTP `200`, `image/png`.
- Fitness trailer: HTTP `200`, `video/mp4`, `30.058667s`, captions present, played successfully.
- Mazer trailer: HTTP `200`, `video/mp4`, `23.061333s`, captions present, played successfully.
- Shared Fawxzzy banner: HTTP `200`, `image/png`.

Discovery destination proof:

| Destination | Exact target | Result |
| --- | --- | --- |
| FawxzzyFitness App | `https://fawxzzy-fitness-local.vercel.app/` | `200` |
| Custom Workout Setup | `https://buy.stripe.com/cNi9AL4a02Qf3T4dA02cg02` | `200` |
| Discord | `https://discord.gg/tnnV7BNJ7h` | `200`, canonical invite resolved |
| Main TikTok | `https://www.tiktok.com/@fukitzzzzz` | `200` |
| YouTube | `https://www.youtube.com/@fawxzzy` | `200` |

## Browser, mobile, accessibility, and logs

- Desktop proof on `/`, `/apps`, `/discover`, `/trove`, and `/apps/fitness/preview` found no
  horizontal overflow, framework overlay, console error, page error, HTTP error, or WCAG A/AA
  violation.
- `390x844` mobile proof on `/`, `/apps`, and `/discover` found no horizontal overflow, overlay,
  console error, request failure, or WCAG A/AA violation.
- The two media requests canceled only when the verifier navigated away after successful playback;
  both files independently returned `200` and decoded/played successfully.
- Vercel's one-hour runtime-error scan returned no error cluster for the verified routes.

Local visual proof files:

- `C:\ATLAS\tmp\fawxzzyweb-production-apps-icons-loaded.png`;
- `C:\ATLAS\tmp\fawxzzyweb-production-discover-desktop.png`;
- `C:\ATLAS\tmp\fawxzzyweb-production-discover-mobile.png`.

These screenshots are local verification output and are not committed product assets.

## Preserved rollback assets

- Previous production deployment: `dpl_D3sfUyaCAmJ32M8dULx465Bty384`.
- Previous deployment URL: `https://fawxzzyweb-etzhurncu-fawxzzy.vercel.app`.
- Previous production source: merge `bf3986b1b62e0632ae2a76cbea484eba34a7eb8a`.
- Stable compatibility alias: `https://fawxzzy-trove.vercel.app`.
- Preserved stash: `codex-preserve-before-sync-2026-05-01`.
- Historical Trove receipts, releases, QA evidence, history, PRs, and provider object identities
  remain intact.
- No rollback was required.

## Socials OS removal gate

The four-destination removal gate is now **OPEN** because the exact redesign is production-live and
the public Fitness, Custom Workout Setup, Discord, and main TikTok destinations passed route,
canonical, mobile, accessibility, TLS, and runtime proof. YouTube remains a separate verified
destination. This receipt authorizes no Socials OS or LinkMe write; Socials OS must perform and
verify its own bounded removal through its owner lane.

## Repository publication

- Receipt base: production merge `16c2730a3137a437a8b191e7f12aba25e6ba6cea`.
- Receipt branch: `codex/fawxzzyweb-trailer-production-receipt`.
- Receipt files: this file, `docs/fawxzzyweb-dependency-packet.md`, and
  `docs/fawxzzyweb-migration-and-rollback.md`.
- Exact receipt commit, PR, CI, and merge state are reported by the enclosing pull request and
  downstream terminal messages; a commit cannot embed its own final object ID.

## Unchanged boundaries

- No Fitness or Mazer deployment, domain, repository, Supabase, Auth, billing, or product data
  changed.
- No Socials OS, ATLAS root, DiscordOS, Foundation, Lifeline, `_stack`, Playbook, or other owner
  repository was edited.
- No social account, LinkMe, QR, Discord, or DiscordOS state changed.
- No Cloudflare record, nameserver, DNSSEC, SSL mode, email routing, Worker, R2, registrar, token,
  or unrelated infrastructure changed.
- No local repository directory move occurred.
- No secret value is recorded in this receipt.

## Downstream packet

ATLAS Main, DiscordOS, Foundation, Lifeline / `_stack`, Fitness, Mazer, Playbook, and Socials OS
must consume the updated contracts in `docs/fawxzzyweb-dependency-packet.md` through their own
admitted writer lanes. This receipt is evidence, not cross-repository mutation authority.
