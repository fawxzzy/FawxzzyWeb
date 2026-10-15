import { parseCandidateOperationsJson, candidateJsonLimits } from './development-operations-json.mjs';
import { verifyCandidateOperationsContribution } from './development-operations-contribution.mjs';

// Local candidate bounds, not an adopted transport, storage or retention policy.
export const candidateJournalLimits = Object.freeze({ entries: 256, bytes: candidateJsonLimits.bytes });
const eventSchemas = new Set([
  'socials-os.development-event.v1.schema.json',
  'socials-os.development-event.v2.schema.json'
]);

function reject(code) {
  const error = new TypeError(`Candidate operations journal rejected: ${code}`);
  error.code = `ERR_OPERATIONS_JOURNAL_${code}`;
  throw error;
}

function parseArray(input, label) {
  let value;
  try { value = parseCandidateOperationsJson(input); }
  catch { reject(`${label}_INPUT`); }
  if (!Array.isArray(value)) reject(`${label}_SHAPE`);
  return value;
}

function checkEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'envelope')
      || !Object.hasOwn(entry, 'detached_source_proof')) reject('ENTRY_FIELDS');
  let digest;
  try {
    digest = verifyCandidateOperationsContribution(
      JSON.stringify(entry.envelope), JSON.stringify(entry.detached_source_proof)
    );
  } catch { reject('CONTRIBUTION'); }
  if (!eventSchemas.has(entry.envelope.schema_identity)) reject('EVENT_SCHEMA');
  return digest;
}

/**
 * Append candidate history with deterministic duplicate/conflict handling.
 * Both inputs are bounded raw JSON arrays, never JS objects or trusted state.
 * Returned entries contain private source bodies and are NOT a consumer response.
 * No producer authentication, acceptance, current truth or projection is implied.
 */
export function appendCandidateOperationsJournal(historyInput, batchInput) {
  const history = parseArray(historyInput, 'HISTORY');
  const batch = parseArray(batchInput, 'BATCH');
  if (history.length + batch.length > candidateJournalLimits.entries) reject('ENTRIES');
  // Bounds cover submitted duplicates as well as retained entries. Parsed values
  // have no getters/custom prototypes; this serialization cannot invoke callers.
  if (Buffer.byteLength(JSON.stringify([...history, ...batch]), 'utf8') > candidateJournalLimits.bytes) reject('SIZE');

  const entries = [];
  const dispositions = [];
  const results = [];
  const producers = new Map();

  function append(entry, isHistory, inputIndex) {
    const digest = checkEntry(entry);
    const { producer_identity: producer, source_revision: revision, payload } = entry.envelope;
    const id = payload.event_id;
    let events = producers.get(producer);
    if (!events) { events = new Map(); producers.set(producer, events); }
    const variants = events.get(id);
    const repeated = variants?.find((index) => entries[index].envelope.source_revision === revision
      && entries[index].detached_source_proof.digest === digest);
    if (repeated !== undefined) {
      // Retained history is the prior output's unique entries, not caller-supplied
      // classification. Recomputing it may not silently remove an original row.
      if (isHistory) reject('HISTORY_DUPLICATE');
      results.push({ input_index: inputIndex, journal_index: repeated, disposition: 'duplicate_candidate', existing_disposition: dispositions[repeated].disposition });
      return;
    }

    let reason = null;
    let predecessorIndex = null;
    if (variants) reason = 'IDENTITY_CONFLICT';
    else if (payload.supersedes_event_id !== null) {
      const predecessor = payload.supersedes_event_id;
      const preceding = events.get(predecessor);
      if (predecessor === id) reason = 'SELF_PREDECESSOR';
      else if (!preceding) reason = 'MISSING_PREDECESSOR';
      else if (preceding.length !== 1 || dispositions[preceding[0]].disposition !== 'recorded_candidate') reason = 'QUARANTINED_PREDECESSOR';
      else predecessorIndex = preceding[0];
    }
    const journalIndex = entries.length;
    const disposition = reason === null ? 'recorded_candidate' : 'quarantined_candidate';
    const state = { journal_index: journalIndex, disposition, reason, predecessor_index: predecessorIndex };
    entries.push(entry);
    dispositions.push(state);
    if (variants) variants.push(journalIndex);
    else events.set(id, [journalIndex]);
    if (!isHistory) results.push({ input_index: inputIndex, ...state });
  }

  // Every result is local until the complete batch succeeds. Rejected input
  // cannot mutate caller state or return a partial journal.
  history.forEach((entry, index) => append(entry, true, index));
  batch.forEach((entry, index) => append(entry, false, index));
  return { kind: 'candidate_only', entries, dispositions, results };
}
