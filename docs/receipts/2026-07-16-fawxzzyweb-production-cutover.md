# FawxzzyWeb production cutover receipt

Observed: 2026-07-16

Terminal observation: `2026-07-16T20:38:52Z`

Status: production cutover complete and proof-green. No rollback was required.

## Authority and scope

The operator supplied the exact approval:

`Deploy FawxzzyWeb to Vercel production and connect fawxzzy.com.`

The owner lane used that authority only to merge the reviewed FawxzzyWeb implementation, deploy
the exact merge to the existing Vercel project, attach the apex and required www companion,
create the minimum Cloudflare DNS records, verify production, and publish this receipt.

## GitHub merge and verification

- Repository: `fawxzzy/FawxzzyWeb`, public, object `R_kgDOSISp-w`.
- Existing implementation PR: `https://github.com/fawxzzy/FawxzzyWeb/pull/5`.
- Reviewed PR head: `908fed4618aaf0bc869989e515ecacc410f47883`.
- Exact-head CI: run `29529505912`, successful.
- Local exact-head `npm run verify`: passed lint, production build, Lifeline smoke, and 9/9
  Playwright tests.
- Exact-head owner review receipt:
  `https://github.com/fawxzzy/FawxzzyWeb/pull/5#issuecomment-4996196922`.
- Merge commit: `bf3986b1b62e0632ae2a76cbea484eba34a7eb8a`.
- Merge-commit CI: run `29531494252`, successful.
- The reviewed head is the merge commit's second parent; `origin/main` read back at the exact merge
  before production deployment.
- No duplicate implementation PR, history rewrite, branch deletion, tag deletion, or release
  deletion occurred.

## Vercel production

- Project: `fawxzzyweb`.
- Project ID: `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV`.
- Production deployment: `dpl_D3sfUyaCAmJ32M8dULx465Bty384`.
- Deployment URL: `https://fawxzzyweb-etzhurncu-fawxzzy.vercel.app`.
- Provider state: `READY`, target `production`, source `cli`.
- Provider source metadata: exact commit
  `bf3986b1b62e0632ae2a76cbea484eba34a7eb8a` with merge-commit message.
- Current provider aliases include `https://fawxzzy-trove.vercel.app` and the automatic team
  aliases. The legacy alias is retained as a compatibility surface.
- Git integration remains `github:fawxzzy/FawxzzyWeb`, repository ID `1216653819`, production
  branch `main`, with automatic Git deployments provider-disabled.
- No environment variables were added or changed.

## Domain and DNS readback

Vercel project-domain readback:

- `fawxzzy.com`: verified, no redirect, configuration `misconfigured: false`;
- `www.fawxzzy.com`: verified, `308` redirect to `fawxzzy.com`, configuration
  `misconfigured: false`;
- `fawxzzy-trove.vercel.app`: preserved and verified.

Vercel's live CLI instructed the external DNS provider to use:

- `A fawxzzy.com 76.76.21.21`;
- `A www.fawxzzy.com 76.76.21.21`.

Cloudflare remained authoritative on `annabel.ns.cloudflare.com` and `ed.ns.cloudflare.com`.
The authenticated dashboard readback showed exactly two zone records after cutover:

| Type | Name | Value | Proxy | TTL |
| --- | --- | --- | --- | --- |
| A | `@` | `76.76.21.21` | DNS only | Auto |
| A | `www` | `76.76.21.21` | DNS only | Auto |

Both authoritative nameservers, Cloudflare public resolver `1.1.1.1`, and Google public resolver
`8.8.8.8` returned `76.76.21.21` for the apex and www hostnames. The operator workstation's
default recursive resolver retained an earlier negative apex cache during initial proof, so
public HTTPS probes pinned the independently confirmed address with `curl --resolve`; this did
not alter the request host, SNI, certificate validation, or public DNS state.

## Public production proof

Unauthenticated HTTPS requests against `fawxzzy.com` returned `200` for:

- `/`;
- `/apps`;
- `/trove`;
- `/apps/fitness/preview`;
- `/healthz.json`;
- `/manifest.webmanifest`.

Contract proof:

- `/` rendered the FawxzzyWeb root and canonical `https://fawxzzy.com`;
- `/apps` rendered centralized catalog truth, canonical `https://fawxzzy.com/apps`, and exact
  outbound origins `https://fawxzzy-fitness-local.vercel.app` and
  `https://fawxzzy-mazer.vercel.app`;
- `/trove` retained `data-compatibility-identity="trove"`, canonicalized to `/apps`, and emitted
  `noindex, follow`;
- `/apps/fitness/preview` remained directly reachable;
- `/healthz.json` returned `status: ok`, `app: fawxzzyweb`, `catalogCapability: trove`, and
  `runtime: static-export`;
- `/manifest.webmanifest` returned `name` and `short_name` `FawxzzyWeb`, `start_url: /`, and
  `display: standalone`.

Redirect and TLS proof:

- `http://fawxzzy.com/` returned `308` to `https://fawxzzy.com/`;
- `https://www.fawxzzy.com/` validated TLS and returned `308` to
  `https://fawxzzy.com/`;
- both apex and www negotiated TLS 1.3 with validated Let's Encrypt certificates for the exact
  hostname; curl reported `ssl_verify_result: 0`.

## Browser, mobile, accessibility, and logs

- A fresh browser loaded the exact production compatibility alias, rendered the root heading,
  canonical apex metadata, and expected Fitness/Mazer links with no console warning or error.
- At `390x844`, `/`, `/apps`, `/trove`, and `/apps/fitness/preview` each retained the main surface
  and had `scrollWidth <= clientWidth`.
- An unauthenticated production Playwright/Axe scan reported zero WCAG 2 A/AA violations across
  the same four routes and zero console/page errors.
- Vercel's one-hour scan for level `error` returned zero events.
- Vercel's one-hour scan for HTTP `500` returned zero events.
- The site is a static export; no drain or additional monitoring integration was created during
  this bounded cutover.

## Preserved rollback assets

- Previous production deployment: `dpl_Esx36xmewDbqKGMSuN3YMrFC6YSG`.
- Previous deployment URL: `https://fawxzzy-trove-r9frzyl0t-fawxzzy.vercel.app`.
- Pre-cutover alias mapping: `https://fawxzzy-trove.vercel.app` pointed to the previous deployment.
- Preserved stash: `codex-preserve-before-sync-2026-05-01`.
- Historical Trove docs, patches, release IDs, QA evidence, commit history, PRs, issue, and provider
  object identities remain intact.
- The rollback procedure is updated in `docs/fawxzzyweb-migration-and-rollback.md`.

## Repository publication

- Receipt base: production merge
  `bf3986b1b62e0632ae2a76cbea484eba34a7eb8a`.
- Receipt branch: `codex/fawxzzyweb-production-cutover-receipt`.
- Receipt files: this file, `docs/fawxzzyweb-dependency-packet.md`, and
  `docs/fawxzzyweb-migration-and-rollback.md`.
- Exact receipt commit, PR, CI, and merge state are reported in the enclosing pull request and
  terminal downstream messages; a commit cannot truthfully embed its own final object ID.

## Unchanged boundaries

- No Fitness or Mazer deployment, domain, repository, or product data changed.
- No Socials OS, ATLAS root, DiscordOS, Foundation, Lifeline, `_stack`, Playbook, or other owner
  repository was edited.
- No social account, LinkMe, QR, Discord, or DiscordOS state changed.
- No Cloudflare nameserver, DNSSEC, SSL mode, email routing, Worker, R2, registrar, token, or
  unrelated record changed.
- No local repository directory move occurred.
- No secret value is recorded in this receipt.

## Downstream packet

ATLAS Main, DiscordOS, Foundation, Lifeline / `_stack`, Fitness, Mazer, Playbook, and Socials OS
must consume the exact contracts in `docs/fawxzzyweb-dependency-packet.md` through their own
admitted writer lanes. This receipt is evidence, not cross-repository mutation authority.
