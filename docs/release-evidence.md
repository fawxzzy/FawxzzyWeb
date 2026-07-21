# Portable visual and release evidence

Every pull-request and exact-main CI run produces one downloadable artifact named
`fawxzzyweb-visual-<40-character-commit>`. Reviewers do not need access to a
developer's local workspace, a Codex worktree, or a temporary folder.

Pull-request jobs explicitly check out the PR head instead of GitHub's synthetic
merge ref. Artifact paths, names, manifests, receipts, browser captures, and the
container build therefore bind to the same reviewable 40-character source commit.

## Artifact contents

- 12 governed routes in desktop Chromium at 1440×900.
- The same 12 routes in iPhone-class WebKit at 390×844.
- `visual-manifest.json` with route, family, engine, viewport, byte size, image
  dimensions, SHA-256, observed LCP/CLS, initial transfer bytes, route JavaScript,
  and pre-interaction MP4 requests for every capture.
- A labelled `contact-sheet.png` plus its standalone HTML source.
- `release-receipt.json` with exact source commit/tree and CI-run provenance.

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
consistent sign`. The existing mobile-WebKit suite documents the same runner-only
behavior and separately verifies real trailer playback. The evidence manifest
records every occurrence under `knownRunnerExceptions`; all other page and console
errors fail the capture.

GitHub keeps the artifact for 30 days. The exact artifact URL and checksums belong
in visual-acceptance and release receipts. Pixel-perfect regression enforcement is
deferred; portable evidence and deterministic provenance land first.

## Production release completion

A separately authorized production lane completes the source receipt with the
reviewed head, merge commit, Vercel deployment ID/URL, aliases, smoke result, and
preserved rollback deployment. Automation records evidence; it never grants the
deployment decision.

Production execution uses the fail-closed wrapper documented in
`docs/deployment-safety.md`. The wrapper requires the committed team/project
identity, a clean exact-main source commit, and a successful exact-commit CI run
before it can invoke Vercel. It never links or creates a project.
