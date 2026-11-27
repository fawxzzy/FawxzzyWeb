# Auth email hook (branded, per-app transactional email)

Status (2026-11-15): the owner reports the function live as version 8 with the hook enabled. That is not verified from this repo; the repo holds source only. The branded-icon template described below is source only until the owner deploys it (see "Deploy order for template changes").

## What this is

Supabase Auth normally sends its own plain emails (recovery, sign-up confirmation, and so on). This change adds a **Send Email hook**: an edge function, `auth-send-email`, that Supabase calls instead of its built-in mailer. The function:

1. Checks that the request really came from Supabase (a Standard Webhooks signature, not a JWT).
2. Picks the product theme from the `app` value in the redirect address (`app=fitness`, `app=mazer`, otherwise the default Fawxzzy theme).
3. Renders the email (HTML and plain text) and sends it through Resend.

The email shows the same product marker as the sign-in screen at the top (`FITNESS`, `MAZER`, `FAWXZZY`), the same accent color, and the same dark canvas. Those values come from one shared file, `supabase/functions/_shared/auth-theme.mjs`. The portal (`src/config/account.ts`) reads that file too, and `npm run test:auth-email` fails if the portal screens, the portal CSS base colors, or the email ever disagree.

## The one template

Every email (confirm, reset, email change to either address, the "email changed" notice, the code email, every other notice) uses one layout: dark canvas, a card with a soft glow in the app accent, the app's own icon, the product kicker, a big light title, short sentence-case copy, at most one pill button (with a plain "Button not working?" link under it), then a short footer. Addresses are always shown masked (`z•••@icloud.com`, the same rule as `maskEmail` in `src/lib/auth/copy-matrix.ts`, parity-tested). Copy never says "needs verification", "(later)", "token" or "Supabase"; link lifetimes say "1 hour" (copy matrix `reset.sent`).

### App icons in email

The icon is the only image. It is an absolute https URL on the account host, `https://account.fawxzzy.com/email/icons/<app>-192.png` (`emailAssetOrigin` + `emailIconPath` in `auth-theme.mjs`), served from `public/email/icons/`. PNG, not WebP or SVG, because several mail clients show neither. The files are byte-exact copies of each product's own branding output; they are not drawn here. The portal sign-in screens read `iconPath` from the same theme file, and `npm run test:auth-email` checks that each email icon visually matches its portal icon and that each file still has the sha256 below.

| App | File | Source | sha256 |
| --- | --- | --- | --- |
| Fawxzzy (website) | `public/email/icons/website-192.png` | FawxzzyWeb `public/app/icon-192.png` | `706fbaae6ed1f82d736b03f8d334246257c7c2ad12d8d2edb4b2ca4a37525018` |
| Fitness | `public/email/icons/fitness-192.png` | fawxzzy-fitness main `public/app/icon-192.png` (same bytes as `https://fitness.fawxzzy.com/app/icon-192.png`) | `558f4236982b7d81b37e9beebebbab6de990ba5c4f8e1326686d56ac1f387b84` |
| Mazer | `public/email/icons/mazer-192.png` | mazer main `public/icons/icon-192.png` (same bytes as `https://mazer.fawxzzy.com/icons/icon-192.png`) | `cf8f46d880655b987bd10d9d371117525043cf842d7cb10270e741a653f30785` |

Rule: never rename or delete these files. Emails already in inboxes point at them. To change an icon, copy the new branding output over the file, update the sha256 in the test and this table, and deploy the portal before the function.

### Deploy order for template changes

1. Deploy the portal (Vercel) and check that `https://account.fawxzzy.com/email/icons/{website,fitness,mazer}-192.png` each return 200 `image/png`.
2. Then deploy the function (owner, ask-first): `supabase functions deploy auth-send-email --project-ref bxtcuhkotumitoqtrcej`. Deploying the function first sends emails with a broken image until step 1.

### Client limits (dark mode and styling)

- The glow (`box-shadow`) shows in Apple Mail and iOS Mail only. Gmail and Outlook drop it; the accent ring and border remain.
- Outlook desktop squares the card, icon and button corners and may block images until the reader allows them (the icon has `alt=""`, so it leaves an empty 72 px box, not broken text).
- The template is already dark and declares `color-scheme: dark light`. Clients that force their own dark mode (Gmail apps, Outlook.com) may still shift colors; Gmail iOS can invert light text. This has not been checked in real clients.

Handled `email_action_type` values: `signup`, `invite`, `magiclink`, `email`, `recovery`, `email_change` (including the secure two-address case), `reauthentication` (6-digit code), the seven `*_notification` types (no link), and a neutral fallback for any unknown future type (no link).

## Which link goes in the email, and why

| Email type | Link | Reason |
| --- | --- | --- |
| `recovery` (since 2026-11-26) | The account confirm route: `https://account.fawxzzy.com/auth/confirm?[app=...&][returnTo=%2Foauth%2Fauthorize&]token_hash=<token_hash>&type=recovery`, built only when `redirect_to` is exactly one of the portal's four `accountRecoveryUrl` values (`RECOVERY_REDIRECTS` in `plan.mjs`) | The confirm route calls `verifyOtp({ token_hash, type: "recovery" })`: the provider checks the token itself and returns the recovery session, so the link works in **any** browser (the old PKCE `code` could only be exchanged by the browser that asked). It then moves to `/reset-password?recovery=1[&app][&returnTo]` (new-password form) or `/reset-password?link=expired|invalid` (request form with the reason). |
| `recovery`, when `redirect_to` is anything else | Supabase verify URL: `{SUPABASE_URL}/auth/v1/verify?token=<token_hash>&type=recovery&redirect_to=<redirect_to>` | Supabase verifies and redirects back with `code`, which the reset page still accepts (links already in inboxes keep working). |
| `signup`, `invite`, `magiclink`, `email`, `email_change` | The account confirm route directly: `redirect_to` (which is `https://account.fawxzzy.com/auth/confirm?app=...&returnTo=...&state=...`) with `token_hash` and `type` appended | `/auth/confirm` is built to take `token_hash` + `type` and call `verifyOtp`. Appending keeps `state`, which the Fitness confirm step checks against the browser that started sign-up. |
| Any of those, when `redirect_to` is not exactly the account confirm route | Supabase verify URL | Supabase checks `redirect_to` against its own allow-list. |

Proof: `tests/auth-email-contract.test.mjs` loads the real `src/config/account.ts` and `src/lib/auth/callback-contract.ts`, builds `redirect_to` with the portal's own `accountRecoveryUrl` / `accountConfirmUrl`, and asserts that `parseConfirmPayload` accepts every direct link, `parseRecoveryPayload` accepts the post-verify `code` redirect, and `parseRecoveryPayload` rejects a direct `token_hash` link.

Recovery trade-off (fixed 2026-11-26): a verify URL is consumed by the first request that opens it, so a mail scanner could burn a recovery link, and its PKCE `code` only worked in the requesting browser (Mazer player report 2026-11-24). The confirm-route link above fixes both: opening the static page does not use the token (only the page's own `verifyOtp` call does), and no code verifier is needed. Deploy order: portal first (the confirm route must handle `type=recovery`), then this function. Rollback: redeploy the previous `plan.mjs` (sha256 `3dc3ee15025f2239d1d42b41e5e60628c1ca4b020874599b84817860ba90de0f`).

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

1. Dashboard > Authentication > Auth Hooks > Send Email > **disable** the hook. Supabase should go back to its built-in mailer (Supabase documents the hook as replacing the built-in sender but does not spell out the switch-back timing, so verify with a QA-account reset right after disabling).
2. Leave the function deployed but unused. Nothing else needs to change; no portal code depends on the hook.

If emails stop arriving after enabling: disable the hook first, then read the function logs.

## Local commands

- `npm run test:auth-email` runs the hermetic tests (also part of `npm run verify`).
- `npm run email:preview` writes rendered HTML and text for default/fitness/mazer x signup, recovery, email change (single and secure pair), email-changed notice, password-changed notice and code email to `C:/ATLAS/tmp/wt/email-preview` (outside the repo, never committed). Pass a directory argument to change it. Add `-- --local-assets` to load the icons from this checkout's `public/` instead of the account host (needed before the portal deploy).

## Files

- `supabase/functions/_shared/auth-theme.mjs`: the single source of truth for per-app tokens and icon paths.
- `public/email/icons/`: the email icons (see the provenance table).
- `supabase/functions/auth-send-email/`: `index.ts` (Deno entry), `handler.mjs` (hook contract), `standard-webhooks.mjs` (signature check), `plan.mjs` (link and copy per action type), `render.mjs` (HTML and text), `resend.mjs` (sender).
- `tests/auth-email-contract.test.mjs`, `tests/helpers/load-portal-ts.mjs`.

## Not covered

- Real-client rendering (Gmail, Apple Mail, Outlook) has not been checked; only a Chromium render of the HTML at 390 px was inspected. See "Client limits" above.
- The sign-in screen's bottom action is a light-to-accent gradient; the email button is a solid accent with dark text, chosen so the contrast check is exact.
- Resend rate limits and bounce handling are not implemented; a Resend failure returns an error to Supabase.
