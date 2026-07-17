# Fawxzzy public brand and app-origin contract

Ratified for implementation planning: 2026-07-17

## Identity boundary

The public website, browser title, installed-web-app title, metadata, navigation, and visible copy
use `Fawxzzy`. The repository remains `FawxzzyWeb`; the package, health app ID, and Vercel project
remain `fawxzzyweb`. Historical receipts keep the names that were true when captured.

This separation prevents an infrastructure label from leaking into the customer-facing brand while
preserving repository history, provider linkage, CI, rollback evidence, and downstream identifiers.

## Catalog boundary

`fawxzzy.com/apps` is the catalog and trailer surface. It does not become the runtime origin for
independently deployed applications. Each entry in `src/data/apps.ts` owns one shared contract:

- public product name and current icon;
- current verified launch origin;
- planned canonical origin;
- origins that must remain available for compatibility or rollback;
- trailer, poster, captions, and provenance hashes.

Home, Apps, and Discover must read this contract rather than hard-code an app URL or icon.

## Planned owner-lane origins

| App | Current verified origin | Planned canonical origin |
| --- | --- | --- |
| Fitness | `https://fawxzzy-fitness-local.vercel.app` | `https://fitness.fawxzzy.com` |
| Mazer | `https://fawxzzy-mazer.vercel.app` | `https://mazer.fawxzzy.com` |

The planned origins are declarations, not proof that a domain is attached or authority to perform
a cutover. Fitness and Mazer remain separate owner lanes and deployments.

## Future cutover sequence

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
