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
- Sign-out reach (FF-ACCOUNT-004 W-2, dock half reversed 2026-11-15). The bottom "Sign out" button
  on the account page ends only THIS device's portal session (Supabase `scope: "local"`; owner
  decision 2026-11-15). Its result makes no claim about other devices or apps. Only the "Sign out
  everywhere" link below asks the provider to revoke the account's sessions everywhere (`scope:
  "global"`: every session and refresh token, so the portal, Fitness, Mazer and other devices can
  no longer refresh). Before 2026-11-15 the dock was global too, because a Fitness sign-out already
  behaves that way; Fitness's own sign-out is still global. For the global link, access tokens
  already issued stay valid until they expire, so anything that
  verifies them offline (rather than asking the provider) keeps working until then; whether Mazer
  notices a revoked session promptly is not verified. Local scope is also used to end the portal's
  own throw-away recovery session after "Save new password": choosing a new
  password does not sign the person out of the apps they are using. A sign-out the provider cannot
  complete (network, 5xx, rate limit) is reported as an error. Only a session another app already
  revoked (revoked or unknown refresh token, missing session) counts as signed out, never as a
  failure. Caveat: for an expired access token the SDK clears the local copy on any non-retryable
  refresh failure (a 429, a gateway 4xx) before the logout call can be sent; that case is reported
  as an error and the person signs in again before retrying, because the provider session may still
  be alive.
- Sign out everywhere (2026-11-15). The account page also has a "Sign out everywhere" link next to
  "Reset password". The first tap only asks, inside the one notice box ("Sign out on every device and
  app?" with a "Sign out everywhere" action; the link turns into "Cancel"); no browser dialog. The
  action calls the same `scope: "global"` sign-out, clears the owner hint and lands on the portal
  sign-in with "You are signed out on every device." (`/login?notice=everywhere`). A failure keeps
  the person signed in and shows "Changes are unavailable right now. Try again in a minute." The dock
  "Sign out" is local (this device only), so the link is the only way to end other devices from the
  account page. Reach per app, from source (not verified live): Fitness checks
  the user with the provider on each protected server render, so it notices on the next page load;
  Mazer reads only its cached session and has no `getUser()` revalidation, so it looks signed in until
  its access token expires and the refresh fails (provider default about an hour), and its database
  calls with the old token keep working until then. The host `/signout` endpoint stays `scope:
  "local"`. The remembered sign-in name stays on the device by design ("Not you?" clears it).
- Password-manager autofill (2026-11-15). Every account input sets `autocapitalize="none"`,
  `autocorrect="off"` and `spellcheck="false"`. Sign-in: `username` (email keyboard) and
  `current-password`, also when the name is remembered and locked. Sign-up: `username`, `email`,
  `new-password`. New password: two `new-password` fields plus a hidden, read-only `username` input
  holding the account email so managers update the right saved login. New passwords carry
  `minlength` and Safari `passwordrules` from the password policy (the forms are `noValidate`, so the
  portal's own checks still decide). Change steps: locked current name as `username`,
  `current-password`, then `email` for a new email and `off` for a new username (so the old saved
  name is not offered). No form asks for a typed code, so nothing uses `one-time-code`. Pinned by
  `tests/e2e/account-autofill.spec.ts`.
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
- Change username / change email (design point 12). The locked Username and Email rows on
  `/account` carry a pencil button. Step 1 re-enters the current password: a throwaway,
  non-persisting client signs in with the account email, the same security check as sign-in, and
  must return the same user id (a different account reads as a wrong password); the live session
  is never touched. Step 2 takes the new value, checked locally with the sign-up rules first.
  - Username: saved at once through `account_api.account_change_username` (rate limited in the
    database: 10 attempts per 15 minutes, 3 changes per 24 hours; same 2-15 character rule and the
    sign-up "That username is taken. Try another." line). The live `account_guard_username_claim` trigger stays
    the authority; `sync_username_signin_index` moves username sign-in to the new name in the same
    transaction. The session is refreshed so the page shows the new name, and a remembered sign-in
    name that was the old username follows it. Mazer profile names are not changed (see Mazer name).
    The SQL is owner-gated and lives in `supabase/proposed/` (not `migrations/`, so nothing applies
    it on merge) with its rollback and a pglite scratch test
    (`account_change_username_v1.scratch-test.mjs`). Until it is applied the call fails with
    PGRST202/42501 and the screen says "Changes are unavailable right now. Try again in a minute."
  - Email: `updateUser({ email })` with `emailRedirectTo` = the confirm route themed by `app`, with
    no product return (`accountEmailChangeUrl`). The provider sends the link to the NEW address; the
    old address keeps working until it is opened. An `email_change` confirm link always lands on
    `/account?notice=emaildone` (provider returned a session: done), `notice=emailhalf` (secure
    email change: the link at the other address must be opened too) or `notice=emaillink`
    (expired or used); it never goes through a product handoff. "We also told your old address"
    relies on the provider's "Email changed" notification being enabled and on the Send Email hook
    sending `email_changed_notification` to `email_data.old_email` (falls back to the account
    address when the payload has no valid `old_email`).
- Mazer name (MAZER-ACCT-047, 2026-11-19). Mazer's leaderboard shows `mazer.mazer_profiles.username`,
  a separate store from the sign-in username, and Mazer no longer lets a player edit it in the game.
  A "Mazer name" row (read through `mazer_profiles` RLS, own row only) appears under Username for
  accounts that have a Mazer profile or arrived with `app=mazer`; Fitness-only accounts never see it.
  In the Mazer context (`app=mazer`) the page shows ONE name row instead: the Mazer name, labelled
  "Username" (pencil, panel title and field labels also say username), and the sign-in username row is
  hidden; the two stores stay separate and the rename wiring is unchanged (display only, 2026-11-23).
  Every other context keeps both rows.
  Its pencil opens the same two steps as Change username: step 1 is the password re-check (the same
  `reauthenticate` call, Turnstile and `reauthFailure` copy); step 2 takes the new name, checked locally
  first (2-15 letters, numbers, dot, underscore or hyphen), then saved through
  `mazer.mazer_set_username(p_expected_user_id, p_username)`. A missing profile (P0002 /
  MAZER_PROFILE_MISSING) runs `mazer_ensure_profile` once and retries once. Errors map to plain
  lines: taken (23505) uses the sign-up "That username is taken. Try another." line, invalid (22023)
  the rules line, mismatch (28000) or an expired session the sign-in-again line, offline the offline
  line, 42501/403 or a missing backend "Changes are unavailable right now.", 429 the rate line, and
  anything else the save-failed line. No SQL or database change. Known gaps (owner-gated, need SQL): the
  password re-check is a client step, the database function does not demand it, and
  `mazer_set_username` has no server throttle (unlike `account_change_username`).
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
  The approved design asks for a username field when signed out; that path is live
  (`RESET_BY_USERNAME_LIVE = true` since 2026-11-15, see "Reset password by username" below), so
  the signed-out request takes a username and never an email.
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

## Reset password by username (design direction #9)

- Signed out, the reset request takes a USERNAME only, never a typed email. Every accepted request
  answers "If that username has an account, we sent a reset link to its email." whether the
  username exists, is unconfirmed, banned, deleted or unknown. No address, masked or not, is shown.
  Signed in, the locked account email stays as before.
- Server side: Edge Function `supabase/functions/username-password-reset` (pure logic in
  `handler.mjs`, Deno wiring in `index.ts`, `verify_jwt = false` in `supabase/config.toml`) calls
  `account_api.account_resolve_username_reset_v1` (proposal
  `supabase/proposed/20261115210000_account_username_reset_v1.sql`, service_role only). The SQL
  counts the request BEFORE it looks the username up, in `account_private.username_signin_attempts`
  under reset-only keys: 5 per (username, client) and 20 per client in 15 minutes, plus a shared
  reset row (100 per 15 minutes). There is no per-username lock, so nobody can lock another
  person out of reset.
- Silent send cap: only the first 2 requests per 15 minutes for one username from one client
  return the account (a request plus one resend). Requests 3-5 still get the normal answer, but the
  provider call goes to the decoy (below), so repeat clicks from one network do not mail the owner
  again. It is counted for unknown usernames too and does not touch the owner on another network. A
  per-username send cap across all clients was rejected: anyone could fill it with one request per
  window and silently stop the owner's own reset mail.
- Equal answers: the foreground does only the counting/resolve; the account read and the provider
  `/auth/v1/recover` call run after the answer is scheduled (`EdgeRuntime.waitUntil`), and every
  answer is padded to a 900 ms floor. Answers: 200 `{"status":"accepted"}`, 429 `reset_throttled`
  (Retry-After 900), 503 `reset_unavailable`, 400 `reset_invalid`. Only these reach the browser.
- One provider call per accepted request, hit or miss: the account's address when the username
  resolves to one that can receive mail, otherwise `DECOY_RECIPIENT`
  (`username-reset-decoy@fawxzzy.invalid`; `.invalid` is reserved and never delivers). A miss
  also makes the same account lookup (`DECOY_USER_ID`, an id no account has), so the call comes
  after the same work on both paths. This is what spends the caller's Turnstile token at the
  provider for unknown usernames too: once Supabase CAPTCHA is on, a replayed token fails the same
  way whether or not the username exists. With CAPTCHA enforced a bad token means no email but the
  same answer. Verifying the token inside the function (Turnstile siteverify) would need the
  Turnstile secret as a function secret; it is not wired and not needed for non-enumeration.
- PKCE: the browser stores the recovery code verifier exactly as supabase-js does
  (`src/lib/auth/recovery-pkce.ts`) and sends only the challenge; the function forwards it, so the
  email link is the usual `/reset-password?recovery=1&code=...` and the existing landing exchanges it.
  The redirect must be one of the four `accountRecoveryUrl` outputs (allowlist in the handler).
- Client address (`CLIENT_ADDRESS_SOURCE` in the handler): `cf-connecting-ip` if present, else the
  RIGHTMOST `x-forwarded-for` hop (the one the nearest proxy appends). Leftmost entries are caller
  controlled and never used; a unit test proves forged leftmost entries do not change the bucket.
  `username-password-signin` still reads the leftmost hop (follow-up, outside this change).
- Provider key: the function sends the new publishable key (`SUPABASE_PUBLISHABLE_KEYS`, `default`
  entry first) and falls back to the legacy `SUPABASE_ANON_KEY`. A non-JWT publishable key goes
  only in `apikey`; a legacy JWT key also goes in `Authorization`.
- Logging: one line per background send, `{"event":"username_reset_send","outcome":"2xx"}` (HTTP
  status class, `not_sent`, `network_error` or `schedule_error`). Never a username, email, address,
  token or user id. The body is read as a stream and cut off past 4 KB.
- Tests: `tests/username-password-reset.test.mjs` (equal answers/timing, one decoy call per miss with
  the same token and request shape, forged `x-forwarded-for`, log content, streamed body cap,
  provider key order, malformed requests, CORS, keys, PKCE format against the installed SDK), the
  pglite scratch test `supabase/proposed/account_username_reset_v1.scratch-test.mjs`
  (non-enumeration, limits and the send cap on the real SQL), and
  `tests/e2e/account-reset-username.spec.ts` (390x844 and 320x568).
- Accepted trade-off pending Zac (not fixed by design): anyone who knows a username can make the
  provider mail its owner from many networks (up to the provider's one mail per account per 60
  seconds and the shared 100 per 15 minutes), and each new mail replaces the owner's earlier reset
  link; and a flood from many networks can fill the shared 100-per-15-minutes row, pausing reset by
  username for everyone for up to 15 minutes (the 429 answer is the same for every username). A
  per-username cap would stop the first but lets a stranger block the owner's reset, which is worse
  on the only signed-out reset path.
- Owner go-live order (each step required):
  1. Apply the SQL (approve by sha256; rollback
     `supabase/proposed/20261115210000_account_username_reset_v1.rollback.sql`).
  2. Check no auth user has the email `username-reset-decoy@fawxzzy.invalid` or the id
     `00000000-0000-4000-8000-000000000000`.
  3. Deploy the function `username-password-reset`.
  4. Prove which client-address header the platform sets: one request with a forged
     `x-forwarded-for` (for example `1.2.3.4, <your address>`) must land in the same counter bucket
     as one without it (the per-client counter row increments, no new row). If the runtime sets
     neither header as described, stop and fix `CLIENT_ADDRESS_SOURCE` first.
  5. One request from the account origin returns `{"status":"accepted"}`, a known test account gets
     the email, and the function log shows `username_reset_send` with outcome `2xx` for both a known
     and an unknown username (a decoy call answered 4xx means the provider rejects the decoy
     address: fix that before going live. The token is still spent, since the provider checks
     CAPTCHA before the recover handler runs, but the decoy would then differ from a hit in the
     provider's own logs and its rate counters).
  6. If Supabase CAPTCHA is on: replay one used Turnstile token at `/auth/v1/recover` after a reset
     request for a known and for an unknown username; both replays must fail the same way.
  7. Set `RESET_BY_USERNAME_LIVE = true` in `src/config/account.ts` and ship. Done 2026-11-15
     (steps 1-6 passed the same day; the signed-out reset now takes a username).
  Rollback: set the flag back to false (the email form returns), then delete the function and run
  the rollback SQL.

## Turnstile CAPTCHA (FW-CAPTCHA-001)

- Sign-in, sign-up and the password-reset request form carry a Cloudflare Turnstile widget. The public site key is in `src/config/turnstile.ts`; the secret is never in the repo.
- Each request sends `options.captchaToken` (email sign-in, sign-up, reset) or a `captchaToken` body field (username sign-in edge function). Supabase ignores the token while CAPTCHA is disabled, so this is dark-safe.
- The Cloudflare script loads only on the account origin, after the page settles, never on marketing pages. The widget is interaction-only and is reset after every attempt. If it cannot load, a short note shows and the request still goes out (the server rejects it once enforcement is on). A submit waits at most 4 seconds for an in-flight check.
- The site sets no CSP today. If one is added, allow `https://challenges.cloudflare.com` in script-src, frame-src and connect-src.
- Enable order: (1) this widget live in Web AND Fitness; (2) turn Supabase Auth CAPTCHA ON (owner pastes the Turnstile secret in the dashboard); (3) verify sign-in, sign-up and reset on the account origin. Rollback: turn CAPTCHA off in the dashboard. No code change needed.
- Open item: the `username-password-signin` edge function must verify or forward the token itself before enforcement, or username sign-in will be rejected.

## Delete account (proposed SQL, owner-gated, not applied)

### Delete account v2 (supersedes v1, 2026-11-16)

v1 (`20261115200000_account_delete_self_v1.sql`) was never applied: its preflight refused the live
database (37 unlisted account columns, 2 unlisted foreign key effects, 2 DELETE triggers). v2
(`20261116090000_account_delete_self_v2.sql`) keeps v1's API, contract and checks (everything below
this subsection still holds, with `delete_account_v2` in place of `delete_account_v1`) and adds:

- **Owner decision (Zac, 2026-11-16): "Delete live data, keep archives".** The call deletes the live
  rows and the `auth.users` row. Archive, backup and migration tables are kept on purpose, listed one
  column at a time; a new account-shaped column anywhere else still refuses the apply
  (`UNKNOWN_ACCOUNT_COLUMNS`, also for TEXT columns named like `*_fitness_user_id` / `*_auth_user_id`).
  The project has no point-in-time recovery and no listed backups. The last step says "Sign-in logs
  and backups may keep some data for a while."
- Retained (the call never touches these; row counts are the 2026-11-16 preimage, total / naming a live
  account). No retention schedule exists for any of them (owner item):

  | Table (column) | Holds | Rows |
  | --- | --- | --- |
  | `account_private.username_collision_resolution_backup`, `username_shorten_backup` (`user_id`) | id + original username/metadata | 3/3 each |
  | `atlas_identity_migration.packet_rollback` (`user_id`) | id + email | 107/107 |
  | `atlas_identity_migration.source_identity_map` (`canonical_user_id`, `source_user_id`) | ids | 119 (114 / 4 live) |
  | `atlas_identity_migration.mapping_wave2_rollback` (`before_canonical_user_id`, `source_user_id`) | ids | 2/0 |
  | `atlas_migration_auth_data_r001.identity_map` (`canonical_auth_user_id`) | ids | 108/107 |
  | `atlas_migration_auth_data_r001.private_auth_payload` (`canonical_auth_user_id`) | id + auth payload (email) | 216/214 |
  | `fitness_archive.*` (19 columns: pre-move copies of the Fitness tables) | workout/billing/Discord copies | 0 live (112 `exercise_stats`, 4 billing) |
  | `mazer.mazer_identity_map` (`legacy_user_id`, `master_user_id`) | ids | 20 (6 / 20 live) |
  | `mazer.mazer_register_all_backfill_20261112` (`user_id`) | ids | 110/110 |
  | `mazer.mazer_username_backfill_20261112` (`user_id`) | id + username | 8/8 |
  | `platform_private.operations_operator_grants`, `operations_sessions` (`subject`) | operator ids, session times | 1/1, 15/15 |
  | `atlas_mazer_r017` auth/master preimages, `identity_wave2_rollback` | emails/usernames in JSON/text, no uuid column (not swept) | not counted |
  | GoTrue `auth.audit_log_entries` | email + id in payload | 0 |

- Also deleted: `mazer.mazer_register_failures` (Mazer sign-up setup failure diagnostics).
- Unlinked: `discordos.discord_feedback_reports.reporter_fitness_user_id` (a TEXT copy of the account
  id) is set to null; the Discord handle and text stay (0 live rows on 2026-11-16), like the Fitness
  Discord tables.
- Deliberate foreign key effects, checked by the preflight and counted by the call: `auth.users` delete
  CASCADES to `account_private.username_signin_candidates` (derived sign-in rows; 102/102 rows) and SETS
  NULL `platform.identity_map.auth_user_id` (the identity row and anything keyed on `identity_id`, such
  as `platform.work_projects`, stays). The apply refuses if either key is missing, has another action or
  is itself referenced; the call raises `ACCOUNT_DELETE_FK_EFFECT_INCOMPLETE` if a row still names the
  account afterwards.
- Also cascaded (2026-11-24 source edit, optional until the Mazer feedback SQL v2 is applied):
  `mazer.mazer_feedback.user_id` (`NOT NULL`, `ON DELETE CASCADE`; the in-game feedback table, source in
  the Mazer repo at `docs/ops/sql-proposals/mazer-feedback-20261124-v2/`). It is listed in `fk_effects`
  so a re-apply of this file does not abort on an unlisted key to `auth.users`; the preflight skips it
  only while the table does not exist. The live function body is not changed by this edit: the live
  call already removes those rows through the cascade, and a re-apply would also count them in the
  audit row as `mazer.mazer_feedback(cascade)`.
- Reviewed triggers, pinned by table, trigger, function, md5 of the live body and trigger type (bodies
  in `account_delete_self_v2.live-bodies.json`, read-only from the live database): the Fitness position
  repack triggers on `routine_day_exercises` and `session_exercises` (AFTER DELETE FOR EACH ROW, not
  security definer, scoped to the same account and parent; the call deletes all of an account's rows
  per table in one statement, so they have nothing left to move), the sign-in index sync on
  `auth.users` and the `updated_at` trigger on `discordos.discord_feedback_reports`. Any other trigger
  that fires on a delete or unlink here refuses the apply and is re-checked on every call. `auth.users`
  also has three INSERT-only triggers (`account_guard_username_claim`,
  `mazer_claim_signup_username_after_insert`, `mazer_register_user_after_insert`); they never fire on a
  delete.
- Known drift (owner item): the live `account_private.sync_username_signin_index()` body (md5
  `b9b39b13...`) is not the repo migration's (`20260826163000`); the live one also maintains
  `username_signin_candidates`. No repo holds the live body. v2 pins the live one.
- Known Fitness bug (not changed here): the repack triggers renumber with a data-modifying CTE and an
  outer UPDATE of the same rows, so deleting a single exercise leaves later positions negative (live:
  25 `session_exercises`, 9 `routine_day_exercises`). The scratch test reproduces it.
- Locked vs changed: each delete or unlink compares its row count with the rows locked for that table;
  more raises `ACCOUNT_DELETE_ROWCOUNT_EXCEEDS_LOCKED` and rolls back (a row committed between the lock
  and the delete under READ COMMITTED).
- Time limits: the inner function sets `lock_timeout = 3s`; the API wrapper sets `statement_timeout =
  30s`, which PostgREST applies for that call instead of the authenticated role's 8s. The largest live
  account (23,991 Mazer receipts, 923 sets) is estimated at 2-4s from the plan; a real delete is not
  timed (UNVERIFIED).
- Storage check also considers FORCE row level security.
- Files (`supabase/proposed/`): `20261116090000_account_delete_self_v2.sql`, `.rollback.sql`,
  `.preimage.sql` (one read-only SELECT; passed against live 2026-11-16 with nothing blocking),
  `account_delete_self_v2.live-bodies.json` (trigger bodies), `account_delete_self_v2.scratch-test.mjs`
  (pglite, with the live-like schemas, keys and the live trigger bodies). The v1 files stay, marked
  superseded. pglite runs as a superuser, so the force-RLS and no-BYPASSRLS preflight branches are
  reviewed, not executed.

### Base contract (from v1, still true for v2)

- Live since 2026-11-16: the row shows when `DELETE_ACCOUNT_LIVE` (`src/config/account.ts`) is true. v2 was
  applied and dry-run proven that day (immediate delete, no undo; accounts with billing rows get the support
  answer), then the flag was set to `true`. Rollback: set it back to `false`; with the flag off the account
  page is the same as before this feature. Local fixtures (`auth_test`) show the row, except
  `auth_test=delete-off`.
- Where: the last row on `/account` ("Delete account", danger style, trash button). Steps: (1) the current
  password, checked on a throw-away in-memory client whose fresh session is KEPT only while the screen is
  open; (2) type the username (or the email when the account has none), trimmed and any case; (3) one
  plain-words screen of what is deleted (profile, username and sign-in; Fitness workouts, routines and
  history; Mazer progress and high scores, which are its leaderboard entries), one line that Discord
  feedback and moderation records stay without the account link, one line that sign-in logs and backups
  may keep some data for a while (GoTrue's `auth.audit_log_entries` and the retained archives above, not
  touched; their retention is UNKNOWN here), and that it cannot be undone; its red dock deletes. Then
  `/login?notice=deleted` with "Your account was deleted." (it does not claim every trace is gone).
- Server: `account_api.account_delete_self(p_confirm text)` (authenticated only) calls the private
  `account_private.delete_account_v2` (v1: `delete_account_v1`). It checks the password proof (below), then the rate limit, the
  typed text, billing and the support cases, then deletes every listed Fitness, Mazer and
  `account_private` row and the `auth.users` row in ONE transaction (sessions, refresh tokens and
  identities cascade: sign-out everywhere). Answers: `deleted`, `gone` (already deleted, idempotent),
  `reauth`, `confirm`, `billing`, `support`, `rate`.
- What the password proof really is: the SQL never sees the password. It accepts a JWT whose `amr` has a
  password sign-in from the last 10 minutes and whose `session_id` is still live in `auth.sessions` for
  the same user. That proves "a password sign-in in the last 10 minutes on a live session of this
  account", NOT "the password was typed just now": any token of that session passes, including a
  refreshed one if GoTrue keeps the original `amr` timestamp on refresh. Owner dry run before turning the
  row on: sign in with a password, refresh the session, decode the refreshed access token and confirm its
  `amr` entry is `password` with the ORIGINAL sign-in time; then call with a token older than 10 minutes
  and confirm `reauth`.
- Rate limit: 5 refused calls per 15 minutes per account, counting ONLY calls that passed the password
  proof (`confirm`, `billing`, `support`). A `reauth` refusal writes nothing, so a token without a fresh
  password sign-in cannot block the person from deleting.
- Support refusals: the account holding the reserved Fitness member #0 profile (`user_number = 0`, the
  owner's own account; Fitness migration 20260718015422 requires exactly one) is never deleted here; and
  if any row of ANOTHER account points at a row this call would delete (for example another account's
  `exercise_stats` or `progression_events`, whose keys to `exercises` are ON DELETE CASCADE, on this
  account's custom exercise), the call refuses instead of deleting the other account's rows. The check
  reads every foreign key between the listed tables at call time. Right before it, the call locks this
  account's rows in every table it deletes from (`SELECT ... FOR UPDATE`): another session's foreign-key
  check on insert takes `FOR KEY SHARE` on the row it points at, which waits on that lock, so no row can
  start pointing at this account's rows between the check and the deletes. A file in Storage owned by
  the account (`storage.objects.owner` uuid or `owner_id` text) also refuses (`support`).
- A key from a table outside the list can only be NO ACTION/RESTRICT (the preflight refuses the rest). A
  row behind one makes the call fail with 23503 (or 23001) and roll back; the portal shows the same
  "This account cannot be deleted here. Contact support." line as `support`, never "Try again" (a
  retry can not succeed).
- Time limit: the call runs inside one API request. v1 relied on the authenticated role's
  `statement_timeout` (8s live); v2 sets its own (see above). A very large account that hits it fails
  with nothing deleted; the owner deletes it by hand.
- Audit: one row in `account_private.account_deletions`: a PLAIN sha256 of the fixed public prefix
  `fawxzzy-account-delete-v1:` plus the user id (not salted: anyone with the uuid can recompute it, so
  the row is pseudonymous and re-identifiable from a known uuid), the time, per-table row counts and the
  version. No email, no username. Kept on rollback.
- Decisions (owner can reverse): immediate delete, no grace period, no undo, no deleted-account store;
  billing blocks deletion (support handles refunds and records); Discord feedback reports and moderation
  cases keep their row (Discord ids and text) with the account link cleared; Discord-only rows keyed by a
  Discord id (for example Spotify connections) are not touched; another account's rows on this account's
  custom exercise block the delete (`support`).
- **There is no recovery.** The project has no PITR and no listed backups (2026-11-16), so deleted rows
  cannot be restored. The rollback SQL removes the API, not the deletions.
- v1 files (superseded, kept for the record; never apply): `20261115200000_account_delete_self_v1.sql` (apply, after change
  username v1), `.rollback.sql`, `.preimage.sql` (one read-only SELECT: run it right before the apply and
  compare with what the preflight expects: every manifest table exists with a uuid column, no unlisted
  account columns, no cascade or set-null key from an unlisted table, the triggers on the listed tables
  and `auth.users`, which schema holds each listed table (the Fitness repo's migrations say `public`,
  production uses `fitness`), the reserved #0 count, other accounts' references to custom exercises, the
  largest per-account row counts against the statement timeouts, postgres privileges and RLS bypass, no
  storage objects with an owner or owner_id, the live foreign keys to `auth.users`, GoTrue audit log
  size), `account_delete_self_v1.scratch-test.mjs` (pglite: proves only that account's rows go, across
  schemas, that another account's cascading rows are never deleted, and that the call locks only this
  account's rows before the check; pglite has one connection, so a concurrent insert is not raced).
- Short screens (max-height 600px): the account page hides its lead line so the three rows, notice slot,
  links and dock still fit at 320x568 with wide Linux fonts. Copy never says "leaderboard" (pinned by
  `tests/username-signin-lockout.test.mjs`); the list says "Mazer progress and high scores".
- Until applied: the row is hidden (flag off). If the flag were turned on before the SQL, the last step
  would show "Deleting is unavailable right now. Try again in a minute." and delete nothing.
- Known gaps: access tokens already issued stay valid until they expire (about 1 hour). Fitness server
  actions re-check with `auth.getUser()` (fails for a deleted user). The Fitness migrations declare keys
  to `auth.users` only on `profiles` (002), `discord_verification_tokens` (054),
  `discord_member_links` (055), `discord_feedback_reports` (057/059) and `discord_moderation_cases`;
  a write to those after the delete fails its key check. The workout tables (`sets`, `sessions`,
  `routines`, `exercises`, `exercise_stats` and the rest) declare none, so a direct browser write to them
  in that window could leave an orphan row. Which keys are live in production is UNKNOWN from source; the
  preimage's `foreign_keys_to_auth_users` reports it. Mazer tables key to `auth.users` (cascade) and
  Mazer re-checks with `getUser`/`getClaims` on its account check.

## Rollback and blocked state

Source rollback is a normal revert of the portal PR. Provider rollback is not executable until a
later binding packet captures exact preimages. The following remain blocked here: target project
environment values, Supabase Auth/provider settings, sender identity, domain/DNS attachment,
platform schema, global username writes, central user-number allocation, production deployment,
and any product-origin cutover.
