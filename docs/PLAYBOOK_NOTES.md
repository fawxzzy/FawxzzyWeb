This file is a project-local inbox for repo-specific Playbook notes that may later be promoted upstream.

## 2026-11-15 - Account page: change username and change email (design point 12)

- Type: Account portal feature (client) + proposed SQL (not applied) + edge-function source
- WHAT changed: The signed-in account rows carry a pencil button (`AuthField` `action`). Change asks for the password first (a throwaway in-memory client signs in and must return the same user id), then the new value. Username calls `account_api.account_change_username` and applies at once; email calls `updateUser({ email }, { emailRedirectTo })` and the link lands on `/auth/confirm` with `type=email_change`, which returns to `/account?notice=emaildone|emailhalf|emaillink`. Rules and failure mapping live in `src/lib/auth/account-change.ts`; new lines are copy-matrix rows. `auth-send-email/plan.mjs` sends `email_changed_notification` to the hook's `old_email`. The SQL (`supabase/proposed/20261115190000_account_change_username_v1.sql`, rollback, pglite scratch test) is a proposal only.
- WHY it changed: Users had no way to fix a username or move to a new email without support; the username path must keep the live claim guard, sign-up messages and a rate limit, which needs a definer function, not a raw metadata update.
- Rule: Every `account_api` function in a migration or proposal must `revoke ... from public` (static test in `tests/account-change.test.mjs`), because granting USAGE on `account_api` to `authenticated` would otherwise expose PUBLIC-executable functions, and per-schema default privileges cannot remove PUBLIC's default.
- Scope: Source and local regression only. Until the owner applies the SQL, Change username shows "Changes are unavailable right now."; the edge-function change needs an owner deploy; no database, provider setting, credential or deployment effect from this PR.

## 2026-11-15 - Fitness handoff allowlist for Fitness PR258-266

- Type: Release gate data
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION` in `src/lib/auth/fitness-handoff.ts` now lists Fitness main `d335131a8602206c5c7702ac7fd3399c26c43f35` (PR258-266) as the newest source, keeps `3db7fe30cb397b83042950f3ef642c930a8e0b8b` (PR256-257) as the rollback and drops the oldest `2a47cd4b6b1bfb70d6d2b5b913e9f917acc4716e`.
- WHY it changed: The portal checks `readiness.sourceCommit` before retrieving credentials, so the Fitness release carrying the sign-out session revocation (#263) is blocked unless the portal already accepts its exact commit.
- Rule: Add the new final Fitness main sha before the Fitness production cutover, keep the live sha as rollback, drop the oldest of the seven.
- Scope: Source and local regression only; no deployment, alias, provider, credential or database effect.

## 2026-11-15 - Fitness handoff allowlist for Fitness PR256-257

- Type: Release gate data
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION` in `src/lib/auth/fitness-handoff.ts` now lists Fitness main `3db7fe30cb397b83042950f3ef642c930a8e0b8b` (PR256-257) as the newest source, keeps live `c48235cb31b1289faafa5b734848bf4d821ff3d1` as the rollback and drops the oldest `06db3f234ee0b90c00b32507351fe1d902661bdf`; the handoff doc and e2e spec match.
- WHY it changed: The portal checks `readiness.sourceCommit` before retrieving credentials, so the next Fitness release is blocked unless the portal already accepts its exact commit.
- Rule: Add the new final Fitness main sha before the Fitness production cutover, keep the live sha as rollback, drop the oldest of the seven.
- Scope: Source and local regression only; no deployment, alias, provider, credential or database effect.

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

## 2026-11-15 - Mazer board re-pin after Mazer PR #596

- Type: Board data only
- WHAT changed: `planning/board-sources/mazer.project-board.owner-export.v1.json` is re-pinned to the Mazer owner export on Mazer `main` (merge `1e42c375`, PR #596; 272 cards, sha256 `6826ec16d277`), and the generated owner snapshot `src/server/projects/owner-board.generated.mjs` is rebuilt from it.
- WHY it changed: the Web Projects snapshot lagged the Mazer owner board after the board fold merged.
- Rule: Mazer re-pin copies the owner export and rebuilds the snapshot with `npm run data:project-board-owner-snapshot`, never by hand.
- Scope: Source and local regression only. The Projects page changes only after the next production build; no deployment, provider, credential or database effect.
