# Private operations reader

This source adds standalone account-origin session and read endpoints without
changing the static site, public project board, or existing account flows.
It is disabled until `OPERATIONS_READER_ENABLED=true` and separately accepted
scoped connections, an operator grant, deployment, and account verification exist.
Publishing or merging these files does not activate a reader.

## HTTP contract

- Exact origin `https://account.fawxzzy.com`, exact endpoint paths, matching
  `Origin`, `X-Fawxzzy-Operations: 1`, no query, no body, and no navigation.
- `POST /api/operations/session` opens one session; an existing cookie returns
  409 and must be explicitly closed first. `DELETE` closes the current session.
- `GET /api/operations/read` returns the closed redacted projection contract.
  Every request carries the current user's bearer token. The exact master Auth
  `/auth/v1/user` validates it, then subject, session, issuer, audience, role,
  expiration and nonanonymous identity are checked. Metadata grants no access.
- Cookie `__Host-fawxzzy-operations` contains 32 random bytes, not a JWT.
  Set and clear use `Path=/; Secure; HttpOnly; SameSite=Strict`, without Domain.
  Expiry is at most 15 minutes and at most the access token's remaining lifetime.
  Only a domain-separated digest bound to verified subject and Auth session is
  sent to SQL. Account/session changes cannot use another identity's cookie.
- No automatic retry after an uncertain session write. Failure clears a possibly
  ambiguous local handle; no acknowledged session is invented. SQL validates the
  grant epoch and live Auth identity/session on every operation.

## Data and transport limits

Auth fetch: 3 seconds, 16 KiB streamed input, exact master URL, no redirects.
Database: fresh TLS connection with verified CA; 3-second connect/statement and
4-second query limits. Pinned `pg@8.23.1` receives at most 2 MiB cumulatively per
connection before its protocol parser. An instance-only `sslconnect` listener
wraps the TLS stream's `emit`; hook/order drift fails closed. No global patch.
The single-evaluation materialized read wrapper caps encoded JSON at 1 MiB;
the HTTP adapter independently validates that bound, every redacted card field,
unique identities, graph references, watermark and timestamps. SQL's internal
materialization is not claimed to be bounded by this transport cap.

Only healthy installed SQL state can return cards and an authoritative revision.
Stale, reconciling, incompatible and unavailable states must carry no cards,
watermark or revision. Actions remain disabled. Candidate source projection
acceptance is separate from installed SQL and consumer runtime acceptance.

## Least-privilege deployment dependency

Separate environment groups `OPERATIONS_READER_DB_*` and
`OPERATIONS_SESSION_DB_*` each specify `HOST`, `PORT`, `USER`, `PASSWORD`, `CA`.
The fixed pooler usernames are `platform_ops_reader_login.bxtcuhkotumitoqtrcej`
and `platform_ops_session_login.bxtcuhkotumitoqtrcej`; the backend SQL identities
omit the pooler project suffix. Existing capability roles remain NOLOGIN.
No URL, PG environment fallback, postgres or service-role credential is accepted.

Every connection audits both SQL user identities, dangerous role flags, required
membership, any extra membership, effective non-system routine EXECUTE, and all
user-table/sequence privileges. The only allowed routines are respectively
`operations_read(text)` or `operations_open_session(text,uuid,uuid,timestamptz)`
and `operations_close_session(text)`. PUBLIC/inherited privileges count.

**Current production prerequisite:** existing PUBLIC `net` capabilities require
a separately reviewed provider-supported ACL or fixed-operation transport remedy.
This source detects excessive access; it does not provision credentials, alter
ACLs, create grants, or pretend that a failed audit is remediation.

Errors use fixed public codes only; no provider exception, user ID, token,
cookie, private body or credential is logged. Focused synthetic tests run via
`npm run test:operations-consumer`, included in `npm run verify`.
