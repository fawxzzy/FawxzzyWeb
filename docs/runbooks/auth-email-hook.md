# Auth email hook (branded, per-app transactional email)

Status: source only. Nothing in this runbook has been performed. The function is not deployed, the hook is not enabled, and no secret is set.

## What this is

Supabase Auth normally sends its own plain emails (recovery, sign-up confirmation, and so on). This change adds a **Send Email hook**: an edge function, `auth-send-email`, that Supabase calls instead of its built-in mailer. The function:

1. Checks that the request really came from Supabase (a Standard Webhooks signature, not a JWT).
2. Picks the product theme from the `app` value in the redirect address (`app=fitness`, `app=mazer`, otherwise the default Fawxzzy theme).
3. Renders the email (HTML and plain text) and sends it through Resend.

The email shows the same product marker as the sign-in screen at the top (`FITNESS`, `MAZER`, `FAWXZZY`), the same accent color, and the same dark canvas. Those values come from one shared file, `supabase/functions/_shared/auth-theme.mjs`. The portal (`src/config/account.ts`) reads that file too, and `npm run test:auth-email` fails if the portal screens, the portal CSS base colors, or the email ever disagree.

Handled `email_action_type` values: `signup`, `invite`, `magiclink`, `email`, `recovery`, `email_change` (including the secure two-address case), `reauthentication` (6-digit code), the seven `*_notification` types (no link), and a neutral fallback for any unknown future type (no link).

## Which link goes in the email, and why

| Email type | Link | Reason |
| --- | --- | --- |
| `recovery` | Supabase verify URL: `{SUPABASE_URL}/auth/v1/verify?token=<token_hash>&type=recovery&redirect_to=<redirect_to>` | The reset page (`/reset-password?recovery=1`) only accepts a PKCE `code` or an existing session. `parseRecoveryPayload` rejects `token_hash` in the address. Supabase must verify the token and redirect back with `code`. |
| `signup`, `invite`, `magiclink`, `email`, `email_change` | The account confirm route directly: `redirect_to` (which is `https://account.fawxzzy.com/auth/confirm?app=...&returnTo=...&state=...`) with `token_hash` and `type` appended | `/auth/confirm` is built to take `token_hash` + `type` and call `verifyOtp`. Appending keeps `state`, which the Fitness confirm step checks against the browser that started sign-up. |
| Any of those, when `redirect_to` is not exactly the account confirm route | Supabase verify URL | Supabase checks `redirect_to` against its own allow-list. |

Proof: `tests/auth-email-contract.test.mjs` loads the real `src/config/account.ts` and `src/lib/auth/callback-contract.ts`, builds `redirect_to` with the portal's own `accountRecoveryUrl` / `accountConfirmUrl`, and asserts that `parseConfirmPayload` accepts every direct link, `parseRecoveryPayload` accepts the post-verify `code` redirect, and `parseRecoveryPayload` rejects a direct `token_hash` link.

Known trade-off (recovery): a verify URL is consumed by the first request that opens it. Some mail scanners open links before the person does, which can make a recovery link look expired. The durable fix is to teach the reset page to accept `token_hash` like `/auth/confirm` does. That is a portal change and is **not** part of this work.

## Failure mode you must know about

While the hook is enabled, **a broken function blocks every auth email** (sign-up, recovery, magic link, email change). Supabase does not fall back to its built-in mailer when the hook fails. Enable the hook only after a successful signed test invoke (step 7), and keep the rollback (below) at hand.

## Steps that need you (they involve accounts, DNS, or secrets)

1. **Create a Resend account** at resend.com (the email provider).
2. **Verify the sending domain `fawxzzy.com`** in Resend > Domains. Resend shows DNS records (SPF/DKIM, plus optional DMARC). Add them at the DNS provider for fawxzzy.com. Wait until Resend shows the domain as verified. This proves to mail providers that Fawxzzy mail is genuine; without it, messages are rejected or land in spam.
3. **Turn off open and click tracking** for the domain in Resend. Tracking rewrites links and would break the one-time token links.
4. **Create a Resend API key** (sending access only, restricted to the fawxzzy.com domain if offered). Keep it out of chat and the repo.
5. **Create the hook secret** in Supabase Dashboard > Authentication > Auth Hooks > Send Email > create the hook (do not enable it yet). Supabase generates a value in the form `v1,whsec_<base64>`. Copy it.
6. **Set the function secrets** (project Fawxzzy, `bxtcuhkotumitoqtrcej`), from your own terminal or the Dashboard > Edge Functions > Secrets, never in a committed file:
   - `RESEND_API_KEY` = the key from step 4
   - `SEND_EMAIL_HOOK_SECRET` = the full `v1,whsec_...` value from step 5
   - `AUTH_EMAIL_FROM` = for example `Fawxzzy <no-reply@fawxzzy.com>` (must be an address on the verified domain)

   `SUPABASE_URL` is provided to the function automatically.
7. **Deploy the function** (from the repo root, after this PR is merged):

   ```
   supabase functions deploy auth-send-email --project-ref bxtcuhkotumitoqtrcej
   ```

   `supabase/config.toml` sets `verify_jwt = false` for this function because Supabase calls it with a webhook signature, not a JWT. Check it is respected after deploy (Dashboard > Edge Functions > auth-send-email > JWT verification off).
8. **Signed test invoke before enabling.** Send a correctly signed sample payload to the function URL (`https://bxtcuhkotumitoqtrcej.supabase.co/functions/v1/auth-send-email`) with the three headers `webhook-id`, `webhook-timestamp`, `webhook-signature`, and a recipient you control. Expect HTTP 200 and `{}` and an email in your inbox. An unsigned request must return 401 `{"error":{"http_code":401,...}}`. Do this before step 9.
9. **Enable the hook**: Dashboard > Authentication > Auth Hooks > Send Email > enable, type HTTPS, URL = the function URL above, secret = the value from step 5.

## Verification checklist (after step 9)

- [ ] Request a password reset for the QA account (`claude1`) from `https://account.fawxzzy.com/reset-password?app=fitness`.
- [ ] The email arrives from the `AUTH_EMAIL_FROM` sender, with `FITNESS` at the top and the Fitness green accent, matching the Fitness sign-in screen.
- [ ] The plain-text part is present (view source or "show original").
- [ ] The email reads correctly in a light client and a dark client.
- [ ] The button opens the **New Password** form on `account.fawxzzy.com` with the Fitness theme.
- [ ] Repeat once with `app=mazer` and once with no `app` (default Fawxzzy theme).
- [ ] Create-account confirmation: the link lands on `/auth/confirm` and completes.
- [ ] Supabase Dashboard > Edge Functions > auth-send-email > Logs show no errors.

## Rollback

1. Dashboard > Authentication > Auth Hooks > Send Email > **disable** the hook. Supabase immediately goes back to its built-in mailer.
2. Leave the function deployed but unused. Nothing else needs to change; no portal code depends on the hook.

If emails stop arriving after enabling: disable the hook first, then read the function logs.

## Local commands

- `npm run test:auth-email` runs the hermetic tests (also part of `npm run verify`).
- `npm run email:preview` writes rendered HTML and text for default/fitness/mazer x recovery/signup to `C:/ATLAS/tmp/wt/email-preview` (outside the repo, never committed). Pass a directory argument to change it.

## Files

- `supabase/functions/_shared/auth-theme.mjs`: the single source of truth for per-app tokens.
- `supabase/functions/auth-send-email/`: `index.ts` (Deno entry), `handler.mjs` (hook contract), `standard-webhooks.mjs` (signature check), `plan.mjs` (link and copy per action type), `render.mjs` (HTML and text), `resend.mjs` (sender).
- `tests/auth-email-contract.test.mjs`, `tests/helpers/load-portal-ts.mjs`.

## Not covered

- Real-client rendering (Gmail, Apple Mail, Outlook) has not been checked; only a Chromium render of the HTML was inspected. Outlook desktop ignores `border-radius`, so the button is square there.
- The sign-in screen's bottom action is a light-to-accent gradient; the email button is a solid accent with dark text, chosen so the contrast check is exact.
- Resend rate limits and bounce handling are not implemented; a Resend failure returns an error to Supabase.
