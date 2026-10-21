#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { assertKeys, requireCondition, validateCandidateObservations, validateRollbackObservations } from './recover-production-release.mjs';
import { verifyProductionRelease } from './verify-production-release.mjs';

export const PHASE_SCHEMA = 'atlas.web.release-phase.v1';
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

// Canonical JSON is the wire format: sorted keys, safe integers, no whitespace
// or alternate escapes. Roundtrip equality rejects duplicate keys without a
// second permissive JSON parser. The schema below rejects unknown properties.
export function canonicalJson(value, depth = 0) {
  requireCondition(depth <= 32, 'Frame nesting exceeds the protocol bound.');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    requireCondition(Buffer.from(value, 'utf8').toString('utf8') === value, 'Invalid Unicode string.');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    requireCondition(Number.isSafeInteger(value) && !Object.is(value, -0), 'Only safe integer JSON numbers are admitted.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  requireCondition(value !== null && typeof value === 'object', 'Invalid JSON value.');
  return `{${Object.keys(value).sort().map((key) => `${canonicalJson(key, depth + 1)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`;
}

export function parsePhaseFrame(bytes) {
  requireCondition(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= MAX_FRAME_BYTES,
    'Invalid phase frame byte length.');
  requireCondition(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
    'A phase frame cannot have a leading UTF-8 BOM.');
  let raw;
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    raw = text.endsWith('\n') ? text.slice(0, -1) : text;
    value = JSON.parse(raw);
  } catch { throw new Error('Invalid phase JSON encoding.'); }
  requireCondition(raw === canonicalJson(value), 'Frame must be one canonical JSON object; duplicate keys are forbidden.');
  return value;
}

export function handlePhaseRequest(request) {
  assertKeys(request, ['schema', 'request_id', 'phase', 'manifest_sha256', 'identity', 'observations'], 'phase request');
  requireCondition(request.schema === PHASE_SCHEMA && typeof request.request_id === 'string'
    && typeof request.manifest_sha256 === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(request.request_id)
    && /^[0-9a-f]{64}$/u.test(request.manifest_sha256), 'Invalid phase request identity.');
  let result;
  switch (request.phase) {
    case 'validate_candidate': result = validateCandidateObservations(request.identity, request.observations); break;
    case 'validate_acceptance': result = verifyProductionRelease({ identity: request.identity, observations: request.observations }); break;
    case 'validate_rollback_readback': result = validateRollbackObservations(request.identity, request.observations); break;
    default: throw new Error('Unknown phase; provider effects are never exposed.');
  }
  return { schema: PHASE_SCHEMA, request_id: request.request_id, phase: request.phase,
    manifest_sha256: request.manifest_sha256, identity: request.identity, status: 'VALID', result };
}

async function main() {
  requireCondition(process.argv.length === 3 && process.argv[2] === '--phase-bridge-stdio',
    'HOLD_DIRECT_PRODUCTION_DEPLOY_DISABLED: --confirm-production and --dry-run cannot grant a capability.');
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    requireCondition(size <= MAX_FRAME_BYTES, 'Phase frame is oversized.');
    chunks.push(chunk);
  }
  const result = handlePhaseRequest(parsePhaseFrame(Buffer.concat(chunks)));
  process.stdout.write(`${canonicalJson(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('HOLD_PHASE_VALIDATION_FAILED\n'); process.exitCode = 1; });
}
