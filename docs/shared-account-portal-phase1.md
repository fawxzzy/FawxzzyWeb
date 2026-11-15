# Shared account portal phase 1

Status: source and Preview implementation. This packet performs no provider mutation. The
account custom domain was bound separately and is now independently read back in the
[account-subdomain receipt](receipts/2026-07-21-fawxzzyweb-account-subdomain-readback.md);
Auth environment/provider binding and database capabilities remain gated.

## Canonical origin contract

| Surface | Canonical origin | Current state |
| --- | --- | --- |
| Public hub | `https://fawxzzy.com` | Existing public origin |
| Shared account | `https://account.fawxzzy.com` | Live route origin with durable readback; Auth provider binding remains gated |
| Fitness | `https://fitness.fawxzzy.com` | Future owner-lane cutover |
| Mazer | `https://mazer.fawxzzy.com` | Future owner-lane cutover |

The public brand is `Fawxzzy`. `FawxzzyWeb` and `fawxzzyweb` remain technical repository,
package, and provider identities.

The shared account origin is attached to the existing FawxzzyWeb project and serves the current
source-only account routes. The linked receipt proves the project/domain/DNS/TLS/route postimage;
it does not prove target Auth environment or provider binding. Public navigation stays focused on
the public studio; account metadata and future provider redirects target
`https://account.fawxzzy.com`.

Exact account destinations:

- confirmation: `https://account.fawxzzy.com/auth/confirm`
- PKCE callback: `https://account.fawxzzy.com/auth/callback`
- recovery completion: `https://account.fawxzzy.com/reset-password?recovery=1`
- account home: `https://account.fawxzzy.com/account`

Return targets use a closed exact allowlist. Internal paths are `/account` and the exact recovery
completion path `/reset-password?recovery=1`. Public/product handoffs may use paths on the public
hub, Fitness, and Mazer canonical origins plus their explicitly preserved compatibility origins.
The only permitted external query shape is one exact `returnTo` key whose value is a same-origin
relative path without its own query or fragment; this preserves a bounded product deep-link return
without admitting arbitrary query data. Protocol-relative URLs, userinfo, foreign subdomains,
backslashes, fragments, every other query key, nested query/fragment data, and token-bearing
targets fail closed to `/account` or the selected product root.

Sign-in screen intent: `https://account.fawxzzy.com/login?app=<product>&intent=signup` opens the
"Create account" form first (any product, or none). It is the one portal sign-up surface a product
links to; Fitness's `/signup` will link here once its F-2 change ships (it does not yet). Exactly
one `intent` key with the exact value `signup` selects sign-up; every other value (absent, `login`, another case, repeated, unknown)
opens sign-in. It is presentation only: it adds no return target, no Auth behaviour and no
handoff change, so `app` and `returnTo` keep their closed contracts above and a successful sign-up
continues exactly like sign-in (Fitness handoff, Mazer authorize return, or the website target).
The on-screen "Sign in" / "Create account" link still switches forms and is not overridden by the
address.

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
`auth_test=signup-existing`, `auth_test=signup-weak-password`, `auth_test=signup-rate-limit`, `auth_test=signup-network`, and
`auth_test=signup-unknown`, `auth_test=signup-username-taken`, `auth_test=signup-database-error`, or the
unrelated-session-loss scenario `auth_test=session-expires`; it is never enabled on a Vercel Preview or canonical public host. Previews
therefore prove the honest setup-pending state until public configuration is bound. Preview
redirects must be admitted individually in a future packet; do not add a broad production
`*.vercel.app` Auth wildcard.

## Phase-one session and credential rules

- One Supabase Auth user and database identity is shared across products.
- Browser persistence is origin-scoped. No `Domain=.fawxzzy.com` cookie is created, and refresh
  tokens are not shared between product origins.
- Phase one shares credentials, not seamless sessions. A person signs in once per product origin.
  (The Fitness handoff below is the one deliberate exception: it hands Fitness the portal's current
  session pair, so both origins then hold one provider session.)
- Sign-out reach (FF-ACCOUNT-004 W-2). "Sign out" on the account page asks the provider to
  revoke the account's sessions everywhere (Supabase `scope: "global"`: every session and refresh
  token for the account, so the portal, Fitness, Mazer and other devices can no longer refresh),
  because a Fitness sign-out already behaves that way and a narrower portal sign-out left the apps
  apparently signed in. Access tokens already issued stay valid until they expire, so anything that
  verifies them offline (rather than asking the provider) keeps working until then; whether Mazer
  notices a revoked session promptly is not verified. The one narrower use is ending the portal's
  own throw-away recovery session after "Save new password" (`scope: "local"`): choosing a new
  password does not sign the person out of the apps they are using. A sign-out the provider cannot
  complete (network, 5xx, rate limit) is reported as an error. Only a session another app already
  revoked (revoked or unknown refresh token, missing session) counts as signed out, never as a
  failure. Caveat: for an expired access token the SDK clears the local copy on any non-retryable
  refresh failure (a 429, a gateway 4xx) before the logout call can be sent; that case is reported
  as an error and the person signs in again before retrying, because the provider session may still
  be alive.
- Stale cached sessions. The portal's browser storage can hold a session another app has already
  revoked (Fitness "sign out" is global). The account page therefore asks the provider whether the
  session is still alive right after loading and again when the person returns to the page (tab
  visible, window focus, back/forward restore), at most once per 20 s, using the access token it
  already holds. The check itself does not use the refresh token, but the SDK may: when the held
  access token is expired or inside its last 90 s, `getUser()` refreshes it, as any `getSession`
  does. A session the provider reports revoked or rejected (`session_not_found`, `bad_jwt`,
  `user_not_found`, `user_banned`) is cleared locally and the person is sent to sign in. Any other
  failed check (offline, 5xx, a gateway answer such as an invalid-API-key 401) changes nothing:
  being offline is not a sign-out. The provider's answer also refreshes the displayed username and
  email.
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
- Signup preserves local form-validation feedback, then branches only on whether the provider
  returned a real session. A returned session means the account exists and the user is signed in:
  the portal continues exactly like sign-in (Fitness handoff, Mazer authorize return, or the
  sanitized website/Projects target). With no session the provider wants the email confirmed: the
  username and email stay on screen as locked fields and the notice says "Check z•••@domain for a
  link to confirm your account." (the masked address is the one on that screen), with a 30 s
  resend countdown in the dock and a "Wrong email?" link. Provider settings hide an
  already-registered address behind the same answer; that residual signal is accepted.
  Each provider rejection the provider names gets its own copy-matrix line (username taken,
  email already has an account with an inline "Sign in", weak password, invalid email, rate
  limit, no connection, security check). A taken username (MAZER-ACCT-029, the database
  duplicate-username guard or a before-user-created hook answering 409 with
  `ACCOUNT_USERNAME_TAKEN`) outlines the username field. A generic "Database error saving new
  user" or any unknown failure has no named cause in the provider answer, so it shows the generic
  "Check your connection and try again." (known gap: the backend returns one code for every
  database failure). No raw provider diagnostic is surfaced or logged.
- Reset requests never disclose whether an address exists. Signed in, the request uses the
  account email (a locked field) and the notice names the masked address. Signed out, the answer
  is "If that account exists, we sent a reset link to its email." whatever happened at the
  provider; only sending failures (rate limit, send failure, no connection) get their own line.
  Known gap: the approved design asks for a username field when signed out, which needs a
  server-side username-to-email reset path (an Edge Function); until then the signed-out request
  takes an email.
- Portal copy lives only in the copy matrix (`src/lib/auth/copy-matrix.ts`). Every line is at
  most 70 characters and `npm run test:account-copy` fails on any other visible text in the auth
  screen components (see `docs/auth-surface-family.md`).
- Callback state must match browser session storage. Authorization codes are exchanged once and
  receive an idempotency receipt; sensitive query material is removed from the visible URL.
- Callback and confirmation show one loader, then navigate straight to the sanitized allowlisted
  destination. A failed, missing, unauthorized or setup-pending link replaces the page with sign
  in plus the reason (`/login?notice=callback|confirmed|unavailable`); there is no dead-end
  screen. On local test origins the outcome and destination are recorded on
  `document.documentElement.dataset` (`linkOutcome`, `linkDestination`) and only same-origin
  paths are opened.
- Confirmation and callback processing is deferred through a one-shot lifecycle boundary. A
  canceled pre-processing setup remains retryable for React's development setup/cleanup probe,
  while a launched provider operation cannot be duplicated by a later effect setup.
- Request cooldown timers clear themselves at expiry and on unmount; no post-expiry interval or
  render loop remains active.
- Signed-out PKCE recovery explicitly exchanges its authorization code for an origin-scoped
  session, cleans the URL to the exact recovery path, and only then exposes password update. A
  missing, invalid, or expired code stays fail-closed unless an existing recovery session is
  already present on the account origin.
- Email identifiers use Supabase password authentication directly. Username identifiers use the
  `username-password-signin` Edge Function, which accepts only the canonical account origin,
  requires a public client key validated against the canonical project's Auth settings (with the
  function environment as the fast path), rejects secret and service-role key classes before that
  validation, caches successful remote validation for a bounded lifetime, and limits uncached
  project-validation attempts per warm function instance before any privileged username lookup.
  Its database RPC returns a named one-row relation rather than a scalar response. A narrow
  `account_api` Data API schema exposes only the service-role resolver wrapper; it exposes no
  account tables and delegates to the private implementation under a fixed search path. The local
  Supabase contract preserves the existing `mazer` and `fitness` schemas while adding
  `account_api` to `[api].schemas`. Production activation must likewise add `account_api` to the
  existing exposed-schema setting before the Edge Function is activated; the database migration
  alone does not change that provider setting. The Edge
  transport explicitly selects that schema, requests plural JSON, accepts exactly one UUID row, and rejects HTTP
  errors, zero or multiple rows, scalar or object drift, malformed identifiers, and transport
  failures. This keeps PostgREST content negotiation explicit. It resolves one exact indexed case-insensitive username,
  and applies durable global, client, and per-identifier attempt windows before calling Auth. Old
  attempt rows are deleted before admission and the global window bounds storage cardinality. The
  missing-username path performs the same Admin/Auth operation classes as a resolved username so
  the response body, status, and downstream call shape remain non-enumerating. The index is maintained
  from explicit username metadata by a database trigger. A normalized username is indexed only
  while exactly one Auth user claims it; pre-existing or newly introduced ambiguous claims remain
  email-only until the metadata conflict is resolved, without silently changing or merging users.
  Candidate-scoped transaction locks serialize concurrent claims, and multi-candidate updates take
  those locks in lexical order so simultaneous claims cannot abort Auth writes or deadlock swaps.
  Missing, ambiguous, and incorrect credentials return the same categorical failure. The
  resolved email never reaches the browser.
- Username lockout (additive v3). `account_resolve_username_signin_v3` returns
  `(resolved_user_id, throttled)` with the same keys, windows and limits as v2, so the Edge Function
  can answer HTTP 429 `username_throttled` and the portal can say "Too many tries. Wait 15
  minutes or use your email." instead of a wrong-password message. The
  throttle is evaluated before and independently of whether the username exists, so it does not
  enumerate accounts. After a verified password sign-in the function calls
  `account_note_username_signin_success_v1`, which deletes only that username's counter row, so only
  failures accumulate. v2 stays installed; the Edge Function falls back to v2 (no distinct lockout
  signal, no success clearing) only when PostgREST reports v3 absent, so the SQL can be applied before
  the function is redeployed. Migration: `20261112140000_account_username_signin_throttle_v3.sql`
  (apply is a gated Supabase write; rollback drops only the v3 and note-success functions).
- The website-context post-auth return URL carries a one-time `signedIn` (and sign-out `signedOut`)
  presentation parameter. The public website no longer consumes it: its only consumer was the Sign in
  action on the Home page, which was removed (2026-11-13), and `/` now redirects to Apps.
  No cookie, user identifier, access token, or refresh token crosses the origin boundary.
- Successful website-context login returns to `https://fawxzzy.com/`, which redirects to Apps. A signed-out Account visit
  routes to the contextual login screen. Successful password replacement clears the recovery
  session and returns to login.

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
5. Preserve the existing `account.fawxzzy.com` attachment on the FawxzzyWeb Vercel project. Any
   future DNS or routing mutation remains separately governed. `www` continues redirecting to the
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
human-account services. Fitness and Mazer are the only admitted services in version one.

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
- LANDED SEPARATELY: `account.fawxzzy.com` project attachment, DNS, TLS, and passive route
  availability, with the exact readback preserved in the account-subdomain receipt.
- BLOCKED: target schema/API/provider binding, environment values, Auth activation, and production
  launch of configured account behavior; each requires a separate owner packet with exact
  preimages and rollback.

## Required post-bind smoke proof

1. Confirm exact Vercel project, Git revision, Preview/production target, custom domain, and prior
   rollback deployment before mutation.
2. Prove TLS and canonical behavior for the account origin without changing the public hub.
3. Exercise signup (10 and 128+ characters), legacy-short login, normal login, sign-out everywhere (which must land on the product origin, never on the login page, and must leave Fitness and Mazer signed out at the provider),
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

## Turnstile CAPTCHA (FW-CAPTCHA-001)

- Sign-in, sign-up and the password-reset request form carry a Cloudflare Turnstile widget. The public site key is in `src/config/turnstile.ts`; the secret is never in the repo.
- Each request sends `options.captchaToken` (email sign-in, sign-up, reset) or a `captchaToken` body field (username sign-in edge function). Supabase ignores the token while CAPTCHA is disabled, so this is dark-safe.
- The Cloudflare script loads only on the account origin, after the page settles, never on marketing pages. The widget is interaction-only and is reset after every attempt. If it cannot load, a short note shows and the request still goes out (the server rejects it once enforcement is on). A submit waits at most 4 seconds for an in-flight check.
- The site sets no CSP today. If one is added, allow `https://challenges.cloudflare.com` in script-src, frame-src and connect-src.
- Enable order: (1) this widget live in Web AND Fitness; (2) turn Supabase Auth CAPTCHA ON (owner pastes the Turnstile secret in the dashboard); (3) verify sign-in, sign-up and reset on the account origin. Rollback: turn CAPTCHA off in the dashboard. No code change needed.
- Open item: the `username-password-signin` edge function must verify or forward the token itself before enforcement, or username sign-in will be rejected.

## Rollback and blocked state

Source rollback is a normal revert of the portal PR. Provider rollback is not executable until a
later binding packet captures exact preimages. The following remain blocked here: target project
environment values, Supabase Auth/provider settings, sender identity, domain/DNS attachment,
platform schema, global username writes, central user-number allocation, production deployment,
and any product-origin cutover.
