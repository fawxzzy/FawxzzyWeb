import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { ingestOnce } from './ingest-once.mjs';
import { createOperationsControl, createPolicyTlsConnector } from '../../src/server/operations/control-store.mjs';
import { createOperationsStore, createTlsConnector } from '../../src/server/operations/store.mjs';
import { fields, hash, reject } from '../../src/server/operations/runtime.mjs';
import { parseCandidateOperationsJson as parse } from '../../src/server/operations/platform-runtime/scripts/lib/development-operations-json.mjs';

const limit = 1048576;
const responseLimit = 16 * limit;
const preparedKeys = ['rawRequest', 'requestDigest', 'trustDigest', 'correlation', 'expectedGeneration', 'expectedHead',
  'registryRevision', 'redactionRevision', 'health', 'projectionRevision'];

function parseFrame(bytes) {
  if (bytes.length <= limit) return parse(bytes);
  // Reconstruction wraps many individually bounded raw-request strings. The
  // candidate document parser deliberately caps one document at 1 MiB. Larger
  // parent frames must be exact compact JSON: roundtrip rejects duplicate keys,
  // lossy numbers, alternate escaping and noncanonical object order. Nested
  // raw requests are still checked by the original candidate parser downstream.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = JSON.parse(text);
  if (JSON.stringify(value) !== text) reject('HOST_FRAME_CANONICAL');
  return value;
}

/** Bounded one-response-at-a-time pipe. Neither paths nor methods are executable. */
export function createPipe(input, output) {
  let pending; let saved; let buffer = Buffer.alloc(0); let ended = false; let failure = false; let id = 0;
  function fail() { failure = true; pending?.reject(new Error('OPS_HOST_TRANSPORT')); pending = undefined; }
  function data(chunk) {
    if (failure || ended) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > responseLimit) { fail(); return; }
    const cut = buffer.indexOf(10);
    if (cut < 0) return;
    // Parent sends the next frame only after a child request. Pipelining is invalid.
    if (cut !== buffer.length - 1 || saved) { fail(); return; }
    try {
      const value = parseFrame(buffer.subarray(0, cut)); buffer = Buffer.alloc(0);
      if (pending) { const waiter = pending; pending = undefined; waiter.resolve(value); }
      else saved = value;
    } catch { fail(); }
  }
  function end() { ended = true; if (pending || buffer.length) fail(); }
  input.on('data', data); input.on('end', end); input.on('error', fail); output.on('error', fail);
  const read = async () => {
    if (failure || pending) reject('HOST_TRANSPORT');
    if (saved) { const value = saved; saved = undefined; return value; }
    if (ended) reject('HOST_TRANSPORT');
    return new Promise((resolve, rejectPromise) => { pending = { resolve, reject: rejectPromise }; });
  };
  return {
    read,
    async request(method, value) {
      if (++id > 9) reject('HOST_REQUEST_LIMIT');
      const raw = `${JSON.stringify({ id, method, value })}\n`;
      if (Buffer.byteLength(raw) > 8 * limit) reject('HOST_REQUEST_SIZE');
      const response = read();
      // Observe rejection while backpressure is pending.
      void response.catch(() => {});
      if (!output.write(raw)) await once(output, 'drain');
      const result = await response;
      fields(result, ['id', 'ok', 'value']);
      if (result.id !== id || result.ok !== true) reject('HOST_RESPONSE');
      return result.value;
    },
    close() { input.off('data', data); input.off('end', end); input.off('error', fail); output.off('error', fail); input.pause(); },
  };
}

/** Test injection is in-process only; the executable always uses fixed adapters. */
export async function runHost(pipe, { controlFactory = (c) => createOperationsControl(createPolicyTlsConnector(c)),
  storeFactory = (c) => createOperationsStore(createTlsConnector(c)), ingest = ingestOnce, clock = () => new Date() } = {}) {
  const init = await pipe.read();
  const provider = Object.hasOwn(init, 'transportMode');
  fields(init, ['protocol', 'pins', 'correlation', 'expiresAt', ...(provider ? ['transportMode'] : [])]);
  if (provider && init.transportMode !== 'existing-master-broker-v1') reject('HOST_MODE');
  if (init.protocol !== 'atlas-private-operations-host-v1'
    || typeof init.correlation !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(init.correlation)
    || typeof init.expiresAt !== 'string' || !Number.isFinite(Date.parse(init.expiresAt))) reject('HOST_INIT');
  const expiresAt = new Date(init.expiresAt).toISOString();
  const time = () => { if (clock().getTime() >= Date.parse(expiresAt)) reject('HOST_EXPIRED'); };
  const scope = { target: 'bxtcuhkotumitoqtrcej', writerScope: 'platform.private-operations.ingest', correlation: init.correlation, pinsDigest: hash(JSON.stringify(init.pins)) };
  let control; let store; let token; let phase = 'new'; let reads = 0; let reconstruction = false; let executed = false;
  const gate = {
    async assertPreflight(value) {
      time(); if (phase !== 'new' || JSON.stringify(value) !== JSON.stringify(scope)) reject('HOST_SEQUENCE');
      const credentials = await pipe.request('preflight', value);
      fields(credentials, provider ? ['githubToken'] : ['control', 'ingest', 'githubToken']);
      if (typeof credentials.githubToken !== 'string' || !credentials.githubToken || /[\r\n]/u.test(credentials.githubToken)) reject('HOST_CREDENTIALS');
      if (!provider) { control = controlFactory(credentials.control); store = storeFactory(credentials.ingest); }
      token = credentials.githubToken;
      phase = 'started';
    },
    async readControlState() {
      time(); reads += 1;
      if (!(reads === 1 && phase === 'started' || reads === 2 && phase === 'effect')) reject('HOST_SEQUENCE');
      return provider ? pipe.request('state', scope) : control.readState();
    },
    async readPolicy({ signal, ...value }) {
      time(); if (phase !== 'started' || signal?.aborted) reject('HOST_SEQUENCE');
      const held = await pipe.request('policy', value);
      fields(held, ['bytes', 'approvalReceiptSha256']);
      if (typeof held.bytes !== 'string' || held.bytes.length > 349528) reject('HOST_POLICY');
      const bytes = Buffer.from(held.bytes, 'base64');
      if (bytes.toString('base64') !== held.bytes || bytes.length > 262144) reject('HOST_POLICY');
      phase = 'policy'; return { bytes, approvalReceiptSha256: held.approvalReceiptSha256 };
    },
    async admitRequest(value) {
      time(); if (phase !== 'policy') reject('HOST_SEQUENCE');
      const permit = await pipe.request('admit', value);
      fields(permit, ['requestDigest', 'expiresAt', ...(provider ? ['admission'] : [])]);
      if (permit.requestDigest !== value.requestDigest || new Date(permit.expiresAt).toISOString() !== expiresAt) reject('HOST_PERMIT');
      time(); phase = 'admitted';
      return provider ? permit.admission : control.admit(Object.fromEntries(preparedKeys.map((key) => [key, value[key]])), expiresAt);
    },
    async assertEffectBoundary(value) {
      time(); if (phase !== 'admitted') reject('HOST_SEQUENCE');
      const permit = await pipe.request('effect', value); fields(permit, ['expiresAt']);
      if (new Date(permit.expiresAt).toISOString() !== expiresAt) reject('HOST_PERMIT');
      time(); phase = 'effect';
    },
    async recordTerminal(value) {
      if (phase === 'new' || phase === 'terminal') reject('HOST_SEQUENCE');
      const proof = await pipe.request('terminal', value); fields(proof, ['recorded']);
      if (proof.recorded !== true) reject('HOST_RECEIPT'); phase = 'terminal';
    },
  };
  const boundedStore = {
    async reconstruction(generation) {
      time(); if (phase !== 'started' || reconstruction || reads !== 1) reject('HOST_SEQUENCE');
      reconstruction = true;
      return provider ? pipe.request('reconstruction', { ...scope, generation }) : store.reconstruction(generation);
    },
    async execute(prepared) {
      time(); if (phase !== 'effect' || executed || reads !== 2) reject('HOST_SEQUENCE');
      executed = true;
      if (!provider) return store.execute(prepared);
      // A request may have reached COMMIT even when its reply is malformed or
      // lost. Preserve uncertainty and the known request identity; never retry
      // or turn an invalid response into a successful/stopped terminal.
      const unknown = () => ({ status: 'unknown', correlation: prepared.correlation, requestDigest: prepared.requestDigest });
      try {
        const result = await pipe.request('ingest', { ...scope, requestDigest: prepared.requestDigest });
        if (result?.status === 'unknown') {
          fields(result, ['status', 'correlation', 'requestDigest']);
          if (result.correlation !== prepared.correlation || result.requestDigest !== prepared.requestDigest) return unknown();
          return unknown();
        }
        fields(result, ['status', 'outcome', 'correlation', 'revision']);
        if (result.status !== 'settled' || result.correlation !== prepared.correlation
          || !['committed', 'quarantined', 'duplicate'].includes(result.outcome)
          || (result.outcome === 'quarantined' ? result.revision !== null : result.revision !== prepared.projectionRevision)) return unknown();
        return { status: 'settled', outcome: result.outcome, correlation: result.correlation, revision: result.revision };
      } catch { return unknown(); }
    },
  };
  try {
    const result = await ingest({ gate, store: boundedStore, pins: init.pins, correlation: init.correlation, clock,
      tokenForRepository: async (id, { signal } = {}) => {
        time(); if (phase !== 'policy' || id !== 1301080630 || signal?.aborted) reject('HOST_REPOSITORY');
        return token;
      } });
    if (phase !== 'terminal' || result.receiptPersistence !== 'recorded') reject('HOST_RECEIPT');
    return result;
  } finally { token = undefined; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pipe = createPipe(process.stdin, process.stdout);
  // Fixed whole-process deadline, including a blocked stdin/write or stalled peer.
  const timer = setTimeout(() => process.exit(2), 240000);
  try { await runHost(pipe); } catch { process.exitCode = 2; }
  finally { clearTimeout(timer); pipe.close(); }
}
