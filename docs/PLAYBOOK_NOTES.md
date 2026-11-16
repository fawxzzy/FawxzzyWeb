This file is a project-local inbox for repo-specific Playbook notes that may later be promoted upstream.

## 2026-11-15 - Account page: delete account (self-service, all apps)

- Type: Account portal feature (client, behind `DELETE_ACCOUNT_LIVE = false`) + proposed SQL (not applied) + pglite scratch test
- WHAT changed: `/account` gets a last, danger-style "Delete account" row (hidden until the flag is on). Password (throw-away client, fresh session kept in memory as the proof), typed username, a plain-words list of what is deleted (and that Discord feedback/moderation records stay without the account link), then `account_api.account_delete_self` deletes every Fitness, Mazer and account_private row plus `auth.users` in one transaction and the page lands on `/login?notice=deleted`.
- WHY it changed: People had no self-service way to delete their account and data in every app.
- Rule: The SQL carries a manifest of every account-owned column and a preflight catalog sweep (`UNLISTED_ACCOUNT_COLUMNS`); a new table with a user/owner/account uuid column, or a foreign key to `auth.users`, must be added to the manifest (and the scratch test) or the apply refuses. The preimage must pass the sb-query read-only keyword filter (pinned in `tests/account-delete.test.mjs`).
- Rule: A per-user delete must not trust "in the manifest" to mean "this user's rows": ON DELETE CASCADE keys between per-user tables (Fitness `exercise_stats`/`progression_events` -> `exercises`) can reach ANOTHER account's rows. Refuse at call time when any other account's row references a row being deleted, and refuse the apply when an unlisted table's key would cascade or set null.
- Rule: Password-proof honesty: a JWT `amr` check proves "a password sign-in in the last 10 minutes on a live session of this user", not "the password was typed now". Say exactly that, and make the owner dry run (refresh the session, confirm the refreshed token keeps the ORIGINAL amr timestamp) explicit before going live.
- Rule: Only count rate-limit attempts that passed re-authentication; counting `reauth` refusals lets any token of the user's (no fresh password) lock them out.
- Scope: Source and local regression only; no deployment, provider, credential or database effect. Until the owner applies the SQL and flips the flag, the row is hidden and the page is unchanged. Deleted data has no recovery except a provider backup.
## 2026-11-15 - Auth emails: one branded template with the real app icons

- Type: Edge-function source change (auth-send-email) + static assets
- WHAT changed: Every auth email renders one template: dark card with an accent glow, the app's own icon (the only image, `https://account.fawxzzy.com/email/icons/<app>-192.png`, byte-exact copies of each product's branding PNG), kicker, big light title, short copy, one pill button. Addresses are masked with the copy-matrix rule; the email-change, confirm and reset copy names the masked addresses and says links expire in 1 hour. `auth-theme.mjs` now owns `iconPath` (portal) and `emailIconPath` (email) per app, and `auth-status.tsx` reads `iconPath` from it.
- WHY it changed: Zac asked (2026-11-15) for every auth email to carry the app's real icon and the same look and plain words as the sign-in screens, with masked addresses.
- Rule: Email icon files are immutable (emails in inboxes link to them); `tests/auth-email-contract.test.mjs` pins their sha256 and checks each one visually matches the portal icon. Deploy the portal before the function so the icon URLs exist.
- Scope: Source and local regression only. The function deploy is the owner's (ask-first); no Supabase, env, DNS or deployment effect from this PR.
## 2026-11-15 - Signed-out password reset by username (design direction #9), dark

- Type: Account portal feature (client, behind `RESET_BY_USERNAME_LIVE = false`) + new Edge Function source + proposed SQL (not applied)
- WHAT changed: Signed out, the reset form asks for a username (`#account-reset-username`) and always answers `reset.sentuser`; the request goes to the new Edge Function `username-password-reset`, which counts the request (per username+client, per client, shared reset row) before resolving the username in `account_api.account_resolve_username_reset_v1`, sends the provider recovery email in the background, and pads every answer to 900 ms. The browser keeps the PKCE verifier (`src/lib/auth/recovery-pkce.ts`) so the email link uses the existing `?recovery=1&code=` landing. Test adapter adds `auth_test=reset-email-legacy|reset-throttled|reset-unavailable`; the default fixture shows the username form.
- WHY it changed: A typed email on a signed-out reset form lets anyone probe which addresses have accounts and send mail to them; a username plus one fixed answer, equal timing and pre-lookup limits removes that oracle.
- Rule: A signed-out account request must answer identically (status, body, headers, timing floor) for known, unknown, unconfirmed, banned and deleted accounts, and count rate limits before the existence lookup; pin it with a handler test plus a pglite scratch test on the real SQL. The function never returns an email or user id.
- Rule (review HOLD fixes): side effects must match too, not only the answer. Every accepted request makes exactly one provider recovery call carrying the caller's captcha token (a miss goes to the reserved undeliverable `username-reset-decoy@fawxzzy.invalid` after the same account lookup), so a replayed token cannot tell known from unknown usernames once provider CAPTCHA is on. Rate-limit addresses come only from platform-set headers (`cf-connecting-ip`, else the RIGHTMOST `x-forwarded-for` hop); the leftmost hop is caller-forgeable. Background sends log the HTTP status class only. Request bodies are read as a stream with a 4 KB cap. Failure Mode: `username-password-signin` still uses the leftmost hop (follow-up).
- Accepted trade-off pending Zac: anyone who knows a username can have the provider mail its owner from many networks (capped by the provider's 60-second per-account limit and the shared 100 per 15 minutes; each new mail replaces the earlier link), and a many-network flood can fill the shared row and pause reset by username for everyone for up to 15 minutes. Mitigation shipped: a silent per-(username, client) send cap (requests 3-5 in 15 minutes from one client go to the decoy, same answer). A per-username cap across clients was rejected because a stranger could use it to silently block the owner's reset mail.
- Scope: Source and local regression only. The live portal keeps the email form until the owner applies the SQL, deploys the function and flips the flag (order in `docs/shared-account-portal-phase1.md`). No database, provider setting, credential or deployment effect from this PR.

## 2026-11-15 - Account dock Sign out ends this device only

- Type: Account portal behaviour change (client); reverses the dock half of FF-ACCOUNT-004 W-2
- WHAT changed: The bottom "Sign out" button on `/account` now calls `adapter.signOut("this-session")` (Supabase `scope: "local"`). "Sign out everywhere" stays the only global action. A bare `adapter.signOut()` now defaults to local so a caller cannot widen the reach by accident. `/signout` was already local; its screens and the dock result make no claim about other devices.
- WHY it changed: Zac decided (2026-11-15) that the dock should end only the device in hand, so people who just want to leave a shared screen do not sign out their other devices and apps.
- Rule: Reach is named at each call site and pinned in `tests/account-signout-contract.test.mjs` and `tests/e2e/account-portal.spec.ts`. Copy for the dock must never mention other devices.
- Scope: Source and local regression only; no deployment, provider, credential or database effect. Fitness's own sign-out is still global.

## 2026-11-15 - Account portal: password-manager autofill and Sign out everywhere

- Type: Account portal feature (client)
- WHAT changed: The sign-in identifier gets `inputmode=email`; new passwords (sign-up, new password) carry `minlength` and Safari `passwordrules` from `PASSWORD_MINIMUM` through the new `AuthField` `newPasswordMinimum` prop; the new-password step renders a hidden read-only `autocomplete=username` input with the account email; the signed-in reset email is `autocomplete=username`. The account page gains a "Sign out everywhere" link: the first tap asks in the one notice box (`account.everywhereconfirm`), the action calls `adapter.signOut("everywhere")`, clears the owner hint and lands on `/login?notice=everywhere` (`signin.everywhere`); a failure shows `change.unavailable`. The test adapter adds `auth_test=signout-everywhere-fail`.
- WHY it changed: Password managers on iOS, Android and 1Password could not tell which saved login a new password belonged to or what length to generate, and people had no explicit, confirmed way to end every session after losing a device.
- Rule: Autofill attributes are pinned per screen in `tests/e2e/account-autofill.spec.ts`; a new account input updates that spec. A new username stays `autocomplete=off` so managers do not offer the old name.
- Scope: Source and local regression only; no deployment, provider, credential or database effect. The dock "Sign out" was global here; superseded 2026-11-15 (see the next entry).

## 2026-11-15 - Account page: change username and change email (design point 12)

- Type: Account portal feature (client) + proposed SQL (not applied) + edge-function source
- WHAT changed: The signed-in account rows carry a pencil button (`AuthField` `action`). Change asks for the password first (a throwaway in-memory client signs in and must return the same user id), then the new value. Username calls `account_api.account_change_username` and applies at once; email calls `updateUser({ email }, { emailRedirectTo })` and the link lands on `/auth/confirm` with `type=email_change`, which returns to `/account?notice=emaildone|emailhalf|emaillink`. Rules and failure mapping live in `src/lib/auth/account-change.ts`; new lines are copy-matrix rows. `auth-send-email/plan.mjs` sends `email_changed_notification` to the hook's `old_email`. The SQL (`supabase/proposed/20261115190000_account_change_username_v1.sql`, rollback, pglite scratch test) is a proposal only.
- WHY it changed: Users had no way to fix a username or move to a new email without support; the username path must keep the live claim guard, sign-up messages and a rate limit, which needs a definer function, not a raw metadata update.
- Rule: Every `account_api` function in a migration or proposal must `revoke ... from public` (static test in `tests/account-change.test.mjs`), because granting USAGE on `account_api` to `authenticated` would otherwise expose PUBLIC-executable functions, and per-schema default privileges cannot remove PUBLIC's default.
- Scope: Source and local regression only. Until the owner applies the SQL, Change username shows "Changes are unavailable right now."; the edge-function change needs an owner deploy; no database, provider setting, credential or deployment effect from this PR.
## 2026-11-15 - Fitness handoff allowlist for Fitness PR258-270

- Type: Release gate data
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION` now lists Fitness main `9979e22faa639d4fb60d915e4a02fefded823dc3` (PR258-270) as the newest source, keeps `3db7fe30cb397b83042950f3ef642c930a8e0b8b` (PR256-257, live) as the rollback and `d335131a8602206c5c7702ac7fd3399c26c43f35` (reviewed, never shipped), and drops the oldest `76f04dfcd66c6ebbdbbb6a65a8d516accdd6b2e3`.
- WHY it changed: Fitness main moved past `d335131a` (status screens #268, Lane C #270) before the release shipped; the portal checks `readiness.sourceCommit`, so the final release sha must be listed.
- Rule: Pin the allowlist to the final Fitness main sha at release time; re-check main moved before the portal deploy.
- Scope: Source and local regression only; no deployment, alias, provider, credential or database effect.

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

## 2026-11-15 - Email-change redirect uses an allow-listed confirm URL

- Type: Source and contract test
- WHAT changed: `accountEmailChangeUrl` in `src/config/account.ts` now returns `accountConfirmUrl(contextId)` (plain `/auth/confirm` for website; the fixed product-home `returnTo` for fitness/mazer). New `tests/supabase-redirect-allowlist.test.mjs` pins every portal redirect against `tests/fixtures/supabase-redirect-allowlist.mjs` (mirror of the live Supabase Redirect URLs list, read 2026-11-15).
- WHY it changed: Supabase matches the allow list exactly, query string included; the old `?app=<id>` form matched nothing, so the link would fall back to the Site URL. The confirm route still lands an `email_change` token on `/account?notice=...` and never follows `returnTo`.
- Known gaps pinned in the test (not fixed here): Fitness sign-up redirect carries a `state` param, and Mazer OAuth-continuation `returnTo` variants are not on the live list.
- Scope: Source and local regression only; no provider, credential, database or deploy effect.

## 2026-11-15 - Fitness board re-pin after Fitness PR #278

- Type: Board data only
- WHAT changed: `planning/board-sources/fitness.project-board.owner-export.v1.json` is re-pinned to the Fitness owner export on Fitness `main` (merge `71f06bfa`, PR #278; 42 cards, sha256 `a00ea1e44b21`), and the generated owner snapshot `src/server/projects/owner-board.generated.mjs` is rebuilt from it.
- WHY it changed: the Web Projects snapshot lagged the Fitness owner board after the board fold merged.
- Rule: Fitness re-pin copies the owner export and rebuilds the snapshot with `npm run data:project-board-owner-snapshot`, never by hand.
- Scope: Source and local regression only. The Projects page changes only after the next production build; no deployment, provider, credential or database effect.
