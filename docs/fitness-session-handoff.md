# Fitness session handoff v1 (source preparation)

Status: active in source and pending the paired verified production release.
No database, provider, credential, or production changes are made by this
source candidate. Fitness owns the consumer and durable challenge store.
Socials owns the portal producer.

## Wire contract

1. After successful portal authentication, POST JSON `{returnTo}` to
   `https://fitness.fawxzzy.com/auth/session-handoff`, credentials included.
   The only permitted return paths are `/`, `/entry`, `/today`; others normalize
   to `/entry`. No queries, fragments, foreign origins or backslashes.
2. Fitness must first prove its active master Auth/data binding and a durable
   atomic store. Unknown readiness returns unavailable without cookies/CORS.
3. Fitness creates a random 32-byte browser binding and independent random
   32-byte ID (43 base64url characters), with a server-enforced lifetime <=60s.
   Store the binding hash, ID, exact portal origin, `fitness` audience, issuer
   `https://bxtcuhkotumitoqtrcej.supabase.co/auth/v1`, expiry and normalized path.
   Set `__Host-fitness-handoff`: HttpOnly, Secure, SameSite=Lax, Path=/,
   Max-Age=60, no Domain. Return exactly
   `{ok:true,handoffId,readiness:{authProjectRef,contractVersion,handoffStore,sourceCommit},returnTo}`.
   The readiness values must identify master project `bxtcuhkotumitoqtrcej`,
   contract `fitness.auth-handoff-readiness.v1`, store state `available`, and
   the exact reviewed Fitness merge approved by the portal source.
4. Portal retrieves the current session from its existing Supabase client,
   checks the expected user has not changed, then POSTs
   `{handoffId,accessToken,refreshToken}` to Fitness `/auth/session-sync`.
   The handoff does not explicitly call refreshSession or separately re-issue
   credentials. Normal SDK renewal during getSession remains allowed; forward
   the SDK-returned current pair unchanged. Do not copy it into UI state, log
   it, or put credentials in any URL.
5. Fitness validates exact origin and binding, atomically consumes the challenge
   once, validates and rotates the session pair against master, then writes its
   HttpOnly session cookies and returns exactly
   `{ok:true,returnTo,session:{accessToken,refreshToken}}` from the stored path.
   Fitness is the only rotation authority for this handoff. The portal validates
   the exact response and token bounds, confirms the returned access token still
   names the expected user, and persists that exact returned pair through its
   existing Supabase browser client. It must not call `refreshSession` or create
   another child pair before redirect, because both products must retain the
   same final refresh lineage.

Each portal handoff is bound to the current local Auth mutation epoch and a
same-origin cross-tab Auth generation. Sign-out, account mutation, or a newer
login invalidates the attempt before its shared session write. The portal checks the epoch and
expected user before accepting the consume result, again immediately before
local persistence, and again before navigation. The browser Auth storage adapter
also fences the exact returned access-token write, so an epoch change during the
SDK's internal user lookup rejects before storage or subscriber notification.
That last epoch comparison and browser-storage write are one synchronous step.
If durable browser storage is unavailable, ordinary Auth retains its in-memory
fallback while the cross-app handoff fails closed instead of redirecting with a
session that cannot survive navigation.
Local persistence is awaited to completion rather than raced against a timer,
so a rejected timeout cannot continue later and overwrite a newer session.

Fitness email confirmations are additionally bound to the browser that started
signup. The portal stores a one-use random state in that browser's same-origin
durable storage, includes the opaque state in the approved confirmation return URL, and
refuses to verify or hand off a forwarded Fitness confirmation when the state is
absent or different. The state is consumed before verification; a failed or
cross-browser attempt must start again.

Both POSTs use explicit JSON, credentialed CORS, no-store, no referrer, error on
redirect, a 10s request deadline and zero automatic retries. Invalid response
shapes, expired/replayed/mismatched challenges, invalid sessions, timeouts and
non-2xx responses, malformed or cross-user returned pairs, and verification or
local persistence failures fail
closed without a redirect. Users receive a safe connection error without token
details. A manual new attempt requires a new challenge, never replay.
Missing/blocked cookies must fail consume.

Both sides cap each token at 4,096 characters and the complete serialized JSON
request at 8,192 UTF-8 bytes, including field names and the challenge ID. The
portal checks these limits before sending the consume request; independent
per-token limits do not override the combined body limit. Fitness enforces MIME,
declared size and streamed size before invoking its store or Auth validator.

## Boundaries and acceptance

### Release dependency order

Before any Fitness production cutover, the deployed portal must accept the
candidate's exact merged commit in `FITNESS_HANDOFF_ACTIVATION`. Public login
rendering alone cannot prove this: the portal checks `readiness.sourceCommit`
before retrieving credentials. An unlisted candidate must block the release.

The six-source transition list includes reviewed Fitness PR198-201 merge
`0467722373da14760779392d94a212e3f10aac92` and retains current production rollback
`dbb63556d8b01b383dd61d326ce551635cb8b4d8` plus the four earlier accepted sources.
Release and verify this portal binding first, then stage and verify the exact
Fitness candidate before switching its canonical domain. Keep the prior portal
and Fitness deployment bindings until both acceptance observations pass.
This source list is not deployment or authenticated handoff acceptance.

Run `npx playwright test tests/e2e/fitness-handoff.spec.ts` against the local
build to cover all six accepted sources, unknown-source rejection before token
retrieval, and unchanged master/store/response constraints. Run `npm run verify`
for repository acceptance.

The portal is statically exported: do not invent a Next server route or a
Supabase provider mutation here. Fitness owns the real atomic consume adapter;
an injected in-memory fixture is not a deployable implementation. A boolean or
provider config value alone is not readiness proof. Cross-origin CORS must not
weaken Fitness's separate same-origin mirror or DELETE policy.

The portal starts only the credential-free handshake from
`https://account.fawxzzy.com`. Before the portal reads or sends a session pair,
Fitness must return the exact `fitness.auth-handoff-readiness.v1` object from
the live request. That object binds the reviewed deployed source commit, master
Auth project, and available handoff store. A legacy, non-master, malformed, or
unlisted-source response fails closed before credential retrieval. This includes
an unlisted rollback source. A reviewed retained rollback is accepted only while
its exact commit remains in the release allowlist; the master-project and
handoff-store checks still apply.
Local adapters never transmit synthetic credentials to live services. Website
and Mazer continuations remain unchanged by this Fitness-only activation.

Acceptance must cover native login and portal sign-in, Fitness cookie creation,
entry, first authenticated data read, navigation, refresh persistence and
sign-out on desktop and standalone mobile. Test replay, concurrent consumption,
expiry, denied cookies, hostile origins/returns, malformed results, and data
errors without session clearing. PR181 must actually be in the deployed Fitness
artifact; passing local tests is not a production outage fix.

Rule: dependency readiness gates runtime activation, not isolated source and
fixture preparation. Never report a disabled candidate as a working login.

## Joint durable-store integration

`tests/e2e/fitness-handoff-integration.spec.ts` joins the actual portal producer
to the Fitness-owned local receiver and persistent store. Set
`FITNESS_HANDOFF_INTEGRATION_ORIGIN` to an explicit `http://127.0.0.1:<port>`
fixture; other hosts, credentials, paths, queries and fragments are rejected.
The fixture must attest `fitness-handoff-local-integration-v1` synthetic mode
before any test sends the fixed synthetic session pair. No production request
override or activation is added to the application.

The integration tests cover begin-before-session retrieval, binding-cookie
transfer, returned-session persistence before navigation, missing binding, and
replay after success.
They are skipped when the fixture is absent; skipped tests are not acceptance.
Fitness's actual store tests must separately prove concurrent consume and
process-restart persistence. The fixture attestation alone is not proof of
durability. Even a passing local join does not prove real browser cookie policy,
master Auth validation, production backend installation or existing-user data
access; those remain explicit release acceptance requirements.

Supabase session retrieval reference:
https://supabase.com/docs/reference/javascript/auth-getsession
The retrieved pair is only transport input; Fitness must independently verify
the session, not trust browser-stored user claims.
