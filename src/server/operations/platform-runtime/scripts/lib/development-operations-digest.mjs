import { createHash } from 'node:crypto';
import { types } from 'node:util';

// Candidate implementation limits, not adopted transport/schema policy.
export const candidateDigestLimits = Object.freeze({ depth: 64, nodes: 100000, bytes: 1048576 });
const envelopeFields = ['mapping_version', 'payload', 'producer_identity', 'schema_identity', 'source_revision'];

function reject(code) {
  const error = new TypeError(`Candidate operations digest rejected: ${code}`);
  error.code = `ERR_OPERATIONS_DIGEST_${code}`;
  throw error;
}

function checkString(value) {
  if (value.length > candidateDigestLimits.bytes) reject('SIZE');
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject('UNICODE');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) reject('UNICODE');
  }
}

function inspectContainer(value, requireRecord = false) {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) reject('OBJECT');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (requireRecord && array) reject('OBJECT');
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) reject('PROTOTYPE');
  const keys = Reflect.ownKeys(value);
  if (keys.length > candidateDigestLimits.nodes + (array ? 1 : 0)) reject('NODES');
  if (keys.some((key) => typeof key !== 'string')) reject('SYMBOL_KEY');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) reject('ACCESSOR');
    if (array && key === 'length') continue;
    if (!descriptor.enumerable) reject('HIDDEN_FIELD');
    checkString(key);
  }
  if (array) {
    const length = descriptors.length.value;
    if (length > candidateDigestLimits.nodes) reject('NODES');
    if (keys.length !== length + 1) reject('ARRAY_SHAPE');
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(descriptors, String(index))) reject('ARRAY_SHAPE');
    }
  }
  return { array, keys, descriptors };
}

/** RFC 8785 serialization of plain JSON values; never parses or authenticates input. */
export function canonicalizeOperationsJson(value) {
  const chunks = [];
  const ancestors = new WeakSet();
  let bytes = 0;
  let nodes = 0;
  function emit(text) {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > candidateDigestLimits.bytes) reject('SIZE');
    chunks.push(text);
  }
  function visit(current, depth) {
    if (depth > candidateDigestLimits.depth) reject('DEPTH');
    if (++nodes > candidateDigestLimits.nodes) reject('NODES');
    if (current === null || typeof current === 'boolean') { emit(JSON.stringify(current)); return; }
    if (typeof current === 'string') { checkString(current); emit(JSON.stringify(current)); return; }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) reject('NUMBER');
      emit(JSON.stringify(current));
      return;
    }
    if (typeof current !== 'object') reject('VALUE');
    const { array, keys, descriptors } = inspectContainer(current);
    if (ancestors.has(current)) reject('CYCLE');
    ancestors.add(current);
    try {
      emit(array ? '[' : '{');
      // Default string sorting is UTF-16 code-unit order, including numeric keys.
      const ordered = array ? Array.from({ length: descriptors.length.value }, (_, index) => String(index)) : keys.sort();
      ordered.forEach((key, index) => {
        if (index) emit(',');
        if (!array) { emit(JSON.stringify(key)); emit(':'); }
        visit(descriptors[key].value, depth + 1);
      });
      emit(array ? ']' : '}');
    } finally { ancestors.delete(current); }
  }
  visit(value, 0);
  return chunks.join('');
}

/** Compute proposed covered bytes only. A matching hash is not trusted-source or access proof. */
export function computeCandidateOperationsDigest(envelope) {
  const { keys, descriptors } = inspectContainer(envelope, true);
  keys.sort();
  if (keys.length !== envelopeFields.length || keys.some((key, index) => key !== envelopeFields[index])) reject('ENVELOPE_FIELDS');
  const covered = Object.create(null);
  for (const key of envelopeFields) {
    if (key === 'payload') continue;
    const value = descriptors[key].value;
    if (typeof value !== 'string' || !value.length) reject('BINDING');
    checkString(value);
    covered[key] = value;
  }
  const payload = inspectContainer(descriptors.payload.value, true);
  covered.payload = Object.create(null);
  for (const key of payload.keys) {
    const value = payload.descriptors[key].value;
    if (key === 'digest') {
      // Syntax/version validation of the supplied digest remains the caller's job.
      if (typeof value !== 'string') reject('DIGEST_FIELD');
      checkString(value);
    } else covered.payload[key] = value;
  }
  return createHash('sha256').update(canonicalizeOperationsJson(covered), 'utf8').digest('hex');
}
