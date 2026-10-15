import { digest, fields, hash, loadRuntime, reject } from './runtime.mjs';

const requestFields = ['correlation', 'registry_revision', 'redaction_revision', 'mapping_version', 'watermark',
  'observed_at', 'valid_until', 'contributions', 'snapshots', 'associations', 'projection'];
const uuid = (v) => typeof v === 'string' && v.length === 36 && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(v);

import { exactOrder } from './ordering.mjs';
export { exactOrder } from './ordering.mjs';

/** Internal preparation, not an authorization API or a public response. */
export async function prepareIngestion({ source, reconstruction, correlation, expected, now }) {
  const runtime = await loadRuntime();
  if (!uuid(correlation) || !Number.isSafeInteger(expected.generation) || expected.generation < 0
    || (expected.revision !== null && !digest(expected.revision))) reject('CONTROL_STATE');
  if (reconstruction.status !== 'ready' || reconstruction.generation !== expected.generation
    || reconstruction.revision !== expected.revision || !Array.isArray(reconstruction.observations)
    || reconstruction.observations.length > 256) reject('RECONSTRUCTION');
  const events = new Map(); const snapshots = new Map(); const associations = new Map(); const seen = new Set();
  let history = []; let total = 0;
  function entry(row, isEvent) {
    if (typeof row.body !== 'string' || hash(row.body) !== row.body_digest || !digest(row.digest)) reject('RETAINED_BODY');
    const envelope = runtime.parse(row.body); const proof = { digest: row.digest };
    runtime.verify(JSON.stringify(envelope), JSON.stringify(proof));
    if (envelope.producer_identity !== source.producer.producer_identity
      || !source.producer.admitted_revisions.includes(envelope.source_revision)) reject('RETAINED_PRODUCER');
    if (isEvent) {
      const order = exactOrder(envelope.payload.occurred_at);
      if (row.producer_identity !== envelope.producer_identity || row.event_id !== envelope.payload.event_id
        || row.occurred_at !== envelope.payload.occurred_at || row.order_seconds !== order.order_seconds
        || row.order_fraction !== order.order_fraction) reject('RETAINED_ORDER');
    }
    const map = isEvent ? events : snapshots;
    const key = row.digest;
    if (map.has(key) && map.get(key).body !== row.body) reject('RETAINED_COLLISION');
    if (!map.has(key)) map.set(key, { envelope, detached_source_proof: proof, body: row.body });
    return { envelope, detached_source_proof: proof };
  }
  function addAssociations(rows) {
    if (!Array.isArray(rows) || rows.length > 256) reject('ASSOCIATIONS');
    for (const a of rows) {
      fields(a, ['producer_identity', 'event_id', 'event_digest', 'snapshot_digest']);
      if (a.producer_identity !== source.producer.producer_identity || !digest(a.event_digest) || !digest(a.snapshot_digest)) reject('ASSOCIATIONS');
      const key = JSON.stringify([a.producer_identity, a.event_id, a.event_digest]);
      if (associations.has(key) && associations.get(key).snapshot_digest !== a.snapshot_digest) reject('ASSOCIATION_CONFLICT');
      associations.set(key, a);
    }
  }
  for (const observation of reconstruction.observations) {
    fields(observation, ['correlation', 'request_digest', 'raw_request', 'trust_receipt', 'outcome']);
    if (!uuid(observation.correlation) || seen.has(observation.correlation) || !digest(observation.trust_receipt)
      || !['committed', 'quarantined'].includes(observation.outcome) || typeof observation.raw_request !== 'string'
      || hash(observation.raw_request) !== observation.request_digest) reject('RETAINED_REQUEST');
    seen.add(observation.correlation); total += Buffer.byteLength(observation.raw_request);
    if (total > 8388608) reject('HISTORY_LIMIT');
    const request = runtime.parse(observation.raw_request); fields(request, requestFields);
    if (request.correlation !== observation.correlation || !Array.isArray(request.contributions)
      || !Array.isArray(request.snapshots) || request.contributions.length > 256 || request.snapshots.length > 256) reject('RETAINED_REQUEST');
    const batch = request.contributions.map((row) => entry(row, true));
    for (const row of request.snapshots) entry(row, false);
    history = runtime.journal(JSON.stringify(history), JSON.stringify(batch)).entries;
    addAssociations(request.associations);
  }
  if (seen.has(correlation)) reject('CORRELATION_ALREADY_OBSERVED');
  const eventRows = source.events.map((item) => {
    const e = item.envelope;
    return { producer_identity: e.producer_identity, event_id: e.payload.event_id, digest: item.detached_source_proof.digest,
      body: item.body, body_digest: hash(item.body), occurred_at: e.payload.occurred_at, ...exactOrder(e.payload.occurred_at) };
  });
  const snapshotRows = source.snapshots.map((item) => ({ digest: item.detached_source_proof.digest, body: item.body, body_digest: hash(item.body) }));
  const batch = eventRows.map((row) => entry(row, true));
  for (const row of snapshotRows) entry(row, false);
  addAssociations(source.associations);
  const policy = { mapping_version: source.policy.mapping_version, registry_revision: source.policy.registry_revision,
    redaction_revision: source.policy.redaction_revision, producers: [source.producer], redactions: source.policy.redactions };
  const projection = runtime.project(JSON.stringify({ history, batch,
    snapshots: [...snapshots.values()].map(({ envelope, detached_source_proof }) => ({ envelope, detached_source_proof })),
    associations: [...associations.values()], policy, now }));
  const observedMs = Date.parse(source.observedAt); const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs) || nowMs < observedMs
    || nowMs >= observedMs + source.producer.max_observation_age_seconds * 1000) reject('OBSERVATION_EXPIRED');
  const request = { correlation, registry_revision: policy.registry_revision, redaction_revision: policy.redaction_revision,
    mapping_version: policy.mapping_version, watermark: projection.source_watermark, observed_at: source.observedAt,
    valid_until: new Date(observedMs + source.producer.max_observation_age_seconds * 1000).toISOString(),
    contributions: eventRows, snapshots: snapshotRows, associations: source.associations, projection };
  const rawRequest = JSON.stringify(request);
  if (Buffer.byteLength(rawRequest) > 1048576) reject('REQUEST_LIMIT');
  return { rawRequest, requestDigest: hash(rawRequest), trustDigest: source.trustDigest, correlation,
    expectedGeneration: expected.generation, expectedHead: expected.revision,
    registryRevision: policy.registry_revision, redactionRevision: policy.redaction_revision,
    health: projection.health, projectionRevision: projection.projection_revision };
}
