# Shared account portal phase 1

Status: source and Preview contract only. Provider binding, custom domains, production, and
database capabilities are not part of this packet.

## Canonical origin contract

| Surface | Canonical origin | Current state |
| --- | --- | --- |
| Public hub | `https://fawxzzy.com` | Existing public origin |
| Shared account | `https://account.fawxzzy.com` | Required later; not attached here |
| Fitness | `https://fitness.fawxzzy.com` | Future owner-lane cutover |
| Mazer | `https://mazer.fawxzzy.com` | Future owner-lane cutover |

The public brand is `Fawxzzy`. `FawxzzyWeb` and `fawxzzyweb` remain technical repository,
package, and provider identities.

Exact account destinations:

- confirmation: `https://account.fawxzzy.com/auth/confirm`
- PKCE callback: `https://account.fawxzzy.com/auth/callback`
- recovery completion: `https://account.fawxzzy.com/reset-password?recovery=1`
- account home: `https://account.fawxzzy.com/account`

Return targets use a closed exact allowlist. Internal paths are `/account` and the exact recovery
completion path `/reset-password?recovery=1`; public/product
handoffs are root URLs for the public hub, Fitness, and Mazer canonical origins plus their
explicitly preserved current compatibility origins. Protocol-relative URLs, userinfo, foreign
subdomains, backslashes, fragments, query strings, and token-bearing targets fail closed to
`/account`.

Live Supabase adapter creation is limited to the exact canonical account origin and the bounded
local development origins below. The public apex, `www`, every Vercel Preview, foreign host, and
unlisted local port remain setup-pending even when public Supabase configuration is present.

Local testing is limited to `localhost` and `127.0.0.1` on ports `3000` and `3210`. A deterministic
test adapter may be selected there with `auth_test=success`, `auth_test=error`,
`auth_test=pending`, `auth_test=session`, or the bounded signup-outcome scenarios
`auth_test=signup-existing`, `auth_test=signup-rate-limit`, `auth_test=signup-network`, and
`auth_test=signup-unknown`; it is never enabled on a Vercel Preview or canonical public host. Previews
therefore prove the honest setup-pending state until public configuration is bound. Preview
redirects must be admitted individually in a future packet; do not add a broad production
`*.vercel.app` Auth wildcard.

## Phase-one session and credential rules

- One Supabase Auth user and database identity is shared across products.
- Browser persistence is origin-scoped. No `Domain=.fawxzzy.com` cookie is created, and refresh
  tokens are not shared between product origins.
- Phase one shares credentials, not seamless sessions. A person signs in once per product origin.
- Phase-two SSO is deferred. Its only admissible starting points are PKCE/OIDC or a one-time
  backend exchange; access and refresh tokens never travel in URLs.
- Email/password is the only initial provider. Email verification is off. Social, phone,
  anonymous, magic-link-only, enforced MFA, and leaked-password provider enforcement are deferred
  provider settings.
- Signup, reset, and change-password require at least 10 characters. The application has no
  restrictive maximum and never trims or truncates passwords; 128+ character values remain
  accepted. Login accepts existing shorter passwords for migration compatibility.
- Signup preserves local form-validation feedback, then maps every provider resolution or failure
  to the same fixed status notice and completion state. No raw provider diagnostic, account-existence
  hint, automatic navigation, or assumed session is exposed. A real returned session remains
  origin-scoped and provider-owned. Reset responses likewise do not disclose whether an address exists.
- Callback state must match browser session storage. Authorization codes are exchanged once and
  receive an idempotency receipt; sensitive query material is removed from the visible URL.
- Signed-out PKCE recovery explicitly exchanges its authorization code for an origin-scoped
  session, cleans the URL to the exact recovery path, and only then exposes password update. A
  missing, invalid, or expired code stays fail-closed unless an existing recovery session is
  already present on the account origin.

## Future target binding packet

Target Supabase project reference: `bxtcuhkotumitoqtrcej`.

Only a later provider-authorized packet may:

1. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` on the existing
   `fawxzzyweb` Vercel project. The publishable value is public client configuration; no service
   role or other server secret may enter the browser bundle.
2. Set the Supabase Auth Site URL to `https://account.fawxzzy.com` and admit the three exact
   production redirect destinations above. Local and each approved Preview redirect are explicit;
   no broad production wildcard is allowed.
3. Keep email verification off for the initial migration, enable email/password, and leave the
   deferred providers disabled. Leaked-password protection is a target provider setting to turn
   on when the provider packet is admitted.
4. Attach `account.fawxzzy.com` to the existing FawxzzyWeb Vercel project, then make the minimum
   DNS change through the separately authorized DNS owner. `www` continues redirecting to the
   apex hub.
5. Configure sender metadata only after mail ownership is proven: display name `Fawxzzy`;
   Google/Gmail-backed sender identity per operator policy; exact sender address remains `UNKNOWN`
   until verified. No credential or key belongs in source.

Preserve the current project ID, production deployment, aliases, and prior production deployment
as rollback evidence before any bind. Provider rollback removes only the new account alias/env
binding or restores the exact prior deployment; it does not delete the project or source history.

## Capability gates and later data contract

The portal does not implement profile, username, user-number, entitlement, product data, or
review tables. The canonical username control is visibly disabled until a governed platform
capability exists; the UI never fabricates availability.

Future human signups must receive an immutable, unique, never-reused `user_number` atomically
from the central allocator. Existing Fitness numbers and provenance stay preserved. Legacy
non-Fitness assignment follows the separately approved deterministic migration order. Bots and
service identities are excluded unless explicitly converted. None of those writes are authorized
by this source packet.

## Required post-bind smoke proof

1. Confirm exact Vercel project, Git revision, Preview/production target, custom domain, and prior
   rollback deployment before mutation.
2. Prove TLS and canonical behavior for the account origin without changing the public hub.
3. Exercise signup (10 and 128+ characters), legacy-short login, normal login, local sign-out,
   email update, password update, reset request, recovery completion, confirm, and PKCE callback.
4. Prove non-enumerating error copy, cooldown, callback idempotency, state mismatch rejection,
   URL sanitization, and rejection of access/refresh-token URLs and open redirects.
5. Prove sessions remain isolated across account, Fitness, and Mazer origins and that no parent
   domain cookie exists.
6. Prove mobile Safari and desktop Chromium layout, keyboard/focus order, WCAG A/AA checks, no
   horizontal overflow, no console/page errors, and safe setup failure when either public variable
   is missing.
7. Prove username and all platform-owned writes remain gated until the target schema capability is
   separately deployed and read back.

## Rollback and blocked state

Source rollback is a normal revert of the portal PR. Provider rollback is not executable until a
later binding packet captures exact preimages. The following remain blocked here: target project
environment values, Supabase Auth/provider settings, sender identity, domain/DNS attachment,
platform schema, global username writes, central user-number allocation, production deployment,
and any product-origin cutover.
