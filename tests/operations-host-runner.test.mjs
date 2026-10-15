import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { createPipe, runHost } from '../scripts/operations/canonical-host-runner.mjs';
import { hash } from '../src/server/operations/runtime.mjs';

const correlation = '33333333-3333-3333-3333-333333333333';
const pins = { source: {}, policy: {} };
const init = () => ({ protocol: 'atlas-private-operations-host-v1', pins, correlation, expiresAt: new Date(Date.now() + 60000).toISOString() });
const scope = { target: 'bxtcuhkotumitoqtrcej', writerScope: 'platform.private-operations.ingest', correlation, pinsDigest: hash(JSON.stringify(pins)) };
const prepared = { rawRequest: '{}', requestDigest: hash('{}'), trustDigest: hash('trust'), correlation, expectedGeneration: 1,
  expectedHead: null, registryRevision: 'a'.repeat(40), redactionRevision: 'b'.repeat(40), health: 'healthy', projectionRevision: hash('projection') };
function fixture(change = {}) {
  const messages = []; const calls = []; const config = init();
  const pipe = { read: async () => config, request: async (method, value) => {
    messages.push({ method, value });
    if (method === 'preflight') return { control: {}, ingest: {}, githubToken: 'FIXTURE_SECRET' };
    if (method === 'policy') return { bytes: Buffer.from('{}').toString('base64'), approvalReceiptSha256: hash('review') };
    if (method === 'admit') return { requestDigest: prepared.requestDigest, expiresAt: config.expiresAt };
    if (method === 'effect') return { expiresAt: config.expiresAt };
    if (method === 'terminal') return { recorded: true };
    throw new Error('unexpected');
  } };
  const controlFactory = () => ({ readState: async () => { calls.push('state'); return { generation: 1 }; },
    admit: async (p) => { assert.deepEqual(p, prepared); calls.push('admit'); return { status: 'admitted', correlation, requestDigest: p.requestDigest }; } });
  const storeFactory = () => ({ reconstruction: async () => { calls.push('reconstruction'); return {}; },
    execute: async () => { calls.push('execute'); return { status: 'settled', outcome: 'committed', correlation }; } });
  const ingest = async ({ gate, store, tokenForRepository }) => {
    await gate.assertPreflight(scope); await gate.readControlState(); await store.reconstruction(1);
    const policy = await gate.readPolicy({ ...scope, policyPins: pins.policy }); assert.deepEqual(policy.bytes, Buffer.from('{}'));
    assert.equal(await tokenForRepository(1301080630), 'FIXTURE_SECRET');
    const admission = await gate.admitRequest({ ...scope, ...prepared }); assert.equal(admission.status, 'admitted');
    await gate.assertEffectBoundary({ ...scope, requestDigest: prepared.requestDigest, trustDigest: prepared.trustDigest,
      expectedGeneration: 1, expectedHead: null });
    await gate.readControlState(); const result = await store.execute(prepared); await gate.recordTerminal(result);
    return { ...result, receiptPersistence: 'recorded' };
  };
  return { config, messages, calls, pipe, options: { controlFactory, storeFactory, ingest, ...change } };
}

test('six callbacks use one ordered host exchange and fixed adapters', async () => {
  const f = fixture(); const result = await runHost(f.pipe, f.options);
  assert.equal(result.status, 'settled'); assert.deepEqual(f.messages.map((x) => x.method), ['preflight', 'policy', 'admit', 'effect', 'terminal']);
  assert.deepEqual(f.calls, ['state', 'reconstruction', 'admit', 'state', 'execute']);
  assert.equal(JSON.stringify(f.messages).includes('FIXTURE_SECRET'), false);
});
test('expired init prevents credential acquisition', async () => {
  const f = fixture(); f.config.expiresAt = '2000-01-01T00:00:00Z'; await assert.rejects(runHost(f.pipe, f.options)); assert.equal(f.messages.length, 0);
});
test('closed init refuses flags and unknown protocol', async () => {
  for (const change of [{ allow: true }, { protocol: 'fake' }, { correlation: 'x' }]) {
    const f = fixture(); Object.assign(f.config, change); await assert.rejects(runHost(f.pipe, f.options)); assert.equal(f.messages.length, 0);
  }
});
test('database or credential callbacks cannot run before preflight', async () => {
  for (const call of [async (g, s) => g.readControlState(), async (g, s) => s.execute(prepared), async (g, s) => s.reconstruction(1)]) {
    const f = fixture({ ingest: async ({ gate, store }) => call(gate, store) }); await assert.rejects(runHost(f.pipe, f.options)); assert.equal(f.calls.length, 0);
  }
});
test('token restricted to exact source repository after policy custody', async () => {
  const f = fixture({ ingest: async ({ gate, tokenForRepository }) => {
    await gate.assertPreflight(scope); await assert.rejects(tokenForRepository(1301080630));
    await gate.readPolicy({ ...scope, policyPins: pins.policy }); await assert.rejects(tokenForRepository(1));
    await gate.recordTerminal({ status: 'stopped', correlation }); return { receiptPersistence: 'recorded' };
  } }); await runHost(f.pipe, f.options);
});
test('admission permit digest mismatch prevents database admission', async () => {
  const f = fixture(); const request = f.pipe.request;
  f.pipe.request = async (m, v) => m === 'admit' ? { requestDigest: hash('wrong'), expiresAt: f.config.expiresAt } : request(m, v);
  await assert.rejects(runHost(f.pipe, f.options)); assert.equal(f.calls.includes('admit'), false);
});
test('terminal persistence failure cannot claim completion', async () => {
  const f = fixture(); const request = f.pipe.request;
  f.pipe.request = async (m, v) => m === 'terminal' ? { recorded: false } : request(m, v);
  await assert.rejects(runHost(f.pipe, f.options));
});
test('no duplicate execution or terminal callback', async () => {
  const f = fixture(); const original = f.options.ingest;
  f.options.ingest = async (options) => { const result = await original(options); await assert.rejects(options.store.execute(prepared));
    await assert.rejects(options.gate.recordTerminal({ status: 'stopped', correlation })); return result; };
  await runHost(f.pipe, f.options); assert.equal(f.calls.filter((x) => x === 'execute').length, 1);
});
test('pipe parses split frame and matches response identity', async () => {
  const input = new PassThrough(); const output = new PassThrough(); const pipe = createPipe(input, output);
  try {
    const first = pipe.read(); input.write('{"a":'); input.write('1}\n'); assert.deepEqual(await first, { a: 1 });
    const pending = pipe.request('preflight', {}); input.write('{"id":1,"ok":true,"value":{}}\n'); assert.deepEqual(await pending, {});
  } finally { pipe.close(); }
});
test('pipe rejects duplicate keys, multiple frames, invalid UTF8 and oversize', async () => {
  for (const raw of [Buffer.from('{"a":1,"a":2}\n'), Buffer.from('{}\n{}\n'), Buffer.from([255, 10]), Buffer.alloc(16 * 1048576 + 1, 65)]) {
    const input = new PassThrough(); const pipe = createPipe(input, new PassThrough());
    try { const pending = pipe.read(); input.write(raw); await assert.rejects(pending); } finally { pipe.close(); }
  }
});

test('provider mode routes all database operations through the parent without DB credentials', async () => {
  const f = fixture(); f.config.transportMode = 'existing-master-broker-v1';
  const request = f.pipe.request;
  f.pipe.request = async (method, value) => {
    if (['preflight', 'state', 'reconstruction', 'admit', 'ingest'].includes(method)) {
      f.messages.push({ method, value });
      if (method === 'preflight') return { githubToken: 'FIXTURE_SECRET' };
      if (method === 'state') return { generation: 1 };
      if (method === 'reconstruction') return {};
      if (method === 'admit') return { requestDigest: prepared.requestDigest, expiresAt: f.config.expiresAt,
        admission: { status: 'admitted', correlation, requestDigest: prepared.requestDigest } };
      return { status: 'settled', outcome: 'committed', correlation, revision: prepared.projectionRevision };
    }
    return request(method, value);
  };
  f.options.controlFactory = () => { throw new Error('DB credentials reached child'); };
  f.options.storeFactory = () => { throw new Error('DB credentials reached child'); };
  assert.equal((await runHost(f.pipe, f.options)).status, 'settled');
  assert.deepEqual(f.messages.map((x) => x.method), ['preflight', 'state', 'reconstruction', 'policy', 'admit', 'effect', 'state', 'ingest', 'terminal']);
  assert.equal(f.calls.length, 0);
});
test('provider mode refuses credential expansion and unknown transport', async () => {
  const f = fixture(); f.config.transportMode = 'existing-master-broker-v1';
  await assert.rejects(runHost(f.pipe, f.options)); assert.equal(f.calls.length, 0);
  const bad = fixture(); bad.config.transportMode = 'arbitrary';
  await assert.rejects(runHost(bad.pipe, bad.options)); assert.equal(bad.messages.length, 0);
});

function brokerFixture(result, transportFailure = false) {
  const f = fixture(); f.config.transportMode = 'existing-master-broker-v1';
  const request = f.pipe.request;
  f.pipe.request = async (method, value) => {
    if (!['preflight', 'state', 'reconstruction', 'admit', 'ingest'].includes(method)) return request(method, value);
    f.messages.push({ method, value });
    if (method === 'preflight') return { githubToken: 'FIXTURE_SECRET' };
    if (method === 'state') return { generation: 1 };
    if (method === 'reconstruction') return {};
    if (method === 'admit') return { requestDigest: prepared.requestDigest, expiresAt: f.config.expiresAt,
      admission: { status: 'admitted', correlation, requestDigest: prepared.requestDigest } };
    if (transportFailure) throw new Error('PRIVATE_PROVIDER_FAILURE');
    return result;
  };
  return f;
}

for (const [name, value] of Object.entries({
  null: null, missing: {}, missingStatus: { outcome: 'committed', correlation, revision: prepared.projectionRevision },
  wrongStatus: { status: 'success', outcome: 'committed', correlation, revision: prepared.projectionRevision },
  wrongCorrelation: { status: 'settled', outcome: 'committed', correlation: 'wrong', revision: prepared.projectionRevision },
  wrongOutcome: { status: 'settled', outcome: 'failed', correlation, revision: null },
  missingRevision: { status: 'settled', outcome: 'committed', correlation },
  wrongRevision: { status: 'settled', outcome: 'committed', correlation, revision: hash('other') },
  falseQuarantine: { status: 'settled', outcome: 'quarantined', correlation, revision: prepared.projectionRevision },
  expanded: { status: 'settled', outcome: 'committed', correlation, revision: prepared.projectionRevision, secret: 'PRIVATE' },
  wrongUnknownDigest: { status: 'unknown', correlation, requestDigest: hash('other') },
})) {
  test(`malformed broker ${name} remains correlated unknown after one effect`, async () => {
    const f = brokerFixture(value); const result = await runHost(f.pipe, f.options);
    assert.deepEqual(result, { status: 'unknown', correlation, requestDigest: prepared.requestDigest, receiptPersistence: 'recorded' });
    assert.equal(f.messages.filter((x) => x.method === 'ingest').length, 1);
    assert.deepEqual(f.messages.at(-1), { method: 'terminal', value: { status: 'unknown', correlation, requestDigest: prepared.requestDigest } });
  });
}
for (const outcome of ['committed', 'duplicate', 'quarantined']) {
  test(`valid broker ${outcome} retains exact prepared identity`, async () => {
    const value = { status: 'settled', outcome, correlation, revision: outcome === 'quarantined' ? null : prepared.projectionRevision };
    const f = brokerFixture(value); assert.deepEqual(await runHost(f.pipe, f.options), { ...value, receiptPersistence: 'recorded' });
    assert.equal(f.messages.filter((x) => x.method === 'ingest').length, 1);
  });
}
test('broker unknown and lost acknowledgement never replay or claim stopped', async () => {
  for (const lost of [false, true]) {
    const expected = { status: 'unknown', correlation, requestDigest: prepared.requestDigest };
    const f = brokerFixture(expected, lost);
    assert.deepEqual(await runHost(f.pipe, f.options), { ...expected, receiptPersistence: 'recorded' });
    assert.equal(f.messages.filter((x) => x.method === 'ingest').length, 1);
  }
});
test('pipe rejects mismatched acknowledgement and EOF', async () => {
  const input = new PassThrough(); const pipe = createPipe(input, new PassThrough());
  try { const pending = pipe.request('x', {}); input.write('{"id":2,"ok":true,"value":{}}\n'); await assert.rejects(pending);
    const next = pipe.read(); input.end(); await assert.rejects(next); } finally { pipe.close(); }
});

test('bounded reconstruction envelope exceeds one document without weakening duplicate rejection', async () => {
  for (const duplicate of [false, true]) {
    const input = new PassThrough(); const pipe = createPipe(input, new PassThrough());
    try {
      const value = { body: 'x'.repeat(2 * 1048576), id: 1 };
      const raw = JSON.stringify(value).slice(0, -1) + (duplicate ? ',"id":2}' : '}');
      const pending = pipe.read(); input.write(`${raw}\n`);
      if (duplicate) await assert.rejects(pending);
      else assert.deepEqual(await pending, value);
    } finally { pipe.close(); }
  }
});
