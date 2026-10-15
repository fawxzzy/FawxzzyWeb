# Private operations ingestion

This source connects immutable repository retrieval, the reviewed Platform
projection, complete retained history and the R002 transactional storage contract.
It is host-only code. It adds no route, timer, database installation, credential,
operator grant, OAuth client or production activation.

## Trust and deployment contract

`scripts/operations/ingest-once.mjs` requires the existing ATLAS executor to supply
six live callbacks: `assertPreflight`, `readPolicy`, `readControlState`, `admitRequest`,
`assertEffectBoundary` and `recordTerminal`. That adapter must validate canonical admission, lease, exact
executable/lockfile hashes, policy pins, target, correlation and current ownership
before credential access. It must independently admit the exact request digest,
head generation, source trust receipt and expiry through the policy-admin role.
The policy-admin connection also reads control state; R002 does not grant that
helper to the ingestor. The ingestion login cannot perform admission. Callback interfaces alone are
not proof that the canonical scheduler is connected. Live host wiring, independent
action-time review and settlement/restart acceptance remain deployment work.

Only the existing master `bxtcuhkotumitoqtrcej` is a deployment target. The proposed
pooler login is `platform_ops_ingest_login.bxtcuhkotumitoqtrcej`; it is not claimed
to exist. Structured connection settings require TLS certificate verification,
an explicit CA, bounded timeouts and no privileged role memberships. Do not supply
service-role credentials, connection strings or browser-accessible settings.

The trusted host pins the private Socials repository, numeric ID `1301080630`.
Only its fixed `api.github.com` repository paths are fetched; public visibility
is refused. Platform remains the independent policy owner, but its public
contract repository must never hold private runtime display-policy content. Redirects, changed repo
identity, non-main lineage, symlinks/submodules/executable files, truncated trees,
duplicate paths, unexpected types, oversized bytes and blob/hash drift fail closed.
Payload JSON uses the pinned duplicate-key-rejecting parser and full schemas.
A single monotonic 60-second whole-read deadline covers runtime loading, token
acquisition, metadata, comparisons, blobs and body consumption. Every active
request shares its abort signal; at most 600 requests are permitted. The trusted
host may shorten the deadline, never extend it. There are no transport retries.

Publication commit and payload source revision are separate pins: a manifest
cannot embed the hash of the commit containing itself. The payload revision must
be an admitted ancestor of the immutable publication commit; that publication
must remain in main's lineage. Every historical admitted revision is checked in
the same repository. No source ref is accepted from a browser or a producer URL.

## Producer and independent policy artifacts

Socials must publish `operations/export/manifest.v1.json` with exactly:

```text
schema = platform.operations-source-manifest.v1
producer_identity = github-repository:1301080630
source_revision = admitted payload revision
complete = true
files = [{path, kind, blob, sha256, digest}]
associations = [{producer_identity, event_id, event_digest, snapshot_digest}]
```

Files are plain JSON envelopes under `operations/export/events/` or `snapshots/`.
Each has an exact Git blob SHA1, raw-byte SHA256 and detached contribution digest.
At most 256 files, 256 associations, 256 KiB per file and 768 KiB aggregate are
accepted. Empty coverage requires an explicitly complete manifest; this initial
producer denominator is not full ATLAS or archived-work acceptance.

Platform independently approves the policy and holds it in the canonical host's
private, Git-excluded runtime store. Public Platform/ATLAS repositories contain
only code and contracts. No producer response or caller path chooses policy.

Policy pins have exactly `kind: host-private-v1`, `sha256`, `registryRevision`,
`redactionRevision`, and `approvalReceiptSha256`. Revisions are 40-hex contract
identities; they are not assumed to be Git commits. The full SHA256 pins exact
bytes. Legacy public-Git policy pins fail closed.

`gate.readPolicy` must validate the independently completed native approval's
origin, Platform ownership, exact scope, policy SHA256/revisions and current
canonical admission. It resolves only the host's fixed private content-addressed
store, rejects symlinks/reparse paths and drift, and returns bounded bytes plus
the independently validated approval-receipt digest. The adapter checks both
hashes and closed structures. A callback echoing a supplied digest is not proof
of approval. `assertEffectBoundary` must recheck this exact binding before effect.
The source adapter is unusable for live intake until this canonical host
implementation is independently verified; no no-op or environment-flag gate is
an acceptable replacement. The shared 60-second deadline begins before policy
acquisition and includes policy validation, source credentials and retrieval.

The policy body has exactly `schema` (`platform.operations-redaction.v1`),
`registry_revision`, `redaction_revision`, `mapping_version`,
`max_observation_age_seconds` and `redactions`. Dispositions bind exact snapshot
digests to independently reviewed display fields. Neither producer content nor
a source title approves its own display. Source trust receipts retain hashes and
revisions only; policy bytes and evidence locators remain private. Operator grants,
policy/control installation and live consumer acceptance remain separate work.

## Reconstruction and effect semantics

The canonical gate obtains control state and the store obtains the generation-bound R002 reconstruction.
Every retained request and body hash, producer/revision, exact ordering key and
association is revalidated. Accepted and quarantined observations both remain in
history; conflicts cannot disappear after restart. Reconstruction limits return a
hold, never a partial/empty archive. The candidate projection retains its explicit
`authoritative: false` and `actions_enabled: false`; storage/private-reader runtime
acceptance is a separate contract.

Only the newly observed envelopes enter the next SQL request. The projection is
rebuilt from complete retained history plus that batch. Event time uses integer
Gregorian seconds and fractional digits, never rounded JavaScript milliseconds.
Observation freshness uses host time after successful source retrieval.

Exactly one same-client transaction calls `operations_ingest`. An unacknowledged
COMMIT triggers one correlation-and-digest settlement read. Missing or failed
settlement is `unknown`, never permission to retry. Terminal receipts contain
identities and states only. Source bytes and credentials are not user responses.

## Pinned dependency custody and checks

The `platform-runtime/` subtree preserves eleven original modules/schemas at
Platform commit `c60bb451eba9c08f0b3435faadb93ef5da5e0d36`, their hash manifest and
the upstream lockfile. Web's lockfile pins its actual runtime dependencies. The
host's executable admission must seal this entire closure and both lockfiles.
Run `npm run test:operations-ingest`, then `npm run verify` under Node 24. Synthetic
transport/storage tests do not prove GitHub credentials or master installation.

Failure mode: accepting producer-supplied redaction or discarding prior conflict
history can turn valid-looking hashes into a false healthy projection. The fixed
private-producer/independent-policy intake and full-history tests are the prevention contract. Keep
these rules in this runbook and its tests when adding another producer.
