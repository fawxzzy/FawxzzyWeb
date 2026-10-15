import { createHash } from 'node:crypto';
import { parseCandidateOperationsJson } from './development-operations-json.mjs';
import { canonicalizeOperationsJson } from './development-operations-digest.mjs';
import { verifyCandidateOperationsContribution } from './development-operations-contribution.mjs';
import { appendCandidateOperationsJournal } from './development-operations-journal.mjs';

const mapping = 'socials-card-snapshot:v1';
const cardSchema = 'socials-os.development-card.v1.schema.json';
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;
const utf8 = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const raw = JSON.stringify;
const key = (...parts) => raw(parts);
const stableId = (producer, id) => `card:${Buffer.from(producer, 'utf8').toString('base64url')}:${id.slice(5)}`;

function reject(code) {
  const error = new TypeError(`Candidate operations projection rejected: ${code}`);
  error.code = `ERR_OPERATIONS_PROJECTION_${code}`;
  throw error;
}
function fields(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}
function text(value, max = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}
function exact(value, pattern, length) { return typeof value === 'string' && value.length === length && pattern.test(value); }
function uniqueStrings(values, check) {
  return Array.isArray(values) && values.length <= 256 && new Set(values).size === values.length && values.every(check);
}

// Proleptic Gregorian seconds plus an arbitrary-precision decimal fraction.
// Never round through Date, floating point milliseconds or a database timestamp.
function instant(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})(?![\s\S])/u.exec(value);
  if (!match || match[8] === '-00:00') return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > months[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  let offset = 0;
  if (!/^[Zz]$/u.test(match[8])) {
    const hours = Number(match[8].slice(1, 3)); const minutes = Number(match[8].slice(4, 6));
    if (hours > 23 || minutes > 59) return null;
    offset = (hours * 60 + minutes) * (match[8][0] === '+' ? 1 : -1);
  }
  const y = BigInt(year);
  const days = y * 365n + (y + 3n) / 4n - (y + 99n) / 100n + (y + 399n) / 400n
    + BigInt(months.slice(0, month - 1).reduce((a, b) => a + b, 0) + day - 1);
  return { seconds: days * 86400n + BigInt(hour * 3600 + minute * 60 + second - offset * 60), fraction: (match[7] ?? '').replace(/0+$/u, '') };
}
function fractionOrder(a, b) {
  const length = Math.max(a.length, b.length);
  const left = a.padEnd(length, '0'); const right = b.padEnd(length, '0');
  return left < right ? -1 : left > right ? 1 : 0;
}
function timeOrder(a, b) { return a.seconds < b.seconds ? -1 : a.seconds > b.seconds ? 1 : fractionOrder(a.fraction, b.fraction); }

/**
 * Integrated LOCAL REHEARSAL. Every source/policy claim is still hypothetical.
 * This function performs no source authentication, database transaction, grant
 * check or actual redaction approval. Never use it as an authorization gate.
 * Input is one bounded raw JSON object; output never contains source bodies.
 */
export function rehearseCandidateOperationsProjection(input) {
  let value;
  try { value = parseCandidateOperationsJson(input); } catch { reject('INPUT'); }
  if (!fields(value, ['history', 'batch', 'snapshots', 'associations', 'policy', 'now'])) reject('FIELDS');
  for (const name of ['history', 'batch', 'snapshots', 'associations']) {
    if (!Array.isArray(value[name]) || value[name].length > 256) reject('ARRAY');
  }
  const { policy } = value;
  if (!fields(policy, ['mapping_version', 'registry_revision', 'redaction_revision', 'producers', 'redactions'])
      || !text(policy.mapping_version) || !exact(policy.registry_revision, revisionPattern, 40)
      || !exact(policy.redaction_revision, revisionPattern, 40)
      || !Array.isArray(policy.producers) || policy.producers.length < 1 || policy.producers.length > 32
      || !Array.isArray(policy.redactions) || policy.redactions.length > 256) reject('POLICY');
  const now = instant(value.now);
  if (!now) reject('CLOCK');
  const producers = new Map();
  let health = 'healthy';
  for (const producer of policy.producers) {
    if (!fields(producer, ['producer_identity', 'source_revision', 'admitted_revisions', 'observed_at', 'max_observation_age_seconds', 'complete'])
        || !text(producer.producer_identity) || producers.has(producer.producer_identity)
        || !exact(producer.source_revision, revisionPattern, 40)
        || !uniqueStrings(producer.admitted_revisions, (r) => exact(r, revisionPattern, 40))
        || !producer.admitted_revisions.includes(producer.source_revision)
        || !Number.isSafeInteger(producer.max_observation_age_seconds) || producer.max_observation_age_seconds < 1
        || typeof producer.complete !== 'boolean') reject('PRODUCER_POLICY');
    const observed = instant(producer.observed_at);
    if (!observed) reject('OBSERVATION');
    if (!producer.complete || timeOrder(observed, now) > 0) health = 'reconciling';
    const age = now.seconds - observed.seconds; const limit = BigInt(producer.max_observation_age_seconds);
    if (health === 'healthy' && (age > limit || (age === limit && fractionOrder(now.fraction, observed.fraction) > 0))) health = 'stale';
    producers.set(producer.producer_identity, producer);
  }
  const watermark = [...producers.values()].sort((a, b) => utf8(a.producer_identity, b.producer_identity))
    .map((p) => ({ producer_identity: p.producer_identity, source_revision: p.source_revision }));
  const result = (state, cards = [], revision = null) => ({ kind: 'candidate_only', health: state, authoritative: false, actions_enabled: false, cards, source_watermark: watermark, projection_revision: revision });
  const bound = (envelope) => {
    const producer = producers.get(envelope.producer_identity);
    return producer && producer.admitted_revisions.includes(envelope.source_revision) && envelope.mapping_version === policy.mapping_version;
  };
  let journal;
  try { journal = appendCandidateOperationsJournal(raw(value.history), raw(value.batch)); } catch { reject('JOURNAL'); }
  if (policy.mapping_version !== mapping || journal.dispositions.some((d) => d.disposition !== 'recorded_candidate')
      || journal.entries.some((entry) => !bound(entry.envelope))) return result('incompatible');

  const snapshots = new Map();
  for (const snapshot of value.snapshots) {
    if (!fields(snapshot, ['envelope', 'detached_source_proof'])) reject('SNAPSHOT_FIELDS');
    let digest;
    try { digest = verifyCandidateOperationsContribution(raw(snapshot.envelope), raw(snapshot.detached_source_proof)); }
    catch { reject('SNAPSHOT'); }
    if (snapshots.has(digest)) reject('SNAPSHOT_DUPLICATE');
    if (!bound(snapshot.envelope)) return result('incompatible');
    snapshots.set(digest, snapshot.envelope);
  }
  const redactions = new Map();
  for (const disposition of policy.redactions) {
    if (!fields(disposition, ['snapshot_digest', 'title', 'owner_role', 'blocker_codes', 'evidence_handles'])
        || !exact(disposition.snapshot_digest, digestPattern, 71) || redactions.has(disposition.snapshot_digest)
        || !text(disposition.title) || !text(disposition.owner_role, 128)
        || !uniqueStrings(disposition.blocker_codes, (x) => typeof x === 'string' && /^[A-Z][A-Z0-9_]{0,63}(?![\s\S])/u.test(x))
        || !uniqueStrings(disposition.evidence_handles, (x) => typeof x === 'string' && /^evidence:[A-Za-z0-9_-]{16,128}(?![\s\S])/u.test(x))) reject('REDACTION');
    redactions.set(disposition.snapshot_digest, disposition);
  }
  const associations = new Map();
  for (const association of value.associations) {
    if (!fields(association, ['producer_identity', 'event_id', 'event_digest', 'snapshot_digest'])
        || !text(association.producer_identity) || !text(association.event_id)
        || !exact(association.event_digest, digestPattern, 71) || !exact(association.snapshot_digest, digestPattern, 71)) reject('ASSOCIATION');
    const id = key(association.producer_identity, association.event_id, association.event_digest);
    if (associations.has(id)) reject('ASSOCIATION_DUPLICATE');
    associations.set(id, association);
  }
  const states = [];
  const superseded = new Set();
  const stateByIndex = new Map();
  for (let index = 0; index < journal.entries.length; index += 1) {
    const { envelope, detached_source_proof: proof } = journal.entries[index];
    const event = envelope.payload;
    const predecessor = journal.dispositions[index].predecessor_index;
    if (event.status === 'accepted' && event.category !== 'state' && predecessor !== null
        && journal.entries[predecessor].envelope.payload.category === 'state') return result('incompatible');
    if (event.category !== 'state' || event.status !== 'accepted') continue;
    const association = associations.get(key(envelope.producer_identity, event.event_id, proof.digest));
    const snapshot = snapshots.get(association?.snapshot_digest);
    const occurred = instant(event.occurred_at);
    if (!association || !snapshot || !occurred || snapshot.schema_identity !== cardSchema || event.board_id !== null
        || snapshot.producer_identity !== envelope.producer_identity || snapshot.source_revision !== envelope.source_revision
        || snapshot.mapping_version !== envelope.mapping_version || snapshot.payload.card_id !== event.card_id) return result('incompatible');
    const created = instant(snapshot.payload.created_at); const updated = instant(snapshot.payload.updated_at);
    if (!created || !updated || timeOrder(created, updated) > 0 || timeOrder(updated, occurred) > 0 || timeOrder(occurred, now) > 0) return result('incompatible');
    const state = { envelope, proof, snapshot, snapshot_digest: association.snapshot_digest, occurred, index };
    if (predecessor !== null) {
      const previous = stateByIndex.get(predecessor);
      if (!previous || superseded.has(predecessor) || previous.envelope.payload.card_id !== event.card_id
          || timeOrder(previous.occurred, occurred) > 0) return result('incompatible');
      superseded.add(predecessor);
    }
    stateByIndex.set(index, state); states.push(state);
  }
  if (associations.size !== states.length) return result('incompatible');
  states.sort((a, b) => timeOrder(a.occurred, b.occurred)
    || utf8(a.envelope.producer_identity, b.envelope.producer_identity)
    || utf8(a.envelope.payload.event_id, b.envelope.payload.event_id) || utf8(a.proof.digest, b.proof.digest));
  const chosen = new Map();
  for (const state of states) if (!superseded.has(state.index)) chosen.set(key(state.envelope.producer_identity, state.snapshot.payload.card_id), state);
  const selected = [...chosen.values()].sort((a, b) => utf8(a.envelope.producer_identity, b.envelope.producer_identity) || utf8(a.snapshot.payload.card_id, b.snapshot.payload.card_id));
  const cards = [];
  for (const state of selected) {
    const { producer_identity: producer } = state.envelope; const card = state.snapshot.payload;
    const redaction = redactions.get(state.snapshot_digest);
    if (!redaction) return result('reconciling');
    const linked = [...card.dependencies, ...(card.supersedes_card_id === null ? [] : [card.supersedes_card_id])];
    if (linked.some((id) => id === card.card_id || !chosen.has(key(producer, id)))) return result('reconciling');
    cards.push({ stable_id: stableId(producer, card.card_id), title: redaction.title, lifecycle: card.lifecycle, owner_role: redaction.owner_role,
      created_at: card.created_at, updated_at: card.updated_at,
      dependency_ids: card.dependencies.map((id) => stableId(producer, id)).sort(utf8),
      blocker_codes: [...redaction.blocker_codes].sort(utf8), evidence_handles: [...redaction.evidence_handles].sort(utf8),
      supersedes_id: card.supersedes_card_id === null ? null : stableId(producer, card.supersedes_card_id) });
  }
  if (health !== 'healthy') return result(health); // No previously accepted redacted generation is supplied here.
  const policyBinding = { mapping_version: mapping, registry_revision: policy.registry_revision, redaction_revision: policy.redaction_revision,
    producers: [...producers.values()].sort((a, b) => utf8(a.producer_identity, b.producer_identity)).map((p) => ({ producer_identity: p.producer_identity, source_revision: p.source_revision, admitted_revisions: [...p.admitted_revisions].sort(utf8), max_observation_age_seconds: p.max_observation_age_seconds })),
    redactions: [...redactions.values()].sort((a, b) => utf8(a.snapshot_digest, b.snapshot_digest)).map((r) => ({ ...r, blocker_codes: [...r.blocker_codes].sort(utf8), evidence_handles: [...r.evidence_handles].sort(utf8) })) };
  const revision = `sha256:${createHash('sha256').update(canonicalizeOperationsJson({ policy: policyBinding, watermark,
    selected: selected.map((s) => ({ event_digest: s.proof.digest, snapshot_digest: s.snapshot_digest })), cards })).digest('hex')}`;
  return result('healthy', cards, revision);
}
