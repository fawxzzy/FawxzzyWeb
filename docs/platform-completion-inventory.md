# Platform completion inventory

Baseline: main at `a7b579b65d3abde8c523e7b253d791976b65c8f6`, tree
`e8a426cee598a02394c3f81ee77a60b4fd48c96b`, after the PR #27 production
release. This inventory prevents later lanes from rebuilding work already on main.

| Planned capability | Status | Main-branch evidence |
| --- | --- | --- |
| Runtime and Node governance | Complete | `package.json` pins Node 24; Docker and CI use Node 24; `scripts/assert-runtime-hygiene.mjs` enforces the contract. |
| Dependency advisory classification | Partial | `docs/runtime-and-dependency-hygiene.md` records the prior audit, but the action-time July 21 audit reports two high and one moderate advisory. Reclassify before system-state work. |
| GitHub Action deprecation cleanup | Complete | `.github/workflows/ci.yml` uses current checkout/setup-node/upload-artifact majors and the runtime contract tests them. |
| CSS/page-family ownership | Complete | `src/styles/foundations`, `src/styles/components`, and `src/styles/page-families` have explicit import/order ownership enforced by `scripts/assert-style-architecture.mjs`. |
| Portable visual artifacts | Complete | PR and main CI capture 12 routes in Chromium/WebKit, publish an exact-SHA artifact, checksums, manifest, and contact sheet. |
| Release provenance automation | Partial | Source receipts and portable evidence exist; production project binding and post-deploy verification were still manual before this lane. |
| SEO, robots, and sitemap | Complete | Central metadata, JSON-LD, `src/app/robots.ts`, `src/app/sitemap.ts`, and deterministic discovery tests landed in PR #27. |
| Trailer performance guards | Complete | Source binding is interaction-gated; tests prove no preinteraction MP4, independent app loading, playback, and byte ranges. |
| Utility/Auth shell | Complete | `/login`, confirm, callback, and reset routes share the utility shell and deterministic Auth state handling. |
| Account dashboard | Partial | Account/session and service-registration contracts exist, but the page is still a repeated-panel presentation rather than the planned operational dashboard. |
| System/error surfaces | Partial | A branded not-found route and Auth-specific states exist; route/global error, shared loading, and service-unavailable primitives remain. |

## Sequencing decision

1. Land the production binding guard.
2. Reconcile the newly observed dependency advisories if still present.
3. Establish shared system-state primitives.
4. Build the Account dashboard on those stable primitives.
5. Run integrated exact-main evidence and stop for separate production authority.

Home, Apps, product-detail, Discover, and Newsletter composition is outside these
lanes. Newsletter delivery, public reviews, analytics, product-domain cutovers,
MFA, device management, and cross-product data synchronization remain deferred.
