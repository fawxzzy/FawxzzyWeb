This file is a project-local inbox for repo-specific Playbook notes that may later be promoted upstream.

## 2026-11-16 - Delete account goes live (flag on)

- Type: Config flip + test/doc update; `DELETE_ACCOUNT_LIVE = true`
- WHAT changed: `account_api.account_delete_self` v2 was applied and dry-run proven 2026-11-16 (immediate delete, no undo; billing accounts get the support answer), so the Delete account row and confirm flow now show on `/account`. The stale v1 path comment in `src/config/account.ts` now points at the v2 file; `auth_test=delete-off` still renders the flag-off page. Rollback: set the flag to `false`.
- Rule: A flag flip PR updates the test that pins the flag and the doc line that says it is hidden in the same change, and keeps a fixture that renders the off state.

## 2026-11-16 - Delete account v2: retained allow-list, deliberate key effects, pinned triggers

- Type: Proposed SQL (not applied) + scratch test + copy line + docs; flag stays `DELETE_ACCOUNT_LIVE = false`; v1 kept, marked superseded
- WHAT changed: `20261116090000_account_delete_self_v2.sql` (same API) adds a per-column retained allow-list for archive/backup/migration tables (owner decision "Delete live data, keep archives"), deletes `mazer.mazer_register_failures`, unlinks the TEXT `discordos.discord_feedback_reports.reporter_fitness_user_id`, expects and counts the `username_signin_candidates` CASCADE and the `platform.identity_map` SET NULL, pins the four triggers that fire here by body md5 (re-checked per call), compares locked with changed rows, counts FORCE RLS in the storage check, and sets `lock_timeout = 3s` (inner) and `statement_timeout = 30s` (API wrapper). Copy: "Sign-in logs and backups may keep some data for a while."
- WHY it changed: The live read-only preimage refused v1 (37 unlisted columns, 2 FK effects, 2 DELETE triggers); review P3 notes.
- Rule: A delete-everything function needs an explicit retained list, not just a deleted list: sweep every account-shaped column (uuid FK to auth.users, uuid named like a user id, and TEXT named like `*_user_id`) and refuse the apply on anything that is neither.
- Rule: Pin triggers that run inside a privileged delete by table, name, function, `md5(prosrc)` and `tgtype`, keep the live bodies in a fixture, and re-check at call time; a later body change then stops the call instead of running unreviewed code.
- Pattern: Prove the locked-vs-changed guard in single-connection pglite by injecting the concurrent insert into a test-only copy of the function at the exact point between the locks and the deletes.
- Failure Mode: Slicing a migration to "just the function" carried its `drop trigger` along, so a refusal test passed for the wrong reason (no trigger at all); cut at the function's closing `$$;`.
- Failure Mode: The live sign-in sync function differs from the repo migration (no repo holds the live body); pin the live body and flag the drift.
- Scope: Source and local regression only; the preimage ran read-only against live; no apply, deployment, provider or credential effect.

## 2026-11-15 - Delete account follow-up: lock before the cross-account check, owner_id, honest copy

- Type: Proposed SQL change (not applied) + portal copy/failure mapping + docs; flag stays `DELETE_ACCOUNT_LIVE = false`
- WHAT changed: Before the cross-account foreign-key walk the function locks this account's rows `FOR UPDATE` in every table it deletes from; a Storage file owned through `owner` (uuid) or `owner_id` (text) refuses the call (`support`) and the apply; the preflight requires postgres to see every `storage.objects` row (USAGE, SELECT, BYPASSRLS when RLS is on) and UPDATE on the deleted tables. A 23503/23001 rollback shows the "Contact support" line, not "Try again". The success line is "Your account was deleted." and the list says sign-in security logs may keep the email. Docs: the Fitness migrations DO declare keys to `auth.users` (profiles, Discord tokens/links/reports/cases); the orphan-row caveat stays only for the workout tables.
- WHY it changed: Review of PR #192 before the SQL apply: a row inserted between the check and the delete could be cascaded away; `owner_id` was not checked; "Try again" can never succeed after a key rollback; GoTrue's `auth.audit_log_entries` keeps the email, so "its data were deleted" over-promised; the "no FK" doc statement was stale.
- Rule: A check-then-delete across rows other sessions can reference must lock the target rows `FOR UPDATE` (not `FOR SHARE`/`FOR NO KEY UPDATE`: only `FOR UPDATE` conflicts with the `FOR KEY SHARE` an FK insert takes) before the check, and the definer needs UPDATE for it. Prove it in single-connection pglite via `xmax` (one new transaction id on every target row, none on other accounts' rows).
- Rule: A security-definer check that reads an RLS table must be guaranteed to see every row (BYPASSRLS or ownership, checked in the preflight); a silently filtered read turns a refusal into a delete.
- Failure Mode: Copy that says "data were deleted" while the auth provider's audit log keeps the email; say what stays.
- Scope: Source and local regression only; no deployment, provider, credential or database effect.

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
## 2026-11-15 - Signed-out reset by username goes live (RESET_BY_USERNAME_LIVE = true)

- Type: Account portal flag flip (client); no SQL or Edge Function change
- WHAT changed: `RESET_BY_USERNAME_LIVE` is `true`. The signed-out reset form shows only the username field and the success line never reveals whether an account exists; the email form remains only in the signed-in locked view and the `auth_test=reset-email-legacy` rollback fixture.
- WHY it changed: Go-live step 7. The backend was applied and dark-verified 2026-11-15 (SQL, function v1, header, equal-answer and log proofs); Zac accepted the flood/mail-trade-off recorded in the entry below.
- Rule: Rollback is the one-line flag revert (email form returns), then delete the function and run the rollback SQL. Pinned in `tests/username-password-reset.test.mjs`.
- Scope: Source and local regression only. Deploying the portal is a separate step.

## 2026-11-15 - Signed-out password reset by username (design direction #9), dark

- Type: Account portal feature (client, now live, see the entry above) + new Edge Function source + proposed SQL (not applied)
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
## 2026-11-15 - Fitness handoff allowlist for Fitness PR267-278; Settings returnTo pinned

- Type: Release gate data + regression tests
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION` now lists Fitness main `b761e6527e72bbfe34386cfe49e49674610ccfec` (PR267-278) as the newest source, keeps `9979e22faa639d4fb60d915e4a02fefded823dc3` (PR258-270, live per `/api/app-version`) as the rollback and drops the oldest `529eb6c4b01706521bb4f1f2708c583030118fa7`. `tests/e2e/fitness-handoff.spec.ts` pins the Fitness Settings Account link (`/account?app=fitness&returnTo=https://fitness.fawxzzy.com/settings`): accepted as a return target, the signed-in Account page renders without a redirect, a sign-in handoff lands on `/entry`, and hostile variants (`//evil.com`, `/\evil`, foreign or look-alike origins, `http:`, credentials, tokens, `javascript:`, `data:`) stay closed.
- WHY it changed: Fitness PR275 sends signed-in people to the portal Account page with `returnTo=/settings`; the portal must not reject it, and the release is blocked unless the portal accepts its exact commit.
- Rule: The handoff path set (`/`, `/entry`, `/today`) is a two-sided contract with Fitness `ALLOWED_RETURN_PATHS`. Widen it on Fitness first; a portal-only change makes Fitness echo `/entry`, the echo check fails and the handoff fails closed.
- Scope: Source and local regression only; no deployment, alias, provider, credential or database effect.

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

## 2026-11-16 - Per-skin icons audited and pinned

- Type: Source and contract test
- WHAT changed: removed the unreferenced retired Fitness trident `public/apps/fitness/icon-192.png`; `tests/auth-email-contract.test.mjs` now pins the three portal icons by sha256 (Mazer M `/apps/mazer/storefront-icon.webp`, Fitness fox, Fawxzzy fox F `/app/icon-192.png`) and fails if two skins share a file or the trident returns.
- WHY it changed: Zac asked that the Mazer skin show the Mazer M, Fitness the Fitness fox, website the Fawxzzy fox F. Audit of origin/main (0681f52) and live found every skin and email icon already correct; the pin stops a regression.
- Scope: Source and local regression only; no provider, credential, database or deploy effect.


## 2026-11-16 - Fitness board re-pin after Fitness PR #281

- Type: Board data only
- WHAT changed: `planning/board-sources/fitness.project-board.owner-export.v1.json` is re-pinned to the Fitness owner export on Fitness `main` (merge of PR #281; 42 cards, sha256 `427e378cd874`), and the generated owner snapshot `src/server/projects/owner-board.generated.mjs` is rebuilt from it.
- WHY it changed: the Web Projects snapshot lagged the Fitness owner board after the release b761e652 board fold merged.
- Rule: Fitness re-pin copies the owner export and rebuilds the snapshot with `npm run data:project-board-owner-snapshot`, never by hand; a re-pin PR also needs this notes entry.
- Scope: Source and local regression only. The Projects page changes only after the next production build; no deployment, provider, credential or database effect.

## 2026-11-16 - Account screens final cross-check fixes

- Type: Copy and UI
- WHAT changed: Delete account refusals (`delete.billing`, `delete.support`, including the blocked foreign-key case) replace the red dock with a plain "Back to account" button; Sign out unavailable now says "Sign-out is unavailable right now. Try again in a minute." (new `signout.unavailable`) and its Try again is enabled (reloads the page); unavailable notices all end "Try again in a minute."; "can not" is "cannot"; the inline "Retry" action is "Try again".
- WHY it changed: a final read-only comparison of the account screens found a destructive button beside a refusal, a sign-in line on the sign-out screen with a dimmed button, and mixed wording.
- Scope: Source and local regression only; no provider, credential, database or deploy effect.

## 2026-11-16 - Fitness handoff allowlist adds 1ebbd945

- Type: Auth handoff allowlist
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION.fitnessConsumerMerges` adds Fitness main `1ebbd945312b6d48bfbb46fad28c3134767b932c`, keeps the live `b761e6527e72bbfe34386cfe49e49674610ccfec` as the rollback entry and drops the oldest `bca97957aea3b856caff87dde99ebc959cce6c43`; `docs/fitness-session-handoff.md` and `tests/e2e/fitness-handoff.spec.ts` match.
- WHY it changed: the portal checks `readiness.sourceCommit` against this list before retrieving credentials, so the next Fitness release must be listed before it deploys.
- Rule: the tuple stays 7 entries; new sha last, live sha kept as rollback, oldest dropped.
- Scope: Source and local regression only; no provider, credential, database or deploy effect.

## 2026-11-16 - Fitness handoff allowlist adds 02917bfb

- Type: Auth handoff allowlist
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION.fitnessConsumerMerges` adds Fitness main `02917bfb0612dce212d3aa55e0f338c0b0e6d57d` (PR283), keeps `1ebbd945312b6d48bfbb46fad28c3134767b932c` and `b761e6527e72bbfe34386cfe49e49674610ccfec` as rollback entries and drops the oldest `d6a625c4b78786b56564b5d29497050fa96183ae`; `docs/fitness-session-handoff.md` and `tests/e2e/fitness-handoff.spec.ts` match.
- WHY it changed: the portal checks `readiness.sourceCommit` against this list before retrieving credentials, so the next Fitness release must be listed before it deploys.
- Rule: the tuple stays 7 entries; new sha last, live sha kept as rollback, oldest dropped.
- Scope: Source and local regression only; no provider, credential, database or deploy effect.

## 2026-11-16 Re-pin the Mazer owner export snapshot (283 cards)
- WHAT changed: `planning/board-sources/mazer.project-board.owner-export.v1.json` is a byte copy of the Mazer owner export at Mazer main `38cb43f4` (283 cards, 68 archived), and `src/server/projects/owner-board.generated.mjs` is regenerated from it with `npm run data:project-board-owner-snapshot`. No hand edits.
- WHY it changed: the Projects page only updates on a Web build, and the snapshot was still the 272-card export from before the Mazer board fold (PR #637 there).
- Scope: Source and generated data only; no provider, credential, database or alias effect. Preview and snapshot tests were run by `web-repin prepare`.

## 2026-11-16 Re-pin the Fitness owner export snapshot (42 cards)
- WHAT changed: `planning/board-sources/fitness.project-board.owner-export.v1.json` is a byte copy of the Fitness owner export at Fitness main `90ba936a` (42 cards, sha256 93f3faf9dbeaae0839dcb01b66d8273d7008e9822327c530bbdf0e72530e95ad), and `src/server/projects/owner-board.generated.mjs` is regenerated from it with `npm run data:project-board-owner-snapshot`. No hand edits.
- WHY it changed: the Projects page only updates on a Web build, and the snapshot predated the Fitness board fold (PR #284 there: three design cards completed, account card text refreshed).
- Rule: re-pin by copying the export and regenerating; never hand-patch the generated file.
- Failure Mode: a re-pin without this entry fails Playbook verify.
- Scope: Source and generated data only; no provider, credential, database or alias effect.

## 2026-11-19 Re-pin the Mazer owner export snapshot (298 cards)
- WHAT changed: `planning/board-sources/mazer.project-board.owner-export.v1.json` is a byte copy of the Mazer owner export at Mazer main `f1787565` (298 cards, sha256 3cc5822c228ee45f6404a018861434c9acafd55fbd30ea92e1b6e303206768c9), and `src/server/projects/owner-board.generated.mjs` is regenerated from it with `npm run data:project-board-owner-snapshot`. No hand edits.
- WHY it changed: the Projects page only updates on a Web build, and the snapshot predated the Mazer board fold (PR #652 there: 15 new cards for PRs 638-650 and four planning cards).
- Rule: re-pin by copying the export and regenerating; never hand-patch the generated file.
- Failure Mode: a re-pin without this entry fails Playbook verify.
- Scope: Source and generated data only; no provider, credential, database or alias effect.

## 2026-11-19 - Fitness handoff allowlist adds a68b9bc8

- Type: Auth handoff allowlist
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION.fitnessConsumerMerges` adds Fitness main `a68b9bc8456a36a3b84d16279dc08e0bdfa1ab2b` (PR285-287: data export schema and settings, P2 cleanups, QA tests), keeps `02917bfb0612dce212d3aa55e0f338c0b0e6d57d` (live) as the rollback entry and drops the oldest `c48235cb31b1289faafa5b734848bf4d821ff3d1`; `docs/fitness-session-handoff.md` and `tests/e2e/fitness-handoff.spec.ts` match.
- WHY it changed: the portal checks `readiness.sourceCommit` against this list before retrieving credentials, so the next Fitness release must be listed before it deploys.
- Rule: the tuple stays 7 entries; new sha last, live sha kept as rollback, oldest dropped.
- Scope: Source and local regression only; no provider, credential, database or deploy effect.

## 2026-11-19 - Fitness handoff allowlist adds dcb1dfa8

- Type: Auth handoff allowlist
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION.fitnessConsumerMerges` adds Fitness main `dcb1dfa8edf79c05bbd7e16603c6e1a08295ed3d` (PR289: Next 15 upgrade), keeps `a68b9bc8456a36a3b84d16279dc08e0bdfa1ab2b` (live) as the rollback entry and drops the oldest `3db7fe30cb397b83042950f3ef642c930a8e0b8b`; `docs/fitness-session-handoff.md` and `tests/e2e/fitness-handoff.spec.ts` match.
- WHY it changed: the portal checks `readiness.sourceCommit` against this list before retrieving credentials, so the next Fitness release must be listed before it deploys.
- Rule: the tuple stays 7 entries; new sha last, live sha kept as rollback, oldest dropped.
- Scope: Source and local regression only; no provider, credential, database or deploy effect.

## 2026-11-19 Re-pin the Mazer owner export snapshot after the second fold (298 cards)
- WHAT changed: `planning/board-sources/mazer.project-board.owner-export.v1.json` is a byte copy of the Mazer owner export at Mazer main `e2273d0d` (298 cards, sha256 535fd67383daded7b544c0b561574d7619d267322f191d85ff4eb3c005b019f6), and `src/server/projects/owner-board.generated.mjs` is regenerated from it with `npm run data:project-board-owner-snapshot`. No hand edits.
- WHY it changed: the Mazer board fold (PR #654 there) archived 40 events and completed two cards (QA-012, DOCS-002); the Projects page only updates on a Web build.
- Rule: re-pin by copying the export and regenerating; never hand-patch the generated file.
- Failure Mode: a re-pin without this entry fails Playbook verify.
- Scope: Source and generated data only; no provider, credential, database or alias effect.

## 2026-11-19 Re-pin the Mazer owner export snapshot after the third fold (301 cards)
- WHAT changed: `planning/board-sources/mazer.project-board.owner-export.v1.json` is a byte copy of the Mazer owner export at Mazer main `355b2dea` (301 cards, sha256 4576a46cfd3bd94b99bcee42cc402f2a5f01fe70bd025db9d76767e63c377028), and `src/server/projects/owner-board.generated.mjs` is regenerated from it with `npm run data:project-board-owner-snapshot`. No hand edits.
- WHY it changed: the Mazer board fold (PR #664 there) applied 16 events (9 cards changed, 3 new, all headless-only); the Projects page only updates on a Web build.
- Rule: re-pin by copying the export and regenerating; never hand-patch the generated file.
- Scope: Source and generated data only; no provider, credential, database or alias effect.

## 2026-11-19 Re-pin the Fitness owner export snapshot after the fold (42 cards)
- WHAT changed: `planning/board-sources/fitness.project-board.owner-export.v1.json` is a byte copy of the Fitness owner export at Fitness main `fe226605` (42 cards, sha256 7711db5c9011ad18d18848f8d9e0e19900970d8f20ba2406bdc50651d26f9929) plus the regenerated `src/server/projects/owner-board.generated.mjs`.
- WHY it changed: the Fitness board fold (PR #288 there) applied 7 events (5 cards changed, FF-QA-004 now fixed); the Projects page only updates on a Web build.
- Rule: re-pin by copying the export and regenerating; never hand-patch the generated file.
- Scope: Source and generated data only; no provider, credential, database or alias effect.

## 2026-11-19 Re-pin the Mazer owner export snapshot after the fourth fold (308 cards)
- WHAT changed: `planning/board-sources/mazer.project-board.owner-export.v1.json` is a byte copy of the Mazer owner export at Mazer main `25d38987` (308 cards, sha256 552c93b2a490942f0ce13057d088388c5b5ced130d0298b2eb41bb55de188172), and `src/server/projects/owner-board.generated.mjs` is regenerated from it with `npm run data:project-board-owner-snapshot`. No hand edits.
- WHY it changed: the Mazer board fold (PR #670 there) applied 14 events (10 cards changed, 7 new, all headless-only); the Projects page only updates on a Web build.
- Rule: re-pin by copying the export and regenerating; never hand-patch the generated file.
- Failure Mode: a re-pin without this entry fails Playbook verify.
- Scope: Source and generated data only; no provider, credential, database or alias effect.

## 2026-11-20 Mazer Sign out and Reset progress hand back into Mazer (MAZER-UI-100)
- WHAT changed: on the account page in Mazer context, Sign out now returns to Mazer with `?accountAction=signed-out`, and a new Mazer-only "Reset progress" row opens `https://mazer.fawxzzy.com/?accountAction=reset-progress`. The closed key set lives in `src/config/mazer-account-actions.ts`; copy in `src/lib/auth/copy-matrix.ts`; tests in `tests/account-signout-contract.test.mjs` and `tests/e2e/account-portal.spec.ts`.
- WHY it changed: owner decision (Zac, 2026-11-19): Sign out and Reset progress live only on the account page. Mazer keeps its own session and its own progress on its origin, so the account page hands back and Mazer runs its existing local sign-out or opens its existing reset confirmation (same copy, same server reset).
- Rule: an action that must run on the product origin is launched as a closed-set query key on an allowlisted product origin; never a token, code or user id, never an auto-run destructive action (Mazer re-confirms; it honours `signed-out` only with this site as referrer).
- Scope: UI and copy only; no provider, credential, database or alias effect. Deploy before or with Mazer PR #673, which removes the rows from Mazer Settings.
## 2026-11-19 MAZER-ACCT-047: Mazer name editor on the account page
- WHAT changed: `/account` shows a "Mazer name" row for Mazer players with a pencil that opens a two-step editor (password re-check, then the new name) saving through the existing `mazer.mazer_set_username` function, with one profile ensure and one retry when the profile is missing. New `src/lib/auth/mazer-name.ts` (rules, error mapping, row visibility), adapter `readMazerName`/`saveMazerName`, copy-matrix entries, unit tests (`tests/account-mazer-name.test.mjs`) and e2e (`tests/e2e/account-mazer-name.spec.ts`).
- WHY it changed: the owner decided the Mazer leaderboard must not edit names ("this was decided awhile back"); the account site owns renames behind its security check, and until now it had no way to change the Mazer name at all.
- Rule: renames live on the account site behind the password re-check; game clients show the name read-only.
- Failure Mode: the sign-in username and the Mazer leaderboard name are two stores; Change username never changes the Mazer name.
- Scope: Source only; no SQL, provider, credential, database or alias effect. Server-side throttle and re-check for `mazer_set_username` stay owner-gated follow-ups.

## 2026-11-20 - Fitness handoff allowlist adds aa3e78be

- Type: Auth handoff allowlist
- WHAT changed: `FITNESS_HANDOFF_ACTIVATION.fitnessConsumerMerges` adds Fitness main `aa3e78be7c38cf2de192d464f9e5eefe568ebd62`, keeps `dcb1dfa8edf79c05bbd7e16603c6e1a08295ed3d` (live) as the rollback entry and drops the oldest `d335131a8602206c5c7702ac7fd3399c26c43f35`; `docs/fitness-session-handoff.md` and `tests/e2e/fitness-handoff.spec.ts` match.
- WHY it changed: the portal checks `readiness.sourceCommit` against this list before retrieving credentials, so the next Fitness release must be listed before it deploys.
- Rule: the tuple stays 7 entries; new sha last, live sha kept as rollback, oldest dropped.
- Scope: Handoff allowlist only, no behavior change; no provider, credential, database or deploy effect.

## 2026-11-20 Fitness owner board re-pin (46 cards)
- WHAT changed: `planning/board-sources/fitness.project-board.owner-export.v1.json` is a byte copy of the Fitness owner export at Fitness main `f1878b13` (46 cards, sha256 5ead6a75b794c357eca0689c0e2b28b8a54300b3de7d0759fe5f4dc2fdd6ccda), and `src/server/projects/owner-board.generated.mjs` is regenerated from it with `npm run data:project-board-owner-snapshot`. No hand edits.
- WHY it changed: the Fitness board fold (PR #297 there) applied 10 events (1 text change, 4 new review cards); the Projects page only updates on a Web build.
- Rule: re-pin by copying the export and regenerating; never hand-patch the generated file.
- Failure Mode: a re-pin without this entry fails Playbook verify.
- Scope: Source and generated data only; no provider, credential, database or alias effect.

## 2026-11-23 Mazer owner board re-pin (327 cards)
- WHAT changed: `planning/board-sources/mazer.project-board.owner-export.v1.json` is a byte copy of the Mazer owner export at Mazer main `4ebe5daf` (327 cards, sha256 e3795354ecde2aae4d3b8efb113fd927056225312600db02c7182a54efc330b7), and `src/server/projects/owner-board.generated.mjs` is regenerated from it with `npm run data:project-board-owner-snapshot`. No hand edits.
- WHY it changed: the Mazer board fold (PR #682 there) applied 32 events (19 new cards); the Projects page only updates on a Web build.
- Rule: re-pin by copying the export and regenerating; never hand-patch the generated file.
- Failure Mode: a re-pin without this entry fails Playbook verify.
- Scope: Source and generated data only; no provider, credential, database or alias effect.
