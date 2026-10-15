import { computeCandidateOperationsDigest } from './development-operations-digest.mjs';
import { parseCandidateOperationsJson } from './development-operations-json.mjs';

// Exact carrier rules from the candidate contract; no schema aliases or inference.
const carriers = Object.freeze({
  'socials-os.development-card.v1.schema.json': false,
  'socials-os.development-board.v1.schema.json': false,
  'socials-os.development-event.v1.schema.json': false,
  'socials-os.development-board.v2.schema.json': false,
  'socials-os.development-event.v2.schema.json': true
});

function reject(code) {
  const error = new TypeError(`Candidate operations integrity rejected: ${code}`);
  error.code = `ERR_OPERATIONS_INTEGRITY_${code}`;
  throw error;
}

function validDigest(value) {
  // The length check also rejects a final line terminator accepted by JS "$".
  return typeof value === 'string' && value.length === 71 && /^sha256:[0-9a-f]{64}$/u.test(value);
}

/**
 * Return the matching prefixed digest, never an acceptance or authorization flag.
 * Both arguments are bounded raw JSON strings/bytes, parsed independently. The
 * second represents detached_source_proof and must contain only its digest.
 * Producer/source authenticity and full contribution validation are external.
 */
export function verifyCandidateOperationsIntegrity(envelopeInput, proofInput) {
  const envelope = parseCandidateOperationsJson(envelopeInput);
  const proof = parseCandidateOperationsJson(proofInput);
  if (proof === null || typeof proof !== 'object' || Array.isArray(proof)
      || Object.keys(proof).length !== 1 || !Object.hasOwn(proof, 'digest')) reject('PROOF_FIELDS');
  if (!validDigest(proof.digest)) reject('DIGEST_FORMAT');

  // Validates the exact five-field envelope, binding types and plain payload
  // before any field access below; it does not validate the source schema.
  const computed = `sha256:${computeCandidateOperationsDigest(envelope)}`;
  if (!Object.hasOwn(carriers, envelope.schema_identity)) reject('SCHEMA_IDENTITY');
  const present = Object.hasOwn(envelope.payload, 'digest');
  if (carriers[envelope.schema_identity]) {
    if (!present) reject('PAYLOAD_DIGEST_REQUIRED');
    if (!validDigest(envelope.payload.digest)) reject('PAYLOAD_DIGEST_FORMAT');
    if (envelope.payload.digest !== proof.digest) reject('PAYLOAD_DIGEST_MISMATCH');
  } else if (present) reject('PAYLOAD_DIGEST_FORBIDDEN');
  if (computed !== proof.digest) reject('DIGEST_MISMATCH');
  return computed;
}
