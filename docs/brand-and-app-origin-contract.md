# Fawxzzy public brand and app-origin contract

Ratified for implementation planning: 2026-07-17

## Identity boundary

The public website, browser title, installed-web-app title, metadata, navigation, and visible copy
use `Fawxzzy`. The repository remains `FawxzzyWeb`; the package, health app ID, and Vercel project
remain `fawxzzyweb`. Historical receipts keep the names that were true when captured.

This separation prevents an infrastructure label from leaking into the customer-facing brand while
preserving repository history, provider linkage, CI, rollback evidence, and downstream identifiers.

## Canonical visual assets

The July 18, 2026 Fawxzzy visual standard has two roles:

- `public/brand/fawxzzy-banner-v2.png` is the versioned horizontal public banner synchronized
  from the approved Socials OS `fawxzzy-x-header-1500x500-v2.png` derivative. The versioned URL
  prevents an older cached banner from surviving a visual-standard update.
- `public/brand/fawxzzy-wolf.png` is the square fox icon, suitable for avatars, app icon derivatives,
  and compact brand placements.

These are synchronized public outputs, not an excuse to create a second canonical icon inside an
application owner lane. The source record, output hashes, profile-rollout boundary, and trailer
provenance are documented in the associated refresh receipt. A distinct approved body photograph
remains a separate, human-led profile-image option; it is not replaced by this icon policy.

## Catalog boundary

`fawxzzy.com/apps` is the single catalog and install-guidance surface. It does not become the runtime origin for
independently deployed applications. Each entry in `src/data/apps.ts` owns one shared contract:

- public product name and current icon;
- current verified launch origin;
- planned canonical origin;
- origins that must remain available for compatibility or rollback;
- trailer, poster, captions, and provenance hashes.

Home, Apps, and Discover must read this contract rather than hard-code an app URL or icon.
The Apps launcher icons open the verified current origins directly; `/apps/fitness` and
`/apps/mazer` remain compatibility redirects rather than a second website detail step. Current
storefront artwork appears only in the selected app's `Preview` dialog. Historical detail
galleries and trailers remain provenance assets and are not rendered by the current Apps page.

Future public reviews are governed separately by `docs/public-app-reviews-contract.md`. The Apps
`Feedback` dialog reports that verified public feedback is unavailable; it must not render empty
social proof, fabricated ratings, counts, or testimonials.

## Current owner-lane origins

| App | Current branded origin | Preserved compatibility origin |
| --- | --- | --- |
| Fitness | `https://fitness.fawxzzy.com` | `https://fawxzzy-fitness-local.vercel.app` |
| Mazer | `https://mazer.fawxzzy.com` | `https://fawxzzy-mazer.vercel.app` |

The branded origins are provider-verified launch homes. The compatibility origins remain separate
owner-lane redirect and rollback surfaces; they are not active storefront destinations. Fitness and
Mazer remain independently owned and deployed.

## Completed cutover contract

Each owner lane must execute the following independently:

1. Capture the exact application commit, provider project, current production aliases, DNS
   preimage, and known-good rollback deployment.
2. Prove the candidate application on a non-production preview, including its public name, icon,
   manifest, canonical metadata, deep links, mobile layout, accessibility, and runtime logs.
3. Obtain current-thread production and domain authority for that named application.
4. Attach only the approved canonical subdomain and required redirect companion, preserving the
   existing production origin and rollback deployment.
5. Prove public DNS, TLS, redirects, canonical metadata, application routes, and provider readback.
6. Update `origin.current` in FawxzzyWeb only after the new origin is publicly verified; retain the
   previous origin in `preserveOnCutover` until its compatibility and rollback obligations end.
7. Roll back promptly to the captured deployment and origin contract if public verification fails.

No FawxzzyWeb preview or documentation change authorizes Fitness/Mazer production, DNS, data,
authentication, billing, or account mutation.

## Verification contract

A FawxzzyWeb branding change is complete only when Chromium and mobile WebKit prove:

- root title `Fawxzzy`, route titles such as `Apps | Fawxzzy`, and no visible `FawxzzyWeb` copy;
- Apple web-app and manifest names `Fawxzzy`;
- canonical URLs remain rooted at `https://fawxzzy.com`;
- app names, icons, and launch URLs come from the centralized catalog contract;
- no horizontal overflow, automated WCAG A/AA violations, console errors, or framework overlays.
