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

Until the shared account origin is attached and publicly proven, public navigation stays on the
live in-project `/account` route. Canonical account metadata and future provider redirects continue
to target `https://account.fawxzzy.com` for the later binding packet.

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

Browser key admission is fail-closed at two boundaries. Before Next.js can inline public
configuration into a browser bundle, the build accepts only a modern `sb_publishable_...` key in
the documented format or a well-formed legacy JWT whose decoded role is exactly `anon`. The same
classifier runs immediately before live client construction. Modern secret keys, legacy
`service_role` JWTs, malformed or unsupported values, surrounding whitespace, and ambiguous
configuration stop the build or remain setup-pending with generic copy. Key values and key classes
are never included in browser errors, logs, test output, or receipts. Missing configuration remains
an allowed source/Preview state and renders the existing setup-pending interface.

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
  anonymous, magic-link-only, and passwordless sign-in are deferred. TOTP may be offered later but
  remains optional; SMS MFA and passkeys are deferred. Client-accessible manual identity linking is
  disabled, and privileged migration linking requires separately verified deterministic evidence.
- Signed-in email and password changes reauthenticate the same origin-scoped user with the current
  password immediately before the update. Secure email change remains a provider setting to keep
  enabled during the later binding packet.
- Signup, reset, and change-password require at least 10 characters. The application has no
  restrictive maximum and never trims or truncates passwords; 128+ character values remain
  accepted. Login accepts existing shorter passwords for migration compatibility.
- Signup preserves local form-validation feedback, then maps every provider resolution or failure
  to the same fixed status notice and completion state. No raw provider diagnostic, account-existence
  hint, automatic navigation, or assumed session is exposed. A real returned session remains
  origin-scoped and provider-owned. Reset responses likewise do not disclose whether an address exists.
- Callback state must match browser session storage. Authorization codes are exchanged once and
  receive an idempotency receipt; sensitive query material is removed from the visible URL.
- Confirmation and callback processing is deferred through a one-shot lifecycle boundary. A
  canceled pre-processing setup remains retryable for React's development setup/cleanup probe,
  while a launched provider operation cannot be duplicated by a later effect setup.
- Request cooldown timers clear themselves at expiry and on unmount; no post-expiry interval or
  render loop remains active.
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
   deferred providers disabled. Enable leaked-password protection and managed CAPTCHA for public
   signup, reset, and abuse-prone anonymous Auth entry only when the secure provider packet is
   admitted; controlled test and migration flows require an explicit allowlist. Source never
   claims either control is live before provider readback.
4. Apply the ratified provider session policy: multiple devices allowed, single-session off,
   30-day absolute lifetime, 7-day inactivity timeout, refresh-token compromise detection on with
   a 10-second reuse interval, and the 15-minute AAL1 limit unless application evidence changes it.
   These are blocked provider settings, not browser-source enforcement.
5. Attach `account.fawxzzy.com` to the existing FawxzzyWeb Vercel project, then make the minimum
   DNS change through the separately authorized DNS owner. `www` continues redirecting to the
   apex hub.
6. Configure sender metadata only after mail ownership is proven: display name `Fawxzzy`;
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

### Shared-service registration presentation

The source-only account surface now carries one transport-neutral, typed presentation contract for
human-account services. Fitness and Mazer are the only admitted services in version one. DiscordOS
remains an operational coordination surface and must not be presented as a human account unless a
separate linkage capability is ratified and proven.

The read model distinguishes `unavailable`, `not_registered`, `active`, `action_required`, and
`unknown`. Missing capability data is `unavailable`; incomplete, duplicate, unsupported-version, or
malformed authoritative readback is `unknown`. Neither state can become `active` through local
storage, URL input, optimistic UI, or inference. Current and planned-canonical destinations come
from the existing centralized account/app-origin contract.

A transport-neutral adapter type reserves future `read` and idempotent `activate` operations. This
does not name or call an RPC, endpoint, table, or provider API. Its source-only resolution is
`unavailable` with no adapter, so activation controls remain disabled. A later platform packet must
bind an authoritative server capability, define authentication and idempotency evidence, and prove
read-after-write before the UI may expose activation.

Phase-one intent is explicit: once that capability exists, signing into Fitness or Mazer with the
shared identity may idempotently create or activate the matching service account. This is service
registration, not shared browser session state, entitlement, billing, product-data duplication, or
implicit SSO. Each origin continues to own its own browser session.

The global username and immutable `user_number` remain authoritative-platform fields. Username
availability/editing and user-number readback/allocation stay disabled until governed server
contracts exist. The browser must never simulate uniqueness, allocate a number, renumber an
existing account, or treat a client-side value as authoritative.

### Successor checklist

- LANDED: typed Fitness/Mazer catalog, five-state normalization, fail-closed adapter boundary, and
  centralized current/canonical destinations.
- LANDED: account-page service presentation, distinct registration states, disabled activation,
  and explicit username/user-number capability gates.
- LANDED: deterministic local-only state fixtures and regression coverage for partial/malformed
  readback, no false activation, safe origins, session isolation, and token/cookie absence.
- INTENTIONALLY DEFERRED: authoritative service read/activation transport, username writes,
  user-number allocation/readback, entitlements, billing, and product-owned data.
- BLOCKED: target schema/API/provider binding, environment values, account domain attachment, DNS,
  and production launch; each requires a separate owner packet with exact preimages and rollback.

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
