## 2026-11-15 - Mazer OAuth: no consent card for first-party, stopped requests go back to the app

- Type: Decision + Rule
- WHAT changed: `/oauth/authorize` no longer has a third-party consent path; a request that is not Mazer's exact client, redirect URI and scope stops on the portal fallback screen (`data-auth-state="unsafe"`), with no approval call and no redirect. Invalid, expired or other-account requests go back to the constant `https://mazer.fawxzzy.com/?notice=expired`, service failures to `?notice=unavailable` (`mazerSignInNoticeUrl`). An existing portal session authorizes silently. New threat model: `docs/mazer-oauth-threat-model.md`.
- WHY it changed: plan design points 8 (consent removed for our own apps; back to the app's sign-in with a notice; portal fallback only when the redirect is unsafe) and 11 (device-level auto sign-in).
- Rule: a stopped authorization may only send the player to a constant destination with a key from a closed set; never follow `redirect_uri`, `returnTo` or any request value, and never let a notice look like an OAuth callback (`code`/`state`/`error`).
- Failure Mode: Mazer treats an `error` callback with no `state` as "came back to a different screen", so reusing `error=` for a portal notice would show the wrong reason. A separate `notice` key that Mazer ignores today degrades to its plain sign-in.
- Decision: PKCE stays enforced by Supabase (the portal never sees the challenge); the portal's job is exact client/redirect/scope identity plus the exact code/state redirect check, in both the gateway and the browser.
- Evidence: `tests/e2e/mazer-oauth-first-party-security.spec.ts`, `tests/e2e/mazer-oauth-first-party-auto-approve.spec.ts`, updated OAuth tests in `tests/e2e/account-portal.spec.ts`, `test:account-signout`; `npm run verify`.
- Status: in review; needs the independent security review before merge.
