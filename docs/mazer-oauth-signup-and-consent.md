# Mazer OAuth: create-account entry and consent screen

Status: read-only feasibility and design note. It changes no behavior and grants
no commit, push, merge, provider, deployment, or production authority. Source
evidence is cited as `path:line` against `main` at the time of writing.

## Current flow

1. Mazer sends the browser to the provider authorization endpoint. The provider
   redirects to `/oauth/authorize?authorization_id=...` on the account host.
2. The host stores the identifier in the Secure, HttpOnly, host-only pending
   cookie, strips it from the address bar, and re-enters `/oauth/authorize`
   (`src/components/account/mazer-oauth-authorization.tsx:83-111`).
3. With no session, the host redirects to
   `/login?app=mazer&returnTo=%2Foauth%2Fauthorize`
   (`mazer-oauth-authorization.tsx:45-55,122`).
4. After sign-in the host returns to `/oauth/authorize`, rebinds the pending
   cookie to the new auth generation, reads the authorization, and shows the
   consent screen `Continue to Mazer?` (`mazer-oauth-authorization.tsx:128-172,251`).

The Mazer game cannot place a query parameter on step 3: the only value the
provider hands the host is `authorization_id`, and the host builds the login URL
itself. Whether the provider forwards any additional authorize-request
parameters to the host is UNKNOWN (not verified; no provider access used).

## Create-account entry: feasibility answer

The login page does not support landing on the create-account view from any
query parameter.

- `/login` renders `<AccountPortal mode="login" />` with no props from the URL
  (`src/app/login/page.tsx:20`). There is no `/signup` route; `src/app` has only
  `login`, `account`, `reset-password`, `auth/*`, and `oauth/authorize`.
- `LoginPanel` always starts with `useState<"login" | "signup">("login")`
  (`src/components/account/account-portal.tsx:316`). The only way to reach the
  `Create Account` view is the in-page toggle button (`account-portal.tsx:362`,
  rendered at `:569`).
- The query is read for exactly two keys on that page: `app` (single value only,
  `account-portal.tsx:112-119`) and `returnTo` (`:333-337`). `intent`, `mode`,
  and `signup` are not read anywhere under `src/`.
- `returnTo` is allowlisted by exact `pathname+search`
  (`src/config/account-return.ts:23-28,45-48`), so a `returnTo` such as
  `/oauth/authorize?intent=signup` is rejected and falls back to `/account`.
  A new parameter must live on `/login`, never inside `returnTo`.

Existing constraint that applies to the toggle path today: when the host is
reached through `/oauth/authorize`, the user can already create an account by
tapping `Create Account` on the login page. The signup request sets
`emailRedirectTo` to `/auth/confirm?app=mazer&returnTo=%2Foauth%2Fauthorize`
(`src/config/account.ts:162-186`, `src/lib/auth/browser-adapter.ts:299-320`). If
the provider issues a session immediately, the host navigates to
`/oauth/authorize` (`account-portal.tsx:410-428`). If email confirmation is
required (UNKNOWN: provider setting not read), no session is returned and the
user must open the emailed link in the same browser within the 15-minute pending
window (`src/lib/auth/mazer-oauth.ts:6`, cookie `Max-Age` in
`api/account/mazer-oauth-pending.ts:29,150`); otherwise the host shows
`This request cannot continue` and the user restarts from Mazer.

## Proposal (not implemented)

Smallest host-side change, in `LoginPanel` only:

- Parameter: `intent=signup` on `/login`, for example
  `/login?app=mazer&intent=signup`.
- Parsing: honor only the literal value `signup`, supplied exactly once
  (`getAll("intent").length === 1`), read after hydration like `app` and
  `returnTo`. Every other value or count keeps the `login` view. A user toggle
  after load overrides it. Derive the view as
  `chosen ?? requested ?? "login"` rather than seeding `useState` from
  `window`, to avoid an SSR hydration mismatch.
- Scope: presentation only. It selects which of two existing views renders. It
  selects no provider, callback, session, return target, or credential boundary,
  consistent with `docs/auth-surface-family.md` (Decision, bullet 4).

That alone is not enough for Mazer, because Mazer cannot inject the parameter
through the provider hop (see Current flow). Two ways to deliver it, ranked:

1. Recommended: a Mazer-initiated pre-step. Mazer's `Create account` opens
   `https://account.fawxzzy.com/login?app=mazer&intent=signup` (no `returnTo`,
   no authorization), then starts the normal authorization after the user comes
   back. This needs, beyond the parameter: (a) the Mazer `signup` success branch
   to navigate to the Mazer destination origin instead of only showing a notice
   (today only Fitness and the internal Mazer OAuth return navigate,
   `account-portal.tsx:410`), using the existing
   `sanitizeContextReturnTarget` fallback `https://mazer.fawxzzy.com/`; and
   (b) a Mazer-side marker so that, on return, Mazer starts authorization
   automatically. Because the account-host session then already exists, the next
   authorization skips the login hop and goes straight to consent (or to the
   provider redirect if consent was already recorded).
2. Only if the provider forwards extra authorize parameters: keep the existing
   flow and have the host carry `intent` from `/oauth/authorize` into the
   `loginDestination()` URL. This is unverified and rejected until the provider
   behavior is proven by an owner-run request.

Rejected: a parent-domain cookie shared by Mazer and the account host. It
contradicts the phase-one isolation rule that sessions stay separate across
account, Fitness, and Mazer origins (`docs/shared-account-portal-phase1.md`).

Survival of `returnTo` and the authorization across sign-up:

- `authorization_id` never rides in a URL after step 2; it stays in the HttpOnly
  pending cookie and is rebound to the new auth generation on return. It survives
  sign-up and same-browser email confirmation for at most 15 minutes. Option 1
  does not carry an authorization across sign-up at all; it starts a fresh one
  after sign-up, so confirmation delay cannot strand it.
- `returnTo` stays the exact string `/oauth/authorize` or is absent. The new
  parameter must not be added to `EXACT_INTERNAL_RETURN_TARGETS`.

Security considerations:

- Open redirect: no new redirect target is introduced. Post-sign-up navigation
  reuses `sanitizeContextReturnTarget`, which resolves only to the registered
  destination origin (`src/config/account-return.ts:82-97`).
- OAuth integrity: `state`, PKCE verifier/challenge, client ID, scope, and the
  exact redirect URI `https://mazer.fawxzzy.com/` are untouched; the host never
  sees Mazer's `state` or verifier before the code redirect, and the
  `sanitizeMazerOAuthApprovalRedirect` checks are unchanged.
- No token-bearing or identity-bearing value is placed in the new parameter, and
  `TOKEN_QUERY_KEYS` handling is unchanged (`account-return.ts:6-13`).
- Account enumeration: the signup success text is intentionally uniform
  (`tests/e2e/account-portal.spec.ts` asserts `safeAuthError("signup")` equals
  `safeAuthSuccess("signup")`); pre-selecting the view must not alter it.

Tests to add with an implementation: `/login?app=mazer&intent=signup` shows
`Create Account` with the username field; `intent=login`, `intent=SIGNUP`,
repeated `intent`, and no `intent` show `Welcome`; the toggle still works; an
`intent` inside `returnTo` is rejected; Mazer signup success navigates only to
`https://mazer.fawxzzy.com/` and, with the OAuth return, only to
`/oauth/authorize`.

Baseline with no code change (option C): keep the existing one-tap
`Create Account` toggle on the login page. It is functionally correct; it only
costs the user one extra tap.

## Consent screen `Continue to Mazer?`

Where it comes from: rendered by the host component
(`mazer-oauth-authorization.tsx:251` heading, `:256` Cancel, `:263` Continue).
It appears whenever the provider returns authorization details rather than a
redirect (`mazer-oauth-authorization.tsx:149-158 and 159-172`).

Can it be skipped with existing knobs?

- In this repository: no. There is no environment variable, flag, or registry
  field that suppresses consent. The only configuration the host reads for this
  flow is the provider URL/publishable key and `NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID`
  (`src/lib/auth/mazer-oauth.ts:260-264`, `api/account/mazer-oauth-pending.ts:205`).
  The gateway only reads the authorization and posts `approve` or `deny` to the
  provider consent endpoint (`api/account/mazer-oauth-pending.ts:215`).
- Existing skip path: if the provider answers the authorization read with a
  `redirect_url`, the host skips the screen and navigates straight back to Mazer
  after validating the exact redirect (`src/lib/auth/mazer-oauth.ts:191-192`,
  `mazer-oauth-authorization.tsx:149-158`; covered by
  `tests/e2e/account-portal.spec.ts:2300`, "accepts only a previously approved
  exact app redirect"). The source therefore supports a "consent only the first
  time" outcome. Whether the live provider returns `redirect_url` after a prior
  approval, and for how long, is UNKNOWN (not observed).
- Provider side: whether the provider offers a per-client "skip consent" or
  trusted/first-party client setting is UNKNOWN. It was not checked: no network
  or provider configuration was read for this note.
- Host-side alternative: auto-calling `approve` from the page would remove the
  user's consent decision for any client and would be a code change that
  weakens the consent gate. It is not recommended and is not proposed here.

Ownership: the OAuth client registration and any provider consent setting are
provider configuration and are owner-gated; nothing was changed or inspected.
Whether Mazer should be treated as first-party and skip consent is a product and
security decision for the owner (Zac). Any host-side behavior change would
additionally need an exact-head reviewed FawxzzyWeb change.

## Known documentation drift outside this note

`src/config/account.ts:76-77,125` and `tests/e2e/account-portal.spec.ts:223`
still describe Mazer `consumerIntegration` as `"pending"`. Only the Fitness
handoff reads this field (`src/lib/auth/fitness-handoff.ts:42`), so it is
currently presentation metadata for Mazer. Updating it is a code and test change
and is left to a separate reviewed change.
