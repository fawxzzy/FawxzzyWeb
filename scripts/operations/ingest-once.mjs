import { prepareIngestion } from '../../src/server/operations/ingest.mjs';
import { readTrustedSources } from '../../src/server/operations/source-reader.mjs';
import { hash, reject } from '../../src/server/operations/runtime.mjs';

/** Host-only entry point. No CLI, public handler, timer or default authority.
 * The existing ATLAS executor must supply its live canonical gate. A source
 * manifest, environment flag or user JSON is never a substitute for that gate.
 * Integration with the actual scheduler/credentials is intentionally separate
 * from this source-tested adapter; callers cannot infer installation from it.
 */
export async function ingestOnce({ gate, store, pins, correlation, tokenForRepository, fetcher, clock = () => new Date() }) {
  if (!gate || !['assertPreflight', 'readControlState', 'admitRequest', 'assertEffectBoundary', 'recordTerminal'].every((n) => typeof gate[n] === 'function')) reject('CANONICAL_GATE_REQUIRED');
  const scope = { target: 'bxtcuhkotumitoqtrcej', writerScope: 'platform.private-operations.ingest', correlation, pinsDigest: hash(JSON.stringify(pins)) };
  await gate.assertPreflight(scope); // Before any token or database acquisition.
  let prepared; let terminal;
  try {
    const expected = await gate.readControlState();
    const reconstruction = await store.reconstruction(expected.generation);
    const source = await readTrustedSources({ pins, tokenForRepository, fetcher, clock });
    prepared = await prepareIngestion({ source, reconstruction, correlation, expected, now: clock().toISOString() });
    if (expected.registry_revision !== prepared.registryRevision || expected.redaction_revision !== prepared.redactionRevision) reject('POLICY_DRIFT');
    // A separate canonical policy writer installs the exact DB admission; the
    // ingestor connection has no operations_admit grant and cannot grant itself.
    await gate.admitRequest({ ...scope, ...prepared });
    await gate.assertEffectBoundary({ ...scope, requestDigest: prepared.requestDigest, trustDigest: prepared.trustDigest,
      expectedGeneration: prepared.expectedGeneration, expectedHead: prepared.expectedHead });
    const current = await gate.readControlState();
    if (current.generation !== expected.generation || current.revision !== expected.revision
      || current.registry_revision !== expected.registry_revision || current.redaction_revision !== expected.redaction_revision) reject('PREIMAGE_DRIFT');
    terminal = await store.execute(prepared);
  } catch {
    // A gate or connection may have committed its admission; no automatic retry
    // or cleanup. Only storage execute() can classify an uncertain COMMIT.
    terminal = { status: 'stopped', correlation };
  }
  const receipt = { ...terminal, requestDigest: prepared?.requestDigest ?? null,
    trustDigest: prepared?.trustDigest ?? null, projectionRevision: prepared?.projectionRevision ?? null };
  try { await gate.recordTerminal(receipt); } catch { return { ...receipt, receiptPersistence: 'unknown' }; }
  return { ...receipt, receiptPersistence: 'recorded' };
}
