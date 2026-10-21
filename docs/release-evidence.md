# Portable visual and release evidence

Every pull-request and exact-main CI run produces one downloadable artifact named
`fawxzzyweb-visual-<40-character-commit>`. Reviewers do not need access to a
developer's local workspace, a Codex worktree, or a temporary folder.

Pull-request jobs explicitly check out the PR head instead of GitHub's synthetic
merge ref. Artifact paths, names, manifests, receipts, browser captures, and the
container build therefore bind to the same reviewable 40-character source commit.

## Artifact contents

- 11 governed page states, including reset-request, new-password recovery, and
  the real 404 surface, in a Windows-class desktop
  Chromium emulation at 1440×900.
- The same 11 states in a macOS-class desktop WebKit emulation at 1440×900.
- The same 11 states in an iPhone 14-class WebKit emulation at 390×844.
- The same 11 states in a Pixel 7-class Android Chromium emulation at 412×839.
- `visual-manifest.json` with the actual capture host, emulation mode, target
  class, route, family, engine, viewport, byte size, image
  dimensions, SHA-256, observed LCP/CLS, initial transfer bytes, route JavaScript,
  and pre-interaction MP4 requests for every capture.
- A labelled `contact-sheet.png` plus its standalone HTML source.
- `release-receipt.json` with exact source commit/tree and CI-run provenance.

These Playwright profiles are portable UI-design evidence. They do not claim
native Windows or macOS browser execution, native iOS Safari or Android Chrome,
physical-device behavior, platform fonts, or OS rendering certification.

The source receipt deliberately leaves review, merge, deployment, alias, smoke,
and rollback fields empty. CI evidence is not authorization to merge or deploy,
and unknown release state must not be inferred from a successful build.

## Operating contract

Run `npm run verify` first so the optimized static export exists, then run
`npm run evidence:visual`. The generator starts an isolated local static server,
fails on route errors, page/console errors, or horizontal overflow, captures with
reduced motion, fails if a trailer MP4 loads before interaction, writes evidence
under `visual-evidence/<commit>`, and terminates its server. Generated output is
ignored by Git and Docker.

Playwright WebKit 26.5 can emit one exact exception from its native modern-media-
controls implementation: `Temporal.Duration properties must be finite and of
consistent sign`. The existing WebKit suites document the same runner-only
behavior and separately verifies real trailer playback. The evidence manifest
records every occurrence under `knownRunnerExceptions`; all other page and console
errors fail the capture.

GitHub keeps the artifact for 30 days. The exact artifact URL and checksums belong
in visual-acceptance and release receipts.

The same 44-route/target matrix is protected by `npm run test:visual-regression`.
The committed baseline stores compact 32×32, eight-step quantized RGB signatures
instead of duplicating full-resolution screenshots. Verification fails on route
or target drift, width changes, height drift above three percent, mean channel
delta above four percent, or high-contrast cell drift above fifteen percent.
This deliberately tolerates small host-font and antialiasing differences while
still detecting meaningful layout, hierarchy, spacing, and palette regressions.
Updating the baseline requires the explicit `VISUAL_REGRESSION_UPDATE=1` mode
and visual review of the ordinary full-resolution evidence packet.

## Production release completion

A separately authorized production lane completes the source receipt with the
reviewed head, merge commit, Vercel deployment ID/URL, aliases, smoke result, and
preserved rollback deployment. Automation records evidence; it never grants the
deployment decision.

## Source installation and production-release freeze

The current Web release module is the pure observation validator documented in
`docs/deployment-safety.md`. It never invokes Vercel. `npm run deploy:production`,
its former dry-run, the verification CLI, and legacy rollback callbacks are
intentionally disabled before provider effects. There is no supported Web live
deploy or rollback command until a separately reviewed Ops replacement is
installed and admitted. Source installation deliberately preserves this
production-release freeze; it does not claim that the replacement is live.

Ready and merge may be evaluated as source installation only, using independent
exact-head review, current CI, merge-composite evidence, writer exclusion,
retained source rollback preimages, and fresh confirmation that neither Git
integration nor CI triggers deployment. Source installation does not update the
existing public deployment or grant any provider effect. The prior callable
legacy implementation remains Git history for governed source comparison or
revert, never an authorized production fallback.

Known Web and inspected Ops fixture consumers use the pure bridge. External or
manual consumers outside that inspected scope remain unknown and are not
claimed migrated. Before a live release, Ops must separately establish its
installed native validator/executor, trusted observations, durable recovery
journal, effect-scoped writer and provider fence, exact preimages, acceptance,
rollback/readback, and action-specific authority. Platform card/projection and
real user acceptance remain separate product gates.
