# Private operations reader

The account-origin session and read endpoints remain disabled until
`OPERATIONS_READER_ENABLED=true` and reviewed RPC installation, exact API exposure,
operator grant, deployment and account verification are complete. Source adoption
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
  nonanonymous identity. User metadata grants no access.
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
