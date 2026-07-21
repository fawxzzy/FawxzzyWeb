# Runtime and dependency hygiene

This receipt governs the source-side runtime, dependency, CI, and baseline HTTP-header contract for FawxzzyWeb. It does not authorize or perform a deployment.

## Runtime contract

- `package.json`, GitHub Actions, and the existing Vercel project target Node.js 24.
- CI uses the current major releases of the official checkout and setup-node actions.
- Next.js and `eslint-config-next` remain version-aligned on the audited 16.2 patch line.
- `npm run verify` runs a deterministic contract check before building the application.

## Advisory disposition

The pre-change audit reported five advisories: direct Next.js and bundled PostCSS runtime advisories, a `serve-handler`/ESLint `brace-expansion` advisory, and development-only Babel and YAML advisories. Compatible dependency and transitive patches are applied through the lockfile. The result has no low, high, or critical advisories.

One moderate advisory remains classified: Next.js 16.2.11 pins its internal PostCSS dependency to 8.4.31, while the advisory requires PostCSS 8.5.10 or newer. npm exposes no compatible Next.js 16 fix and proposes an invalid Next.js 9.3.3 downgrade. This lane does not force an unproven transitive override. The residual is accepted temporarily, must remain visible in audit receipts, and should be removed when Next.js publishes a compatible patch.

`serve-handler` remains an application dependency because the repository uses it to exercise the exported production artifact. It is a local verification server and is not the Vercel request runtime.

## HTTP-header baseline

Every Vercel-served path is configured with:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), geolocation=(), microphone=()`

Vercel already supplies HSTS for production. A Content Security Policy is intentionally deferred to a dedicated Auth/media lane: Supabase connectivity, account callbacks, trailer delivery, and preview tooling need explicit source-list and browser proof before CSP can safely become enforced policy.

## Verification and release boundary

The maintenance lane must pass lint, the public Auth-key guard, the runtime-hygiene contract, an optimized build, Lifeline smoke, Chromium, and mobile WebKit. A source merge is not deployment authority. Security headers become public only after a separately authorized production release and route-aware readback.
