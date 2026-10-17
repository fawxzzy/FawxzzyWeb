# Private operations reader

The account-origin session and read endpoints remain disabled until
`OPERATIONS_READER_ENABLED=true` and reviewed RPC installation, exact API exposure,
operator grant, server-only `OPERATIONS_OWNER_SUBJECT` binding to the authorized
master Auth UUID, deployment and account verification are complete. Source adoption
alone does not activate a reader.

## HTTP contract

- Exact `https://account.fawxzzy.com` URL origin and paths,
  `X-Fawxzzy-Operations: 1`, no query/body/navigation. Session POST/DELETE require
  matching `Origin`. Read GET requires browser Fetch Metadata: `Sec-Fetch-Site:
  same-origin`, `Sec-Fetch-Mode: cors` or `same-origin`, and `Sec-Fetch-Dest: empty`.
  GET may omit `Origin`, as browsers normally do; a supplied value must match.
  Missing or malformed metadata denies even with matching Origin. These checks
  supplement bearer/live Auth and session authorization, never replace them.
- `POST /api/operations/session` opens; an existing cookie returns 409 and must be
  closed first. `DELETE` closes. `GET /api/operations/read` returns only the closed
  redacted projection contract. Actions remain disabled.
- Every request first validates the current user bearer at exact master Auth
  `/auth/v1/user`, then checks subject/session/issuer/audience/role/expiry and
  nonanonymous identity. The server-only owner subject must also match before
  any RPC access; another signed-in user is denied. User metadata grants no access.
- The opaque cookie contains 32 random bytes, never a JWT. Its attributes are
  `__Host-fawxzzy-operations; Path=/; Secure; HttpOnly; SameSite=Strict`, no Domain.
  Lifetime is at most 15 minutes and the access token's remaining lifetime.
  SQL receives only its domain-separated digest bound to verified user/session.
- Uncertain session writes are never retried. Failure clears an ambiguous local
  cookie and returns only finite error codes; private bodies and tokens are not logged.

## Fixed authenticated transport

After successful Auth validation, the server creates a per-request store using
the same bearer and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Only master
`https://bxtcuhkotumitoqtrcej.supabase.co/rest/v1/rpc/` is accepted, with
`Content-Profile: operations_api` and exactly `open_session`, `close_session`,
and `read` POSTs. No database password, new LOGIN, service-role key, custom URL,
schema override, PG environment fallback, or provider credential capsule is used.

Auth input is limited to 16 KiB/3 seconds. RPC responses are limited to streamed
1 MiB/3 seconds including stalled fetch/body waits, use strict UTF-8/JSON, and
reject redirects, unexpected status/content type and malformed acknowledgments.
The HTTP layer separately validates every display field, reference and timestamp.
Stale/reconciling/incompatible/unavailable views have no cards, watermark or
revision. Only a healthy installed projection can be authoritative.

## Database boundary and acceptance

The companion ATLAS package `private-operations-api-r001-20261015` creates only
three SECURITY DEFINER wrappers owned by existing `platform_ops_owner` NOLOGIN.
Authenticated receives only schema USAGE and these EXECUTEs. Private schemas and
`net` remain unexposed. Supabase owns the existing PUBLIC `net` grants and does not
support per-project revocation; ordinary Data API roles avoid provisioning a
broad direct database login. See the [provider constraint](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16).

The wrappers require trusted authenticator/PostgREST role context, exact master
JWT claims and JSON `is_anonymous: false`. They derive caller identity themselves,
check live Auth markers, and keep an exact caller-bound session row FOR UPDATE
through read/close. Direct RPC callers cannot use another identity's digest.
Open/read retain existing operator-grant checks; close can only revoke its own
live session and grants no access. Expired/revoked/missing rows deny.

The transactional installer/guarded rollback preserve private data, functions,
memberships and defaults. API exposure removal precedes rollback; drift and
external dependencies halt it. Local PostgreSQL role/claims simulation is source
proof, not genuine JWT/PostgREST or deployed runtime acceptance. Enablement awaits
those separate acceptance checks and current installation/exposure proof.

Run `npm run test:operations-consumer` (included in `npm run verify`). The historical
direct-PG foundation's parser/audit tests are superseded by fixed-RPC tests because
that credential transport has been removed, not waived.

Regression rule: Node-created Request objects can synthesize browser-forbidden
headers and conceal transport incompatibilities. The Chromium/WebKit
`operations-request-metadata.spec.ts` fixture sends real same-origin GETs through
the production guard with actual browser Origin/Fetch Metadata. Its URL, cookie,
Auth and store are synthetic; it does not establish genuine user acceptance.
See the [Fetch Origin rules](https://fetch.spec.whatwg.org/#origin-header).

The vendored `platform-runtime` subtree is hash-pinned to upstream bytes.
Repository `.gitattributes` forces LF checkouts only in that subtree, including
on Windows with `core.autocrlf=true`. Keep the pins intact; a line-ending mismatch
is a checkout failure, not permission to recompute hashes.

## Private account page

The visible `/projects` page now hosts a private-card observation alongside its
public board shell. On the exact account origin, verified sign-in starts one
reconciliation read. Only a definite missing-session denial may open one private
session and read again; an uncertain effect never retries. Signed-out and
non-owner callers see no private content. This is a short-lived card observation,
not canonical private board membership or an installed public sync. The former
`/operations` route redirects to `/projects` without rendering a second private
workspace or private server HTML.

The private reader connects only from the exact account origin using the
existing Auth adapter. Operator access still depends on server and database
checks; signing in alone does not grant it. The loopback-only `auth_test`
adapter is used for local browser fixtures; synthetic credentials are never
sent to a live provider. The Projects sign-in link uses the exact allowlisted
`/projects` return target on the account origin; other product contexts retain
their own return rules. The Projects view makes one current-session read after
verified sign-in. If that proves no session exists, it can open once and read
again. Other denial, uncertainty, or a nonhealthy projection stops the automatic
path. There is no polling, card write action, or reverse editor.

The request bearer exists only in its request closure,
not in UI state, logs, page URLs or application storage. Browser-generated
Origin/Fetch Metadata is used without header spoofing. Responses require bounded
strict UTF-8 JSON and the same display validator used by the server.

A healthy result is displayed for at most 60 seconds. Its timer only erases it.
Auth events (including same-user events),
generation changes, page hiding, pagehide, unmount, failed refresh and nonhealthy
results erase private cards. A new page visit or return after a healthy or expired
observation can make one automatic read for its current Auth generation. A denied
or uncertain result does not automatically retry on tab return. Expired work may
also be refreshed explicitly; there is no background polling. Cards render escaped
text. The Projects view does not
expose evidence handles, workflow write controls, or raw internal JSON.

Every asynchronous operation captures the user, a nonnull durable Auth
generation and a local event epoch. All three must still match at each await
boundary and before publication. A module-level gate serializes every HTTP
request across component remounts and identities: even a denied read can clear
the HttpOnly cookie. A JavaScript epoch fence cannot prevent a late Set-Cookie.
The gate therefore remains occupied until the actual transport settles, even
after the 10-second UI deadline. An uncertain result disables session mutations
until an explicit current-identity read reconciles it. Unsettled requests remain
held; a timeout never claims cancellation or success. This gate is a UI safety
measure; caller-bound SQL authorization remains the cross-subject boundary.

The controller tests cover delayed responses, A-to-B-to-A changes, passive Auth
events, null generation, remount, unknown acknowledgment, request/body timeout,
bounded parsing and observation erasure. Chromium and mobile WebKit fixtures
exercise the Projects route and legacy redirect with synthetic local requests. These fixtures do not
prove deployed availability or genuine signed-in operator acceptance.

Regression rule: validate a session's 204 acknowledgment by its zero byte body,
not `response.body === null`. Browser Fetch can expose an empty stream for 204
even though Node's Response constructor returns null. The Projects automatic-open
cases cover both Chromium and WebKit; direct tests also reject nonempty,
unexpectedly sized and stalled acknowledgments. See [Response body browser
behavior](https://developer.mozilla.org/en-US/docs/Web/API/Response/body).

The same rule applies to incoming session requests. A Vercel Web Handler can
receive a zero-byte POST or DELETE as a non-null stream. After validating the
exact origin, method and headers, the server proves EOF before reading
configuration, authenticating or calling the database. Any payload byte,
invalid framing, locked/consumed stream, abort, stream error, more than 16 empty
chunks or one-second deadline denies the request. Cancellation is never awaited.
Claimed `Content-Length: 0` alone cannot establish that the body is empty.
Loopback HTTP cases exercise incoming Node streams converted to Web Requests,
including empty POST/DELETE and nonempty or foreign-origin denial. Synthetic
Request constructors alone are insufficient transport coverage. See the
[Vercel Web Handler contract](https://vercel.com/docs/functions/functions-api-reference).
