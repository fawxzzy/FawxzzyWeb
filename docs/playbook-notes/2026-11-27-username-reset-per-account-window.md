## 2026-11-27 - Per-account 60 s send window for username password reset

- Type: Decision + Failure Mode fix (source only; SQL is proposed and owner-gated)
- WHAT changed: new proposed SQL `supabase/proposed/20261126190000_account_username_reset_v2.sql` (+ rollback, read-only preimage, pglite scratch test) adds `account_api.account_resolve_username_reset_v2`, a per-account 60 s send window in the existing `account_private.username_signin_attempts` table. The Edge Function handler calls v2 and answers 429 `{"code":"reset_wait"}` (Retry-After 1-60) with no provider call; the account portal maps it to the existing `reset.wait` notice and starts the resend countdown. Test adapter adds `auth_test=reset-username-wait`.
- WHY it changed: the provider refuses a second recovery email inside one minute per account, silently. The only guard was client-side localStorage, so a repeat from a different browser said "sent" with no mail.
- Rule: a server guard that mirrors a provider limit must answer from server state, keyed by hash of the account (or the name when unknown), and be identical for known and unknown usernames. A turned-away request neither extends the window nor spends the send cap.
- Failure Mode: relying on a client-only throttle for a limit the server and provider enforce.
- Decision: additive v2 (v1 untouched) so apply-then-deploy and rollback-then-redeploy are each safe in order; waits are not counted in the pair counter.
- Evidence: `tests/username-password-reset.test.mjs`, `tests/e2e/account-reset-anybrowser.spec.ts`, scratch test `supabase/proposed/account_username_reset_v2.scratch-test.mjs` (75 checks pass), preimage JSON saved next to the SQL.
- Status: source only. SQL not applied and function not deployed; apply the SQL (by sha256), then deploy the function.
