import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { hash, loadRuntime } from '../src/server/operations/runtime.mjs';
import { readTrustedSources } from '../src/server/operations/source-reader.mjs';
import { prepareIngestion, exactOrder } from '../src/server/operations/ingest.mjs';
import { createOperationsStore, createTlsConnector } from '../src/server/operations/store.mjs';
import { createOperationsControl, createPolicyTlsConnector } from '../src/server/operations/control-store.mjs';
import { ingestOnce } from '../scripts/operations/ingest-once.mjs';
import { computeCandidateOperationsDigest } from '../src/server/operations/platform-runtime/scripts/lib/development-operations-digest.mjs';

const revision = 'a'.repeat(40); const publication = 'b'.repeat(40); const registry = 'c'.repeat(40);
const policyRevision = 'd'.repeat(40); const approvalReceipt = 'sha256:' + 'e'.repeat(64);
const identity = 'github-repository:1301080630'; const mapping = 'socials-card-snapshot:v1';
const stamp = '2026-10-15T03:00:00.123456789123456789Z'; const now = '2026-10-15T03:01:00.000Z';
const correlation = '00000000-0000-4000-8000-000000000001';
const nextCorrelation = '00000000-0000-4000-8000-000000000002';
const expected = { generation: 1, revision: null, registry_revision: registry, redaction_revision: policyRevision };
const empty = { status: 'ready', generation: 1, revision: null, health: 'reconciling', observations: [] };
const clock = () => new Date(now);
function controlDb(mode) {
  const calls = []; let closed = 0; let connections = 0;
  return { calls, get closed() { return closed; }, get connections() { return connections; },
    connect: async () => { connections += 1; return {
      query: async (sql, args) => {
        calls.push({ sql, args });
        if (sql.startsWith('SELECT current_user')) return { rows: [{ allowed: mode !== 'privileged' }] };
        if (sql.includes('operations_control_state')) return { rows: [{ value: mode === 'malformed'
          ? { generation: '0', secret: 'PRIVATE' } : { ...expected, correlation: null, health: 'reconciling' } }] };
        if (mode === 'abort' && sql.includes('operations_admit')) throw new Error('PRIVATE_DATABASE_DETAIL');
        if (mode === 'lost' && sql === 'COMMIT') throw new Error('PRIVATE_DATABASE_DETAIL');
        return { rows: [{}] };
      }, end: async () => { closed += 1; },
    }; },
  };
}

test('control connector accepts only fixed scoped TLS configuration', () => {
  const config = { host: 'aws-1-region.pooler.supabase.com', port: 5432, database: 'postgres',
    user: 'platform_ops_policy_login.bxtcuhkotumitoqtrcej', password: 'fixture', ca: 'fixture' };
  assert.equal(typeof createPolicyTlsConnector(config), 'function');
  for (const change of [{ user: 'postgres.bxtcuhkotumitoqtrcej' }, { ca: '' }, { host: 'attacker.invalid' },
    { ssl: false }, { connectionString: 'postgres://fixture' }, { port: 1234 }, { database: 'other' }]) {
    assert.throws(() => createPolicyTlsConnector({ ...config, ...change }));
  }
});
test('control state uses policy-only role proof and closes the client', async () => {
  const d = controlDb(); const result = await createOperationsControl(d.connect, clock).readState();
  assert.equal(result.generation, 1); assert.equal(d.connections, 1); assert.equal(d.closed, 1);
  assert.match(d.calls[0].sql, /platform_ops_policy_login/u);
  assert.match(d.calls[0].sql, /p\.rolname NOT IN\s*\('platform_ops_policy_login','platform_ops_policy_admin'\)/u);
});
test('control state rejects privileged role without reading state', async () => {
  const d = controlDb('privileged'); await assert.rejects(createOperationsControl(d.connect, clock).readState(), { message: 'OPS_CONTROL_ROLE' });
  assert.equal(d.calls.length, 1); assert.equal(d.closed, 1);
});
test('control state rejects malformed or private database fields', async () => {
  const d = controlDb('malformed'); await assert.rejects(createOperationsControl(d.connect, clock).readState(), { message: 'OPS_CONTROL_STATE' });
  assert.equal(d.closed, 1);
});
test('control admission binds eight exact parameters in one transaction', async () => {
  const d = controlDb(); const prepared = await prepare(); const expires = '2026-10-15T03:05:00.000Z';
  const result = await createOperationsControl(d.connect, clock).admit(prepared, expires);
  assert.equal(result.status, 'admitted'); assert.equal(d.connections, 1); assert.equal(d.closed, 1);
  const query = d.calls.find((x) => x.sql.includes('operations_admit'));
  assert.deepEqual(query.args, [prepared.correlation, prepared.requestDigest, prepared.expectedHead, prepared.expectedGeneration,
    prepared.registryRevision, prepared.redactionRevision, prepared.trustDigest, expires]);
  assert.equal(d.calls.filter((x) => x.sql === 'BEGIN').length, 1); assert.equal(d.calls.at(-1).sql, 'COMMIT');
});
test('control admission precommit failure rolls back and sanitizes', async () => {
  const d = controlDb('abort'); await assert.rejects(createOperationsControl(d.connect, clock).admit(await prepare(), '2026-10-15T03:05:00.000Z'), { message: 'OPS_CONTROL_ADMISSION_ABORTED' });
  assert.equal(d.calls.at(-1).sql, 'ROLLBACK'); assert.equal(d.closed, 1);
});
test('control admission lost COMMIT acknowledgement stays unknown without retry', async () => {
  const d = controlDb('lost'); const result = await createOperationsControl(d.connect, clock).admit(await prepare(), '2026-10-15T03:05:00.000Z');
  assert.equal(result.status, 'unknown'); assert.equal(d.connections, 1);
  assert.equal(d.calls.filter((x) => x.sql === 'COMMIT').length, 1); assert.equal(d.calls.some((x) => x.sql === 'ROLLBACK'), false);
});
test('control admission rejects digest or body identity drift before connecting', async () => {
  const d = controlDb(); const c = createOperationsControl(d.connect, clock); const prepared = await prepare();
  await assert.rejects(c.admit({ ...prepared, requestDigest: hash('changed') }, '2026-10-15T03:05:00.000Z'), { message: 'OPS_CONTROL_REQUEST' });
  await assert.rejects(c.admit({ ...prepared, correlation: nextCorrelation }, '2026-10-15T03:05:00.000Z'), { message: 'OPS_CONTROL_REQUEST' });
  assert.equal(d.connections, 0);
});
test('control admission refuses noncanonical or expired expiry before connecting', async () => {
  const d = controlDb(); const c = createOperationsControl(d.connect, clock); const prepared = await prepare();
  for (const expires of ['2026-10-15T03:01:00.000Z', '2026-10-15T03:30:00.000Z', 'infinity', '2026-10-15T03:05:00Z']) {
    await assert.rejects(c.admit(prepared, expires), { message: 'OPS_CONTROL_EXPIRY' });
  }
  assert.equal(d.connections, 0);
});
test('control admission rechecks expiry after connection latency', async () => {
  const d = controlDb(); let reads = 0; const c = createOperationsControl(d.connect, () => new Date(reads++ ? '2026-10-15T03:06:00Z' : now));
  await assert.rejects(c.admit(await prepare(), '2026-10-15T03:05:00.000Z'), { message: 'OPS_CONTROL_ADMISSION_ABORTED' });
  assert.equal(d.calls.some((x) => x.sql.includes('operations_admit')), false); assert.equal(d.closed, 1);
});
function seal(payload, type) {
  const envelope = { schema_identity: `socials-os.development-${type}.v1.schema.json`, producer_identity: identity,
    source_revision: revision, mapping_version: mapping, payload };
  return { envelope, digest: `sha256:${computeCandidateOperationsDigest(envelope)}` };
}
function fixture(change = () => {}) {
  const card = seal({ card_id: 'card:sample', project_slug: 'fixture', title: 'PRIVATE_TITLE', lifecycle: 'planning',
    owner_role: 'PRIVATE_OWNER', priority: 'high', dependencies: [], blockers: ['PRIVATE_BLOCKER'], source_reference: 'PRIVATE_SOURCE',
    evidence_references: ['PRIVATE_EVIDENCE'], created_at: stamp, updated_at: stamp, supersedes_card_id: null, visibility: 'private' }, 'card');
  const event = seal({ event_id: 'dev-event:sample', occurred_at: stamp, source_role: 'PRIVATE_ROLE', source_system: 'fixture',
    category: 'state', card_id: 'card:sample', board_id: null, factual_summary: 'PRIVATE_SUMMARY', evidence_references: ['PRIVATE_EVENT'],
    visibility: 'private', sensitivity: 'restricted', include_in_digest: false, status: 'accepted', supersedes_event_id: null }, 'event');
  const policy = { schema: 'platform.operations-redaction.v1', registry_revision: registry, redaction_revision: policyRevision,
    mapping_version: mapping, max_observation_age_seconds: 3600,
    redactions: [{ snapshot_digest: card.digest, title: 'Reviewed title', owner_role: 'fixture.owner', blocker_codes: [], evidence_handles: [] }] };
  const manifest = { schema: 'platform.operations-source-manifest.v1', producer_identity: identity, source_revision: revision,
    complete: true, files: [], associations: [{ producer_identity: identity, event_id: event.envelope.payload.event_id,
      event_digest: event.digest, snapshot_digest: card.digest }] };
  const rawFiles = new Map();
  const blobSha = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  for (const [kind, item, path] of [['event', event, 'operations/export/events/sample.json'], ['snapshot', card, 'operations/export/snapshots/sample.json']]) {
    const bytes = Buffer.from(JSON.stringify(item.envelope)); rawFiles.set(path, bytes);
    manifest.files.push({ path, kind, blob: blobSha(bytes), sha256: hash(bytes), digest: item.digest });
  }
  change({ manifest, policy, rawFiles });
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); const policyBytes = Buffer.from(JSON.stringify(policy));
  rawFiles.set('operations/export/manifest.v1.json', manifestBytes);
  const responses = new Map();
  function repo(name, id, commit, files) {
    const prefix = `https://api.github.com/repos/${name}`; const root = { children: new Map() };
    for (const [path, bytes] of files) {
      let node = root; const parts = path.split('/');
      for (const part of parts.slice(0, -1)) { if (!node.children.has(part)) node.children.set(part, { children: new Map() }); node = node.children.get(part); }
      node.children.set(parts.at(-1), { bytes });
    }
    function tree(node) {
      const entries = [...node.children].map(([path, child]) => {
        if (child.children) return { path, type: 'tree', mode: '040000', sha: tree(child) };
        const sha = blobSha(child.bytes);
        responses.set(`${prefix}/git/blobs/${sha}`, { sha, encoding: 'base64', size: child.bytes.length, content: child.bytes.toString('base64') });
        return { path, type: 'blob', mode: '100644', sha, size: child.bytes.length };
      });
      const sha = createHash('sha1').update(JSON.stringify(entries)).digest('hex');
      responses.set(`${prefix}/git/trees/${sha}`, { sha, truncated: false, tree: entries }); return sha;
    }
    const treeSha = tree(root);
    responses.set(prefix, { id, full_name: name, default_branch: 'main', private: true });
    responses.set(`${prefix}/branches/main`, { commit: { sha: commit } });
    responses.set(`${prefix}/git/commits/${commit}`, { sha: commit, tree: { sha: treeSha } });
    const base = id === 1301080630 ? revision : policyRevision;
    responses.set(`${prefix}/compare/${base}...${commit}`, { status: 'ahead', base_commit: { sha: base }, merge_base_commit: { sha: base } });
  }
  repo('fawxzzy/socials-os', 1301080630, publication, rawFiles);
  const pins = { source: { commit: publication, sourceRevision: revision, sha256: hash(manifestBytes), admittedRevisions: [revision] },
    policy: { kind: 'host-private-v1', redactionRevision: policyRevision, sha256: hash(policyBytes), registryRevision: registry, approvalReceiptSha256: approvalReceipt } };
  const calls = []; const tokens = [];
  const tokenForRepository = async (id) => { tokens.push(id); return `fixture-token-${id}`; };
  const fetcher = async (url, options) => {
    calls.push({ url, options }); assert.equal(options.redirect, 'error'); assert.equal(new URL(url).hostname, 'api.github.com');
    return new Response(JSON.stringify(responses.get(url) ?? {}), { status: responses.has(url) ? 200 : 404 });
  };
  const readPolicy = async () => ({ bytes: Buffer.from(policyBytes), approvalReceiptSha256: approvalReceipt });
  return { pins, responses, calls, tokens, tokenForRepository, readPolicy, fetcher, clock };
}
async function prepare(f = fixture(), extra = {}) {
  return prepareIngestion({ source: await readTrustedSources(f), reconstruction: empty, expected, correlation, now, ...extra });
}
function retained(prepared) {
  return { correlation: prepared.correlation, request_digest: prepared.requestDigest, raw_request: prepared.rawRequest,
    trust_receipt: prepared.trustDigest, outcome: 'committed' };
}

test('pinned transitive runtime loads with exact dependencies', async () => { assert.equal(typeof (await loadRuntime()).project, 'function'); });
test('fixed private producer, independently held policy and raw-byte trust reach a closed candidate projection', async () => {
  const f = fixture(); const p = await prepare(f); const request = JSON.parse(p.rawRequest);
  assert.equal(p.health, 'healthy'); assert.equal(request.projection.cards[0].title, 'Reviewed title');
  assert.equal(JSON.stringify(request.projection).includes('PRIVATE_'), false);
  assert.equal(request.projection.authoritative, false); assert.equal(request.projection.actions_enabled, false);
  assert.deepEqual(f.tokens, [1301080630]); assert.ok(f.calls.every(c => !c.url.includes('fawxzzy-platform'))); assert.equal(p.requestDigest, hash(p.rawRequest));
  assert.equal(request.contributions[0].order_fraction, '123456789123456789');
});
for (const [label, mutate] of [
  ['producer cannot approve redaction', ({ manifest }) => { manifest.redactions = []; }],
  ['incomplete inventory', ({ manifest }) => { manifest.complete = false; }],
  ['duplicate source path', ({ manifest }) => { manifest.files.push(manifest.files[0]); }],
  ['traversal', ({ manifest }) => { manifest.files[0].path = 'operations/export/events/../sample.json'; }],
  ['source identity', ({ manifest }) => { manifest.producer_identity = 'github-repository:other'; }],
  ['policy revision', ({ policy }) => { policy.redaction_revision = 'f'.repeat(40); }],
  ['extra policy field', ({ policy }) => { policy.approved = true; }],
  ['foreign association', ({ manifest }) => { manifest.associations[0].producer_identity = 'another'; }],
]) test(`rejects ${label}`, async () => { await assert.rejects(readTrustedSources(fixture(mutate))); });
for (const [label, mutate] of [
  ['producer visibility becomes public', (r) => { r.get('https://api.github.com/repos/fawxzzy/socials-os').private = false; }],
  ['repository numeric drift', (r) => { r.get('https://api.github.com/repos/fawxzzy/socials-os').id = 1; }],
  ['lineage divergence', (r) => { [...r].find(([k]) => k.includes('/compare/'))[1].status = 'diverged'; }],
  ['symlink', (r) => { [...r.values()].find((x) => x.tree?.some((e) => e.type === 'blob')).tree.find((e) => e.type === 'blob').mode = '120000'; }],
  ['truncated tree', (r) => { [...r.values()].find((x) => x.tree && Array.isArray(x.tree)).truncated = true; }],
  ['blob drift', (r) => { [...r.values()].find((x) => x.encoding === 'base64').content = Buffer.from('{}').toString('base64'); }],
]) test(`transport rejects ${label}`, async () => { const f = fixture(); mutate(f.responses); await assert.rejects(readTrustedSources(f)); });
test('redirect/network failure is sanitized and never retried', async () => {
  const f = fixture(); let count = 0; f.fetcher = async () => { count += 1; throw new Error('PRIVATE_TOKEN'); };
  await assert.rejects(readTrustedSources(f), { message: 'OPS_SOURCE_TRANSPORT' }); assert.equal(count, 1);
});
test('oversized streaming response is stopped', async () => {
  const f = fixture(); f.fetcher = async () => new Response('x'.repeat(786433)); await assert.rejects(readTrustedSources(f));
});
test('changed pins fail before token acquisition', async () => {
  const f = fixture(); f.pins.source.url = 'https://attacker.invalid'; await assert.rejects(readTrustedSources(f)); assert.equal(f.tokens.length, 0);
});
test('whole-read budget cannot be extended by a caller', async () => {
  const f = fixture(); await assert.rejects(readTrustedSources({ ...f, timeoutMs: 60001 }), { message: 'OPS_SOURCE_BUDGET' });
  assert.equal(f.tokens.length, 0);
});
test('slow valid responses consume one shared deadline, never a fresh whole-read budget', async () => {
  const f = fixture(); const original = f.fetcher; let requests = 0; let signal;
  f.fetcher = async (url, options) => {
    requests += 1; signal = options.signal;
    await new Promise((resolve) => setTimeout(resolve, 400)); return original(url, options);
  };
  await assert.rejects(readTrustedSources({ ...f, timeoutMs: 1000 }), { message: 'OPS_SOURCE_DEADLINE' });
  assert.ok(requests >= 1 && requests < 6); assert.equal(signal.aborted, true);
});
test('whole-read deadline stops token acquisition without starting a request', async () => {
  const f = fixture(); let signal;
  f.tokenForRepository = (_, options) => { signal = options.signal; return new Promise(() => {}); };
  await assert.rejects(readTrustedSources({ ...f, timeoutMs: 1000 }), { message: 'OPS_SOURCE_DEADLINE' });
  assert.equal(signal.aborted, true); assert.equal(f.calls.length, 0);
});
test('whole-read deadline cancels a stalled body even if the transport ignores abort', async () => {
  const f = fixture(); let cancelled = false;
  f.fetcher = async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } }));
  await assert.rejects(readTrustedSources({ ...f, timeoutMs: 1000 }), { message: 'OPS_SOURCE_DEADLINE' });
  assert.equal(cancelled, true);
});
test('restart reconstructs all exact history and stable projection without leaking old bodies', async () => {
  const first = await prepare(); const request = JSON.parse(first.rawRequest);
  const reconstruction = { ...empty, generation: 2, revision: request.projection.projection_revision, observations: [retained(first)] };
  const second = await prepare(fixture(), { correlation: nextCorrelation, reconstruction, expected: { ...expected, generation: 2, revision: reconstruction.revision } });
  assert.equal(second.projectionRevision, first.projectionRevision);
});
for (const status of ['history_limit', 'head_changed']) test(`reconstruction ${status} never becomes empty history`, async () => {
  await assert.rejects(prepare(fixture(), { reconstruction: { status } }), { message: 'OPS_RECONSTRUCTION' });
});
test('retained request corruption is rejected', async () => {
  const first = await prepare(); const o = retained(first); o.raw_request += ' ';
  await assert.rejects(prepare(fixture(), { correlation: nextCorrelation, reconstruction: { ...empty, observations: [o] } }), { message: 'OPS_RETAINED_REQUEST' });
});
test('retained body tamper cannot be hidden by updating request digest', async () => {
  const first = await prepare(); const o = retained(first); const r = JSON.parse(o.raw_request); r.contributions[0].body += ' ';
  o.raw_request = JSON.stringify(r); o.request_digest = hash(o.raw_request);
  await assert.rejects(prepare(fixture(), { correlation: nextCorrelation, reconstruction: { ...empty, observations: [o] } }), { message: 'OPS_RETAINED_BODY' });
});
test('duplicate retained observations are rejected', async () => {
  const first = await prepare(); await assert.rejects(prepare(fixture(), { correlation: nextCorrelation,
    reconstruction: { ...empty, observations: [retained(first), retained(first)] } }), { message: 'OPS_RETAINED_REQUEST' });
});
test('source history cannot omit an earlier admitted revision', async () => {
  const first = await prepare(); const source = await readTrustedSources(fixture()); source.producer.admitted_revisions = ['f'.repeat(40)];
  await assert.rejects(prepareIngestion({ source, reconstruction: { ...empty, observations: [retained(first)] }, expected, correlation: nextCorrelation, now }), { message: 'OPS_RETAINED_PRODUCER' });
});
test('expired observation is not refreshed by caller time', async () => { await assert.rejects(prepare(fixture(), { now: '2026-10-16T03:01:00Z' }), { message: 'OPS_OBSERVATION_EXPIRED' }); });
test('exact UTC ordering retains sub-microsecond differences', () => {
  assert.deepEqual(exactOrder(stamp), { order_seconds: '63959252400', order_fraction: '123456789123456789' });
  assert.deepEqual(exactOrder('2026-10-15T04:00:00.10+01:00'), exactOrder('2026-10-15T03:00:00.1Z'));
  for (const s of ['2026-02-30T00:00:00Z', '2026-10-15T03:00:60Z', '2026-10-15T03:00:00-00:00']) assert.throws(() => exactOrder(s));
});

function db(mode = 'normal') {
  const calls = []; let connections = 0;
  return { calls, connect: async () => {
    const id = ++connections;
    return { end: async () => { calls.push([id, 'END']); }, query: async (sql, params) => {
      calls.push([id, sql, params]);
      if (sql.startsWith('SELECT NOT')) return { rows: [{ allowed: mode !== 'privileged' }] };
      if (sql.includes('operations_ingest')) {
        if (mode === 'abort') throw new Error('PRIVATE_DATABASE_ERROR');
        return { rows: [{ value: { outcome: 'committed', correlation, revision: `sha256:${'1'.repeat(64)}` } }] };
      }
      if (sql === 'COMMIT' && ['lost', 'unknown'].includes(mode)) throw new Error('PRIVATE_ACK_ERROR');
      if (sql.includes('operations_settlement')) return { rows: [{ value: mode === 'lost' ? { outcome: 'committed', correlation } : { outcome: 'not_observed' } }] };
      return { rows: [] };
    } };
  } };
}
test('store uses one client/parameterized request and one COMMIT', async () => {
  const d = db(); const p = await prepare(); const result = await createOperationsStore(d.connect).execute(p);
  assert.equal(result.status, 'settled'); assert.equal(new Set(d.calls.map((x) => x[0])).size, 1);
  assert.equal(d.calls.filter((x) => x[1] === 'COMMIT').length, 1);
  assert.deepEqual(d.calls.find((x) => x[1].includes('operations_ingest'))[2], [p.rawRequest]);
});
test('lost COMMIT acknowledgment settles by exact correlation/digest without replay', async () => {
  const d = db('lost'); const p = await prepare(); const result = await createOperationsStore(d.connect).execute(p);
  assert.equal(result.status, 'settled'); assert.equal(d.calls.filter((x) => x[1].includes('operations_ingest')).length, 1);
  assert.deepEqual(d.calls.find((x) => x[1].includes('operations_settlement'))[2], [p.correlation, p.requestDigest]);
});
test('unobserved commit remains unknown with no retry', async () => {
  const d = db('unknown'); const result = await createOperationsStore(d.connect).execute(await prepare());
  assert.equal(result.status, 'unknown'); assert.equal(d.calls.filter((x) => x[1] === 'COMMIT').length, 1);
});
test('pre-commit failure rolls back and sanitizes error', async () => {
  const d = db('abort'); await assert.rejects(createOperationsStore(d.connect).execute(await prepare()), { message: 'OPS_TRANSACTION_ABORTED' });
  assert.equal(d.calls.some((x) => x[1] === 'ROLLBACK'), true); assert.equal(d.calls.some((x) => x[1] === 'COMMIT'), false);
});
test('privileged connection cannot run ingestion', async () => {
  const d = db('privileged'); await assert.rejects(createOperationsStore(d.connect).execute(await prepare()), { message: 'OPS_DATABASE_ROLE' });
  assert.equal(d.calls.some((x) => x[1] === 'BEGIN'), false);
});
test('TLS connector rejects service-role and connection-string overrides before connect', () => {
  assert.throws(() => createTlsConnector({ connectionString: 'postgres://secret' }));
  const config = { host: 'aws-0-fixture.pooler.supabase.com', port: 6543, database: 'postgres', user: 'postgres', password: 'fixture', ca: 'fixture' };
  assert.throws(() => createTlsConnector(config));
  assert.throws(() => createTlsConnector({ ...config, user: 'platform_ops_ingest_login.bxtcuhkotumitoqtrcej', host: 'attacker.invalid' }));
});

function host(f, mutate = () => {}) {
  const steps = []; const state = structuredClone(expected); let effects = 0;
  const gate = { assertPreflight: async () => { steps.push('preflight'); },
    readPolicy: async ({ policyPins, signal }) => { steps.push('policy'); assert.deepEqual(policyPins, f.pins.policy); assert.equal(signal.aborted, false); return f.readPolicy({ pins: policyPins, signal }); }, readControlState: async () => ({ ...state }),
    admitRequest: async (p) => { steps.push('admit'); assert.equal(hash(p.rawRequest), p.requestDigest); return { status: 'admitted', correlation: p.correlation, requestDigest: p.requestDigest }; },
    assertEffectBoundary: async () => { steps.push('effect'); }, recordTerminal: async (receipt) => { steps.push('receipt'); assert.equal(JSON.stringify(receipt).includes('PRIVATE_'), false); } };
  const store = { reconstruction: async () => empty,
    execute: async (p) => { effects += 1; return { status: 'settled', outcome: 'committed', correlation: p.correlation }; } };
  mutate({ gate, store, state });
  return { args: { gate, store, ...f, correlation }, steps, effects: () => effects };
}
test('whole host adapter orders gate, preparation, admission, recheck, effect and receipt', async () => {
  const h = host(fixture()); const receipt = await ingestOnce(h.args);
  assert.equal(receipt.outcome, 'committed'); assert.equal(h.effects(), 1); assert.deepEqual(h.steps, ['preflight', 'policy', 'admit', 'effect', 'receipt']);
});
test('missing canonical gate fails before any source access', async () => {
  const f = fixture(); await assert.rejects(ingestOnce({ ...f, correlation }), { message: 'OPS_CANONICAL_GATE_REQUIRED' }); assert.equal(f.tokens.length, 0);
});
test('head drift after admission stops before effect', async () => {
  const h = host(fixture(), ({ gate, state }) => { gate.assertEffectBoundary = async () => { state.generation += 1; }; });
  assert.equal((await ingestOnce(h.args)).status, 'stopped'); assert.equal(h.effects(), 0);
});
test('failed admission does not execute', async () => {
  const h = host(fixture(), ({ gate }) => { gate.admitRequest = async () => { throw new Error('DENIED'); }; });
  assert.equal((await ingestOnce(h.args)).status, 'stopped'); assert.equal(h.effects(), 0);
});
for (const [label, result] of [
  ['missing', () => undefined], ['null', () => null],
  ['unknown commit', p => ({ status: 'unknown', correlation: p.correlation, requestDigest: p.requestDigest })],
  ['wrong correlation', p => ({ status: 'admitted', correlation: nextCorrelation, requestDigest: p.requestDigest })],
  ['wrong digest', p => ({ status: 'admitted', correlation: p.correlation, requestDigest: hash('other') })],
  ['extra field', p => ({ status: 'admitted', correlation: p.correlation, requestDigest: p.requestDigest, ignored: true })],
]) test(`unconfirmed ${label} admission stops before effect boundary`, async () => {
  const h = host(fixture(), ({ gate }) => { gate.admitRequest = async p => result(p); });
  assert.equal((await ingestOnce(h.args)).status, 'stopped'); assert.equal(h.effects(), 0);
  assert.equal(h.steps.includes('effect'), false);
});
test('receipt failure preserves settled effect and never repeats it', async () => {
  const h = host(fixture(), ({ gate }) => { gate.recordTerminal = async () => { throw new Error('DISK'); }; });
  const receipt = await ingestOnce(h.args); assert.equal(receipt.receiptPersistence, 'unknown'); assert.equal(receipt.outcome, 'committed'); assert.equal(h.effects(), 1);
});

test('legacy public Git policy pins are refused before credential access', async () => {
  const f = fixture(); f.pins.policy = { commit: 'e'.repeat(40), sourceRevision: policyRevision, sha256: f.pins.policy.sha256, registryRevision: registry };
  await assert.rejects(readTrustedSources(f)); assert.equal(f.tokens.length, 0);
});
test('private policy is mandatory and cannot be provided by producer fields', async () => {
  const f = fixture(); delete f.readPolicy;
  await assert.rejects(readTrustedSources(f), { message: 'OPS_PRIVATE_POLICY_REQUIRED' }); assert.equal(f.tokens.length, 0);
});
for (const [name, change] of [
  ['changed bytes', r => { r.bytes = Buffer.from('{}'); }],
  ['wrong approval receipt', r => { r.approvalReceiptSha256 = 'sha256:' + '0'.repeat(64); }],
  ['oversized bytes', r => { r.bytes = new Uint8Array(262145); }],
  ['string instead of bytes', r => { r.bytes = '{}'; }],
  ['unapproved extra return field', r => { r.approved = true; }],
]) test(`private policy refuses ${name} before Git credentials`, async () => {
  const f = fixture(); const original = f.readPolicy;
  f.readPolicy = async (...args) => { const r = await original(...args); change(r); return r; };
  await assert.rejects(readTrustedSources(f), { message: 'OPS_PRIVATE_POLICY' }); assert.equal(f.tokens.length, 0);
});
test('private policy acquisition consumes the shared deadline', async () => {
  const f = fixture(); let signal;
  f.readPolicy = async options => { signal = options.signal; return new Promise(() => {}); };
  await assert.rejects(readTrustedSources({ ...f, timeoutMs: 50 }), { message: 'OPS_SOURCE_DEADLINE' });
  assert.equal(signal.aborted, true); assert.equal(f.tokens.length, 0);
});
test('private policy errors never expose source detail', async () => {
  const f = fixture(); f.readPolicy = async () => { throw new Error('PRIVATE_POLICY_CONTENT'); };
  await assert.rejects(readTrustedSources(f), { message: 'OPS_PRIVATE_POLICY' }); assert.equal(f.tokens.length, 0);
});
test('host requires canonical policy capability, not caller replacement', async () => {
  const h = host(fixture()); delete h.args.gate.readPolicy;
  await assert.rejects(ingestOnce(h.args), { message: 'OPS_CANONICAL_GATE_REQUIRED' }); assert.equal(h.effects(), 0);
});
test('host policy refusal prevents admission and effect', async () => {
  const h = host(fixture(), ({gate}) => { gate.readPolicy = async () => { throw new Error('UNAPPROVED'); }; });
  assert.equal((await ingestOnce(h.args)).status, 'stopped'); assert.equal(h.effects(), 0);
  assert.deepEqual(h.steps, ['preflight', 'receipt']);
});
test('source trust binds private policy identity without including policy bytes', async () => {
  const f = fixture(); const source = await readTrustedSources(f);
  assert.equal(source.trust.policy.sha256, f.pins.policy.sha256);
  assert.equal(source.trust.policy.approval_receipt_sha256, approvalReceipt);
  assert.equal(JSON.stringify(source.trust).includes('Reviewed title'), false);
});
