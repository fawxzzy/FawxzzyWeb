import { types } from 'node:util';
import { candidateDigestLimits } from './development-operations-digest.mjs';

// Candidate implementation bounds, not adopted runtime transport policy.
export const candidateJsonLimits = candidateDigestLimits;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const viewGetter = (name) => Object.getOwnPropertyDescriptor(typedArrayPrototype, name).get;
const byteLengthOf = viewGetter('byteLength');
const byteOffsetOf = viewGetter('byteOffset');
const bufferOf = viewGetter('buffer');

function reject(code) {
  const error = new TypeError(`Candidate operations JSON rejected: ${code}`);
  error.code = `ERR_OPERATIONS_JSON_${code}`;
  throw error;
}

function decode(input) {
  if (typeof input === 'string') {
    if (input.length > candidateJsonLimits.bytes || Buffer.byteLength(input, 'utf8') > candidateJsonLimits.bytes) reject('SIZE');
    return input;
  }
  if (types.isProxy(input) || !types.isUint8Array(input)) reject('INPUT');
  // Intrinsic getters avoid input-controlled properties, iterators and coercion.
  const length = byteLengthOf.call(input);
  if (length > candidateJsonLimits.bytes) reject('SIZE');
  const buffer = bufferOf.call(input);
  if (types.isSharedArrayBuffer(buffer)) reject('SHARED_BUFFER');
  try {
    const bytes = new Uint8Array(buffer, byteOffsetOf.call(input), length);
    // Preserve a BOM so the JSON grammar rejects it instead of silently stripping it.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch { reject('UTF8'); }
}

function checkUnicode(text) {
  for (const character of text) {
    const point = character.codePointAt(0);
    if ((point >= 0xd800 && point <= 0xdfff)
      || (point >= 0xfdd0 && point <= 0xfdef)
      || (point & 0xffff) >= 0xfffe) reject('UNICODE');
  }
}

/** Parse candidate I-JSON locally. Parsing is not schema, identity or access proof. */
export function parseCandidateOperationsJson(input) {
  const text = decode(input);
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  let index = 0;
  let nodes = 0;

  function whitespace() {
    while (index < text.length && (text[index] === ' ' || text[index] === '\t' || text[index] === '\r' || text[index] === '\n')) index += 1;
  }

  function string() {
    if (text[index] !== '"') reject('SYNTAX');
    const start = index++;
    while (index < text.length) {
      const current = text[index++];
      if (current === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, index)); } catch { reject('SYNTAX'); }
        checkUnicode(value);
        return value;
      }
      // Skip the escaped code unit; JSON.parse validates the entire string grammar.
      if (current === '\\') index += 1;
    }
    reject('SYNTAX');
  }

  function value(depth) {
    if (depth > candidateJsonLimits.depth) reject('DEPTH');
    if (++nodes > candidateJsonLimits.nodes) reject('NODES');
    whitespace();
    const first = text[index];
    if (first === '"') { string(); return; }
    if (first === '{' || first === '[') {
      const object = first === '{';
      const end = object ? '}' : ']';
      const keys = object ? new Set() : null;
      index += 1;
      whitespace();
      if (text[index] === end) { index += 1; return; }
      while (true) {
        if (object) {
          whitespace();
          const key = string();
          if (keys.has(key)) reject('DUPLICATE_KEY');
          keys.add(key);
          whitespace();
          if (text[index++] !== ':') reject('SYNTAX');
        }
        value(depth + 1);
        whitespace();
        if (text[index] === end) { index += 1; return; }
        if (text[index++] !== ',') reject('SYNTAX');
      }
    }
    for (const literal of ['null', 'true', 'false']) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    number.lastIndex = index;
    const match = number.exec(text);
    if (!match) reject('SYNTAX');
    if (!Number.isFinite(Number(match[0]))) reject('NUMBER');
    index = number.lastIndex;
  }

  value(0);
  whitespace();
  if (index !== text.length) reject('SYNTAX');
  // Duplicate names and Unicode evidence were checked before JSON.parse loses them.
  // No reviver, callbacks, network, storage, schema dispatch or trust decision.
  try { return JSON.parse(text); } catch { reject('SYNTAX'); }
}
