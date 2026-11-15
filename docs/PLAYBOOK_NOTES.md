This file is a project-local inbox for repo-specific Playbook notes that may later be promoted upstream.

## 2026-11-14 - Keep the Web board cards current with merged website work

- Type: Board source projection + Governance
- WHAT changed: `planning/project-board-owner-source.v1.json` gains `FW-PLAYBOOK-001` (Playbook verify on every PR, CI-only) and `FW-HANDOFF-001` (portal accepted-release list for the Fitness sign-in handoff), and `FW-PROJECTS-003` and `FW-PRESENCE-001` now describe PRs #148 and #158. The owner export and the generated owner snapshot `src/server/projects/owner-board.generated.mjs` are regenerated from that source; the owner-export tests and doc list the new card ids.
- WHY it changed: The Web board has no event pipeline, so merged website work (#148, #158, #160, #163) never reached its cards after the last board PR (#164).
- Rule: A Web PR that changes owner-facing behavior should update the Web card in the same PR; board-only PRs regenerate the export and snapshot with `npm run data:project-board-owner` and `npm run data:project-board-owner-snapshot`, never by hand.
- Scope: Source and local regression only. The owner snapshot reaches the live Projects page only after the next production build; no deployment, provider, credential or database effect.

## 2026-11-14 - Cloudflare Turnstile on the account forms, dark-safe (FW-CAPTCHA-001)

- Type: Auth hardening (client wiring only)
- WHAT changed: Sign-in, sign-up and password-reset request forms render a Turnstile widget (`src/components/account/turnstile-field.tsx`, public site key in `src/config/turnstile.ts`) and pass `options.captchaToken` to Supabase through `src/lib/auth/captcha.ts` and the browser adapter. The script loads only on the account origin, after the page settles; the widget is interaction-only (no reserved layout), is reset after every attempt, and a load failure shows one plain line while the request still goes out.
- WHY it changed: Supabase Auth CAPTCHA enforcement needs every client to already send a token. Supabase ignores `captchaToken` while CAPTCHA is disabled, so this ships safely before enforcement.
- Rule: Enable order is widget live in Web AND Fitness first, then Supabase CAPTCHA ON (owner pastes the secret in the dashboard). Rollback is switching it off in the dashboard. The repo sets no CSP header, so none was changed; add `https://challenges.cloudflare.com` to script-src, frame-src and connect-src if one is ever introduced.
- Scope: Source and local regression only; no Supabase, env, credential or deployment effect.

## 2026-11-14 - Atlas Stack board re-pin: all 36 ATLAS cards archived

- Type: Board data only
- WHAT changed: `planning/board-sources/atlas.project-board.owner-export.v1.json` and `cortex.project-board.owner-export.v1.json` are re-pinned to ATLAS `main` at `b1f39f63` (PR #236), and the generated owner snapshot `src/server/projects/owner-board.generated.mjs` is rebuilt from them.
- WHY it changed: ATLAS closed its board; every card is now in the Archived section (26 with completion records, 10 archived without a completion claim). The Fitness secret-containment and security umbrella cards are archived as deferred with reopen triggers, not completed.
- Rule: The Atlas Stack board has no event pipeline; re-pin copies the ATLAS owner exports and rebuilds the snapshot with `npm run data:project-board-owner-snapshot`, never by hand.
- Scope: Source and local regression only. The Projects page changes only after the next production build; no deployment, provider, credential or database effect.

## 2026-11-15 - Fitness board re-pin after Fitness PR #256

- Type: Board data only
- WHAT changed: `planning/board-sources/fitness.project-board.owner-export.v1.json` is re-pinned to the Fitness owner export on Fitness `main` (includes PR #256, b4e2d0a5 and later), and the generated owner snapshot `src/server/projects/owner-board.generated.mjs` is rebuilt from it.
- WHY it changed: the Web Projects snapshot lagged the Fitness owner board after #256 merged.
- Rule: Fitness re-pin copies the owner export and rebuilds the snapshot with `npm run data:project-board-owner-snapshot`, never by hand.
- Scope: Source and local regression only. The Projects page changes only after the next production build; no deployment, provider, credential or database effect.
