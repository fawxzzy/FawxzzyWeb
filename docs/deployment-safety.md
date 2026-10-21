# FawxzzyWeb production deployment safety

## Current boundary

PR92 exposes a **pure observation validator**, not a release executor. Both
`npm run deploy:production` (including its former dry-run) and the verification
CLI fail before provider access. `--confirm-production`, a JSON frame, or a
reservation ID does not grant execution authority. The legacy recovery callback
API always holds before calling a callback. No Web module deploys, rolls back,
queries a provider, fetches a production URL, or writes a release receipt.

Canonical Ops owns native/policy validation, one retained writer claim, source
and executable checks, subprocesses, raw capture, durable journal, phase order,
acceptance and any separately authorized rollback. Its accepted fixture
consumers demonstrate source validation only. No installed supported live
release or rollback executor is accepted; native execution, trusted capture,
durable Windows recovery and the provider fence remain separate held gates.
The Web bridge does not satisfy them.

A separately reviewed source-only installation may install this fail-closed
boundary while production release remains intentionally frozen. There is no
supported Web deploy, dry-run or rollback command until the actual Ops
replacement is installed and admitted. Ready/merge require their own exact-head
source lifecycle checks, merge-composite proof and preserved source rollback;
they do not require claiming live replacement or product acceptance. Neither
source installation nor merge grants deployment. The committed Git deployment
switch must remain disabled, and CI must remain free of deployment effects.
External operator callers outside the inspected source remain unknown, not
migrated. Source preparation, installation, publication, deployment and actual
user acceptance remain separate gates.

## Destination and exact source

The read-only committed `vercel-production-contract.mjs` defines repository
`fawxzzy/FawxzzyWeb`, project `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV`, team
`team_CMJn7MvzFZZBnhNnjVUZF2RD`, and the three production aliases
`fawxzzy.com`, `www.fawxzzy.com`, `account.fawxzzy.com`. Local `.vercel` and
credentials remain ignored state; the bridge neither reads nor changes them.
The future Ops executor must verify the exact reviewed commit/tree, clean
source, successful exact-main push CI, installed dependency bytes, team/project,
complete aliases and known-good rollback before an effect. Production and
publication conditions are not satisfied by fixture success.

## Pure phase protocol

Fixed invocation: `node scripts/deploy-production.mjs --phase-bridge-stdio`.
It accepts one UTF-8 JSON object at EOF, optionally one trailing LF, bounded to
2 MiB and nesting depth 32. The wire encoding is canonical JSON: recursively
sorted object keys, no insignificant whitespace, JSON.stringify-compatible
string escaping, safe integer numbers only. Duplicate properties, alternate
encodings, invalid Unicode, unknown fields and extra frames fail with nonzero
exit, no stdout and fixed `HOLD_PHASE_VALIDATION_FAILED` stderr. Neither error
text nor a parser stack may reflect input. A leading UTF-8 BOM is rejected. Emit Python frames with sorted keys, compact separators and
`ensure_ascii=False`; all numeric observations must be safe integers.

Closed request keys: `schema`, `request_id`, `phase`, `manifest_sha256`,
`identity`, `observations`. Schema is `atlas.web.release-phase.v1`; request ID is
an ASCII identifier of at most 128 characters; manifest digest is lowercase
SHA256. Phases: `validate_candidate`, `validate_acceptance`,
`validate_rollback_readback`. No provider-effect phase exists. One canonical
response preserves schema, request ID, phase, digest and identity, plus
`status: VALID` and a semantic `result`. This response is **data validation**,
not authority, provider provenance or an installed release receipt.

Identity has exactly: `repository` (lowercase), `packetId`, `reservationId`,
`attemptId`, `commit`, `tree`, `teamId`, `projectId`, `productionAliases`,
`candidateDeploymentId`, `candidateUrl`, `rollbackDeploymentId`,
`rollbackCommit`, `rollbackTree`. All except the alias array are strings.
Candidate and rollback IDs differ. The manifest binds these values; Ops must
independently check that the selected Git commits really have the stated trees.

Project observations have `id`, `name`, `accountId`,
`productionDeploymentId`. Deployment observations have `id`, `url` (hostname),
`projectId`, `teamId`, `target`, `readyState`, `commit`, `tree`, `attemptId`
(null for the retained rollback). These are **normalized projections**: Ops must
produce and validate them from its captured provider/Git evidence. In
particular, a provider metadata echo is not proof of the executed source.
Aliases have the exact three `{alias, deploymentId}` entries and
`pagination: {next: null}`; Ops proves full capture before normalization.

Candidate bundle: `project`, `deployment`, `aliases`. Rollback bundle:
`project`, `rollbackDeployment`, `aliases`. Acceptance bundle adds the full
candidate and rollback observations, plus `smoke`, `account`, `legal`,
`privateApi`, `pendingApi`, `www`, `ranges`, `logs`, `finalProject`,
`finalAliases`. Route groups are complete ordered arrays from the exported
frozen route lists; each entry has `route`, `status`, `url`, `bodyDigest`. Digest is lowercase
SHA256 of the actual captured HTTP entity-body bytes after content decoding,
before UTF-8 or HTML normalization. Only the 13 account/legal/Projects records
also carry `html`; it is forbidden on other public route records. HTML must
roundtrip those same UTF-8 bytes, match its digest, fit 96 KiB raw and 112 KiB
JSON-encoded per body. This limits all 13 HTML strings to at most 1456 KiB
encoded, leaving room under the unchanged 2 MiB total frame bound. Private API
also binds its included minimal JSON body to `bodyDigest`; pending API, redirect
and range records carry a digest without body text. Digest format alone cannot
authenticate omitted bodies: Ops must compare every digest to its raw capture,
including non-HTML records, before invoking the bridge. Preserve
all canonical HTML, empty four-board/noindex, signed-out minimal denial,
wrong-origin/missing-cookie denial, redirect, exact byte-range, empty runtime
error counts and final target/alias predicates. Tests demonstrate complete
bundle construction and each closed shape. No credentials/private card payload
belong in a frame. All passed observations may still be forged by a caller;
Ops must reject frames not derived from its own exact captured operations.
Ops also verifies capture timestamps, actual clock and the action deadline; a
matching frame or digest cannot establish freshness.

## Remaining execution and recovery gates

Before a live release, Ops must independently admit and install its actual
native validator/executor, supported Windows durable write-once start, full
phase journal, candidate capture and same-reservation exclusion during waits.
The provider fence must be established separately; a target read followed by
an unconditional effect does not provide compare-and-swap. Canonical
cooperative exclusion does not prove exclusion of ungoverned provider writers.

The CLI rollback timeout only bounds observation: the provider action can
continue. Keep the claim on unknown effect, partial journal, missing candidate
or turn/target drift; never automatically replay deploy or rollback. A rollback
also disables production auto-assignment until a later promotion. Such a
promotion is a distinct authorized effect, not part of alias readback.
References: [rollback CLI](https://vercel.com/docs/cli/rollback#timeout),
[Instant Rollback](https://vercel.com/docs/instant-rollback).

## Source verification and rollback

Run `node --test scripts/test-production-recovery.mjs`, then `npm run verify`.
Fixtures use child-process, network and receipt-write traps; they do not access
a provider or demonstrate real deployment/user acceptance. Retain the prior
reviewed source commit/tree and exact five preimages for scoped source
rollback. Preserve unrelated work, local linkage, backups and canonical Root
index. Use existing verified worktree teardown; do not delete runtime evidence.
