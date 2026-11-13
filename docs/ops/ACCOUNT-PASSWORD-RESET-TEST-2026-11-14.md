# Account password-reset flow: test report (MAZER-ACCT-039)

Date: 2026-11-13 (file dated for the 2026-11-14 card). Target: https://account.fawxzzy.com (production at the time of the run), Mazer return path by code reading.
Method: code read of the whole flow, headless Chromium (Playwright) at 390x844 and 1280x720 against production, new contract tests, and local fixture e2e (Chromium and iPhone-14 WebKit emulation) for the parts that need a recovery session.

**Status: headless-only, not device-checked. The emailed-link leg is UNVERIFIED until the owner runs the manual steps at the end.** No password was changed, no account created, no database touched, no secret read. No reset email was requested for the QA address (see "Why no QA email was sent").

## How the flow works (from code)

| Step | Where |
| --- | --- |
| "Reset Password" link on sign-in (not shown while on the sign-up form) | `src/components/account/account-portal.tsx` login panel, `/reset-password` (adds `?app=mazer&returnTo=/oauth/authorize` for the Mazer hand-off) |
| Request form: email required, format `x@y.z`, then `resetPasswordForEmail(email, { redirectTo })` | `ResetPanel`, `guidanceForResetRequest` (`src/lib/auth/form-guidance.ts`), `requestPasswordReset` (`browser-adapter.ts`) |
| `redirectTo` = `https://account.fawxzzy.com/reset-password?recovery=1[&app=mazer[&returnTo=/oauth/authorize]]`, built only by `accountRecoveryUrl` | `src/config/account.ts` |
| Email: Supabase Send Email hook, link is the Supabase verify URL (`/auth/v1/verify?token=...&type=recovery&redirect_to=...`) | `supabase/functions/auth-send-email/plan.mjs` |
| Landing: client uses **PKCE** (`flowType: "pkce"`); `?code=` is exchanged with `exchangeCodeForSession`, then the form appears; the URL is scrubbed to `/reset-password?recovery=1` | `useRecoverySession`, `parseRecoveryPayload` (`callback-contract.ts`) |
| New password: min 10 characters, confirm field, show/hide per field, errors listed in a banner | `guidanceForNewPassword`, `PASSWORD_MINIMUM` |
| After saving: `updateUser({ password })`, then `signOut("this-session")` (local only), "Password updated.", redirect to `/login` (Mazer continuation kept) | `ResetPanel.submit` |
| Mazer: no reset UI of its own. Mazer sign-in is an OAuth+PKCE hand-off to the account host; Mazer's "reset" is this page with `app=mazer` | `accountRecoveryUrl`, `mazer-oauth-authorization.tsx` |
| Username sign-in lockout (v3/v4, Edge Function `username-password-signin`) | counters live in `account_private.username_signin_attempts`; only a verified sign-in clears them (v4 migration header). A reset never touches them. |
| Duplicate-username guard | `sync_username_signin_index` trigger on `auth.users` fires on every `auth.users` update, including the recovery-token and password writes. It takes an advisory lock and re-derives the index from `raw_user_meta_data`, which a reset does not change, so it is a no-op for a reset. The sign-up "username taken" copy is not reachable from reset. |

## Results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Sign-in page has a reset link and it opens the request page | PASS (390 and 1280) | link "Reset Password" -> `/reset-password`; `m-01-login.png` |
| 2 | Request form, empty | PASS | "Enter your email address.", field focused, `aria-invalid`, no network call; `m-02-request-empty.png` |
| 3 | Request form, bad format (`not-an-email`, `a b@example.com`) | PASS | "Enter a full email, like name@example.com.", no network call |
| 4 | Unknown address: generic answer | PASS | UI shows "Check your email."; provider answered `POST /auth/v1/recover` 200 in ~393 ms with `redirect_to=https://account.fawxzzy.com/reset-password?recovery=1`; `m-03-request-generic.png`, `d-03-request-generic.png` |
| 5 | Known address: same generic answer | PASS by code, not sent live | `requestPasswordReset` success and `catch` both show the same `safeAuthSuccess("reset-request")`; contract test pins the error and success copy as equal |
| 6 | Button busy/disabled states | PASS | "Working…" and disabled while in flight; disabled 5 s cooldown (client side) after a request; re-enabled after |
| 7 | Anti-enumeration at the provider | PARTIAL | Supabase answers 200 for an unknown address. Response **timing** for a known address was not measured (no live known-address request, see below) |
| 8 | Landing, bogus `code` | FAIL before fix, fixed | showed "Password not saved. Request a new link." (nothing was being saved) with only a "Log in" link; `m-landing-bogus-code.png` |
| 9 | Landing, expired / no code / provider error in hash | FAIL before fix, fixed | texts "Recovery link expired." / "Recovery link invalid." were correct, but the page said "Request a new link" nowhere as an action; only "Log in" was offered (dead end) |
| 10 | Landing, `token_hash`, `access_token` hash, two `code` values | PASS | all rejected as "Recovery link invalid.", form never shown, URL scrubbed, no auth call |
| 11 | Landing, reused link | UNVERIFIED | needs a real emailed link; by design a used or wrong-browser code fails the exchange and now shows "Link failed. Request a new link." with the new-link action |
| 12 | Open redirect via `returnTo`, `next`, `redirect_to` on the reset page | PASS | hostile values never leave the account host; final URL always `/reset-password?recovery=1`; `sanitizeReturnTarget` allowlist covered by 20 hostile inputs in `tests/account-password-reset-contract.test.mjs` |
| 13 | `/auth/confirm?type=recovery&returnTo=https://evil...` | PASS | `/auth/v1/verify` answered 403, page shows "Link failed. Request a new link.", stays on the account host |
| 14 | New-password rules and show/hide (fixture) | PASS | "Use at least 10 characters." and "Passwords do not match." shown together; toggle switches the field to text; `m-new-password-validation.png` |
| 15 | Mazer return path through reset | PASS in fixture e2e | existing test "Mazer authorization preserves the same request through signup and recovery" passes; real Mazer round trip UNVERIFIED |
| 16 | Lockout interaction | PASS by code | reset does not clear or create counters; a locked username still waits out 15 minutes or signs in with email (copy already says so) |
| 17 | Session after reset | PASS in fixture | recovery session ended with local scope only (existing e2e `data-sign-out-scope="this-session"`), person sent to `/login` |

## What was fixed in this PR

1. Dead end on a dead recovery link: the invalid, expired and failed-exchange states now show a "Request a new link" link to `/reset-password` (keeps `app=mazer` and the Mazer continuation). Before, only "Log in" was offered.
2. Wrong copy on a failed exchange: it said "Password not saved." before anything was saved. It now says "Link failed. Request a new link." (reuses the existing confirm-link copy, 31 characters, inside the 70-character cap).
3. New contract test `tests/account-password-reset-contract.test.mjs` (wired into `npm run verify` as `test:password-reset`), plus e2e assertions for the new link in `tests/e2e/account-portal.spec.ts`. After-fix view: `m-after-fix-expired-link.png`.

## Findings that need a decision (not changed here)

1. **Cross-browser reset fails by design (PKCE).** The code verifier is stored in the browser that sent the request. A link opened in a different browser or device (request on desktop, click on phone; request inside a home-screen app, mail opens Safari) cannot complete: the exchange fails and the page now says "Link failed. Request a new link." Options: keep PKCE and tell people to open the link in the same browser (zero risk, cheap), or send recovery as a `token_hash` link handled client-side (works across devices, needs an Edge Function change plus a new landing path, so it is database/provider territory and needs the owner). Recommendation: keep PKCE for now, add one line of copy later.
2. **A rate-limited or failed request still says "Check your email."** This is the price of anti-enumeration; a person hitting the provider's per-address limit gets no email and no signal. The 5 s client cooldown is the only visible guard.
3. **A password reset does not end the account's other sessions** (Mazer, Fitness, other devices): `updateUser` does not revoke other refresh tokens by default and the portal only signs out its own throw-away session. Whether that is wanted is a product/security decision; see needsOwner in the PR.
4. Dashboard-side items that cannot be verified from code (owner to check): the redirect allowlist includes `https://account.fawxzzy.com/reset-password*` (if it does not, Supabase falls back to the Site URL and the emailed link would land on the wrong page); the Send Email hook is enabled and points at `auth-send-email`; recovery link lifetime and email rate limits.

## Why no QA email was sent

The one allowed request to `fawxzzy+qa-mazer1@gmail.com` was deliberately **not** used. A request from a throw-away headless profile stores its PKCE verifier only in that profile, so the owner could not complete the link on a phone or any other browser; the single allowed send would have produced a dead email. The owner's own request (step 2 below) is the useful one. Nothing was requested, so there is no send time to record.

## Manual steps for the owner (finish the inbox part)

Use one browser for the whole sequence (iPhone Safari recommended). Do not start from the Mazer home-screen app: its storage is separate from Safari.

1. In Safari open https://account.fawxzzy.com/login?app=mazer, tap "Reset Password".
2. Enter `fawxzzy+qa-mazer1@gmail.com`, tap "Send recovery link". Expect "Check your email." Note the time.
3. Open the email on the same phone and tap "Choose a new password". If your mail app opens an in-app browser, use "Open in Safari" first, then the link works. Expect the "New Password" form (not an error).
4. Try mismatched passwords (expect "Passwords do not match."), then a password under 10 characters, then a valid new one. Save. Expect "Password updated." and the sign-in page.
5. Sign in on the account page with the **email** and the new password. Expect success.
6. Sign out, sign in again with the QA account's **username** and the new password. Expect success.
7. Try the **old** password with the email. Expect "Wrong details. Try again."
8. Open the same emailed link a second time. Expect "Link failed. Request a new link." plus a "Request a new link" link (this checks the reused-link case).
9. In Mazer, sign in with the new password (OAuth hand-off from the Mazer sign-in button). Expect to land signed in.
10. Report which steps passed; update the stored QA password label (DPAPI `mazer-qa1`) to the new password, since this changes the QA account password.

## Not verified

Real phone or Safari; the actual email (delivery, rendering, link target); reused or expired real links; known-address timing; Mazer end-to-end after a real reset; Supabase dashboard settings.
