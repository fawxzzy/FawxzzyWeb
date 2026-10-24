import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { CARD_SQL, createPrivateCardRoleStore, createPrivateCardTlsConnector } from '../src/server/projects/private-card-role-store.mjs';
import { createPrivateCardOwnerService } from '../src/server/projects/private-card-owner-service.mjs';
import { MASTER } from '../src/server/operations/consumer-auth.mjs';

// Provider-free fixtures: graph/body hashes below are fixed synthetic bytes,
// not a claim of PostgreSQL JSONB digest or hosted grant-state equivalence.
const digest = (c) => `sha256:${c.repeat(64)}`;
const hash = (v) => `sha256:${createHash('sha256').update(JSON.stringify(v)).digest('hex')}`;
const owner = '11111111-1111-1111-1111-111111111111';
const session = '22222222-2222-2222-2222-222222222222';
const mapping = { status: 'ACCEPTED', sourceId: 'FW-ANALYTICS-001', proposedStableId: 'FF-WEB-ANALYTICS-001',
  board: 'fawxzzyweb', sourceRevision: 'a'.repeat(40), boardRevision: digest('b') };
const body = { stable_id: mapping.proposedStableId, version: 1, visibility: 'PRIVATE',
  source_card_id: mapping.sourceId, title: 'Traffic', summary: 'Plan', lifecycle: 'planning', criteria: ['PRIVATE_BODY'] };
function fixture(overrides = {}) {
  let time = 1000000; const calls = []; const entries = new Map();
  const membership = { board: mapping.board, stableId: mapping.proposedStableId, version: 1,
    visibility: 'PRIVATE', sourceId: mapping.sourceId, sourceRevision: mapping.sourceRevision, boardRevision: mapping.boardRevision };
  const selection = { mapping, version: 1, bodyDigest: digest('c'), graphDigest: digest('d'),
    membership, membershipDigest: hash(membership) };
  const payload = { batch_id: 'web_batch', baseline: [], changes: [{ stable_id: body.stable_id,
    expected_version: 0, expected_body_digest: null, next: body }] };
  const admission = { payload, payloadDigest: hash(payload), inputDigest: digest('f'), baselineDigest: digest('0'),
    postGraphDigest: digest('d'), sourceRevision: mapping.sourceRevision, trustReceipt: digest('1'),
    expiresAt: new Date(time + 300000).toISOString() };
  const receipt = { batch_id: payload.batch_id, input_digest: admission.inputDigest,
    baseline_digest: admission.baselineDigest, post_graph_digest: admission.postGraphDigest, changed_ids: [body.stable_id] };
  const store = {
    seal: async () => { calls.push('seal'); return { state: 'committed', value: admission.inputDigest }; },
    apply: async () => { calls.push('apply'); return { state: 'committed', value: { ...receipt, disposition: 'committed' } }; },
    readBatch: async () => { calls.push('readBatch'); return { state: 'committed', value: receipt }; },
    readGraph: async () => { calls.push('readGraph'); return { state: 'committed', value: {
      graph_digest: selection.graphDigest, cards: [{ body, body_digest: selection.bodyDigest },
        { body: { stable_id: 'FF-FOREIGN', secret: 'FOREIGN_PRIVATE_BODY' }, body_digest: digest('2') }] } }; },
    ...overrides.store,
  };
  const journal = {
    claim: async (key, value) => { if (entries.has(key)) return false; entries.set(key, structuredClone(value)); return true; },
    set: async (key, value) => { entries.set(key, structuredClone(value)); }, get: async (key) => entries.get(key),
    ...overrides.journal,
  };
  const claims = { sub: owner, session_id: session, iss: `${MASTER}/auth/v1`, aud: 'authenticated',
    role: 'authenticated', exp: 1900 };
  const token = `aaa.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.ccc`;
  const request = () => new Request('https://account.fawxzzy.com/api/projects/private-card', { headers: { Authorization: `Bearer ${token}` } });
  const binding = { schema: 'private-card-owner-binding.v1', state: 'ACCEPTED', subject: owner, session,
    selectionDigest: hash(selection), planDigest: hash(admission), nextBodyDigest: hash(body) };
  const config = { ownerSubject: owner, ownerSession: session, selection, admission, binding, store, journal,
    verifyHostBinding: async () => true, // Synthetic host only; no actual trust/membership receipt or DB digest proof.
    auth: { url: MASTER, publishableKey: `sb_publishable_${'x'.repeat(20)}` }, now: () => time,
    authOptions: { now: () => time, fetchImpl: async () => Response.json({ id: owner, is_anonymous: false }) },
    ...overrides.config };
  return { service: createPrivateCardOwnerService(config), request, entries, calls, store, journal, config,
    admission, selection, receipt, setTime: (v) => { time = v; } };
}

test('real Auth Request shape verifies owner/session before any fixed-role call', async () => {
  const f = fixture(); const value = await f.service.read(f.request());
  assert.deepEqual(f.calls, ['readGraph']); assert.equal(value.stable_id, body.stable_id);
  assert.equal(JSON.stringify(value).includes('PRIVATE_BODY'), false);
  assert.equal(JSON.stringify(value).includes('FOREIGN'), false);
  assert.equal(Object.hasOwn(value, 'body'), false);
});
test('signed-out, foreign owner, wrong session and stale identity deny before connector', async () => {
  const signedOut = fixture(); await assert.rejects(signedOut.service.read(new Request('https://account.fawxzzy.com')));
  assert.deepEqual(signedOut.calls, []);
  for (const identity of [{ subject: session, session, expires: 1900 },
    { subject: owner, session: owner, expires: 1900 }, { subject: owner, session, expires: 1000 }]) {
    const f = fixture({ config: { authenticateRequest: async () => identity } });
    await assert.rejects(f.service.apply(f.request())); assert.deepEqual(f.calls, []); assert.equal(f.entries.size, 0);
  }
});
test('pending mapping, wrong private board or missing membership pin denies preconnector', async () => {
  for (const change of [{ mapping: { ...mapping, status: 'PENDING_CANONICAL_EQUIVALENCE' } },
    { mapping: { ...mapping, board: 'fitness' } }, { membershipDigest: null }]) {
    const base = fixture(); const f = fixture({ config: { selection: { ...base.selection, ...change } } });
    await assert.rejects(f.service.read(f.request())); assert.deepEqual(f.calls, []);
  }
});
test('exact immutable source batch seals before apply and occupies replay across service instances', async () => {
  const f = fixture(); assert.deepEqual(await f.service.apply(f.request()), { state: 'committed' });
  assert.deepEqual(f.calls, ['seal', 'apply']);
  const reopened = createPrivateCardOwnerService(f.config);
  await assert.rejects(reopened.apply(f.request())); assert.deepEqual(f.calls, ['seal', 'apply']);
});
test('caller mutation cannot alter snapshotted source content or trust pins', async () => {
  const f = fixture(); f.admission.payload.changes[0].next = { secret: 'changed' };
  f.selection.mapping = { ...mapping, board: 'foreign' };
  assert.deepEqual(await f.service.apply(f.request()), { state: 'committed' });
});
test('stale graph/version/body and colliding batch are rejected without replay', async () => {
  for (const cause of ['PRIVATE_CARD_GRAPH_PREIMAGE', 'PRIVATE_CARD_CAS', 'PRIVATE_CARD_BATCH_COLLISION']) {
    const f = fixture({ store: { apply: async () => ({ state: 'rejected', error: cause }) } });
    assert.deepEqual(await f.service.apply(f.request()), { state: 'apply_rejected' });
    await assert.rejects(f.service.apply(f.request())); assert.deepEqual(f.calls, ['seal']);
  }
});
test('seal uncertainty stays occupied and cannot be reconciled using read_batch', async () => {
  const f = fixture({ store: { seal: async () => ({ state: 'unknown' }) } });
  assert.deepEqual(await f.service.apply(f.request()), { state: 'seal_unknown' });
  await assert.rejects(f.service.apply(f.request())); await assert.rejects(f.service.reconcile(f.request()));
  assert.deepEqual(f.calls, []);
});
test('apply uncertainty may only reconcile matching committed batch, even after admission expiry', async () => {
  const f = fixture({ store: { apply: async () => ({ state: 'unknown' }) } });
  assert.deepEqual(await f.service.apply(f.request()), { state: 'apply_unknown' });
  f.setTime(1400000);
  assert.deepEqual(await f.service.reconcile(f.request()), { state: 'committed' });
  assert.deepEqual(f.calls, ['seal', 'readBatch']); await assert.rejects(f.service.apply(f.request()));
});
test('null/partial/foreign reconciliation results never clear an unknown batch', async () => {
  for (const value of [null, {}, { batch_id: 'foreign' }]) {
    const f = fixture({ store: { apply: async () => ({ state: 'unknown' }),
      readBatch: async () => ({ state: 'committed', value }) } });
    await f.service.apply(f.request()); assert.deepEqual(await f.service.reconcile(f.request()), { state: 'apply_unknown' });
    await assert.rejects(f.service.apply(f.request()));
  }
});
test('journal claim failure prevents seal and loss after seal never reopens the operation', async () => {
  const denied = fixture({ journal: { claim: async () => false } });
  await assert.rejects(denied.service.apply(denied.request())); assert.deepEqual(denied.calls, []);
  const lost = fixture({ journal: { set: async () => { throw new Error('PRIVATE_TOKEN'); } } });
  await assert.rejects(lost.service.apply(lost.request()), { message: 'CARD_UNAVAILABLE' });
  await assert.rejects(lost.service.apply(lost.request())); assert.deepEqual(lost.calls, ['seal']);
});
test('authorization expiry during pending journal persistence prevents writer call', async () => {
  const f = fixture(); const originalSet = f.journal.set;
  f.journal.set = async (key, value) => {
    await originalSet(key, value);
    if (value.state === 'apply_pending') f.setTime(1900000);
  };
  await assert.rejects(f.service.apply(f.request()), { message: 'CARD_UNAVAILABLE' });
  assert.deepEqual(f.calls, ['seal']);
  assert.equal(f.entries.get('web_batch').state, 'apply_pending');
  await assert.rejects(f.service.apply(f.request()));
  assert.deepEqual(f.calls, ['seal']);
});
test('independent host binding is mandatory; inconsistent selection/plan/membership/body pins deny before role calls', async () => {
  const base = fixture();
  for (const changes of [{ verifyHostBinding: async () => false },
    { selection: { ...base.selection, graphDigest: digest('3') } },
    { selection: { ...base.selection, version: 2 } },
    { selection: { ...base.selection, membership: { ...base.selection.membership, visibility: 'PUBLIC' } } },
    { binding: { ...base.config.binding, nextBodyDigest: digest('4') } },
    { admission: { ...base.admission, trustReceipt: digest('5') } }]) {
    const f = fixture({ config: changes }); await assert.rejects(f.service.apply(f.request()), { message: 'CARD_UNAVAILABLE' });
    assert.deepEqual(f.calls, []); assert.equal(f.entries.size, 0);
  }
  assert.throws(() => createPrivateCardOwnerService({ ...base.config, verifyHostBinding: undefined }));
});
test('known committed apply can reconcile after auth expires or terminal journal write fails, without reapply', async () => {
  for (const mode of ['expired', 'journal']) {
    const f = fixture(); const originalApply = f.store.apply; const originalSet = f.journal.set;
    f.store.apply = async (...args) => { const result = await originalApply(...args); if (mode === 'expired') f.setTime(1900000); return result; };
    f.journal.set = async (key, value) => { if (mode === 'journal' && value.state === 'committed') throw new Error('PRIVATE_DATA'); return originalSet(key, value); };
    await assert.rejects(f.service.apply(f.request()), { message: 'CARD_UNAVAILABLE' });
    assert.equal(f.entries.get('web_batch').state, 'apply_pending');
    f.setTime(1000000); f.journal.set = originalSet;
    assert.deepEqual(await f.service.reconcile(f.request()), { state: 'committed' });
    assert.deepEqual(f.calls, ['seal', 'apply', 'readBatch']); await assert.rejects(f.service.apply(f.request()));
  }
});
test('graph drift, duplicate selected IDs, body/version drift and oversized graphs never reflect private data', async () => {
  const base = fixture(); const good = (await base.store.readGraph()).value;
  for (const value of [{ ...good, graph_digest: digest('9') }, { ...good, cards: [good.cards[0], good.cards[0]] },
    { ...good, cards: [{ ...good.cards[0], body_digest: digest('8') }] },
    { ...good, cards: [{ ...good.cards[0], body: { ...body, version: 2 } }] },
    { ...good, cards: Array(4097).fill(good.cards[0]) }]) {
    const f = fixture({ store: { readGraph: async () => ({ state: 'committed', value }) } });
    await assert.rejects(f.service.read(f.request()), { message: 'CARD_UNAVAILABLE' });
  }
});
test('auth expiration after a graph read suppresses its result', async () => {
  const f = fixture(); const original = f.store.readGraph;
  f.store.readGraph = async () => { const v = await original(); f.setTime(1900000); return v; };
  await assert.rejects(f.service.read(f.request()), { message: 'CARD_UNAVAILABLE' });
});

function transport({ failAt, allowed = true, wrongLogin = false, rollbackFails = false } = {}) {
  const calls = []; const connectors = {};
  for (const kind of ['sealer', 'writer', 'reader']) connectors[kind] = async () => ({
    query: async (sql, values) => {
      calls.push({ kind, sql, values });
      if (sql.includes('session_user AS')) return { rows: [{ session_user: wrongLogin ? 'postgres' : `platform_card_${kind}_login`,
        current_user: `platform_card_${kind}_login`, allowed }] };
      if (sql === failAt || (rollbackFails && sql === 'ROLLBACK')) throw new Error('PRIVATE_PASSWORD');
      return { rows: [{ value: kind === 'sealer' ? digest('f') : {} }] };
    }, end: async () => { calls.push({ kind, sql: 'END' }); },
  });
  return { store: createPrivateCardRoleStore(connectors), calls };
}
test('four fixed operations use distinct role/session checks and parameterized SQL only', async () => {
  const f = transport(); const p = fixture().admission;
  await f.store.seal(p); await f.store.apply(p.payload); await f.store.readBatch(p.payload.batch_id); await f.store.readGraph();
  const operations = f.calls.filter((c) => Object.values(CARD_SQL).includes(c.sql));
  assert.deepEqual(operations.map((c) => c.kind), ['sealer', 'writer', 'writer', 'reader']);
  assert.deepEqual(operations[0].values, [p.payload, p.baselineDigest, p.postGraphDigest, p.sourceRevision, p.trustReceipt, p.expiresAt]);
  assert.deepEqual(operations[2].values, ['web_batch']);
  assert.equal(f.calls.some((c) => /SET ROLE|INSERT|DELETE/u.test(c.sql)), false);
});
test('unexpected role/session denies before any fixed function', async () => {
  for (const options of [{ allowed: false }, { wrongLogin: true }]) {
    const f = transport(options); assert.deepEqual(await f.store.apply({}), { state: 'rejected' });
    assert.equal(f.calls.some((c) => c.sql === CARD_SQL.apply), false);
  }
});
test('fixed session query rejects every membership except the named login and its one card role', async () => {
  const f = transport(); await f.store.readGraph();
  const sql = f.calls.find((c) => c.sql.includes('session_user AS')).sql;
  assert.match(sql, /p\.rolname NOT IN \(current_user,\$1\)/u);
  assert.match(sql, /pg_has_role\(current_user,p\.oid,'MEMBER'\)/u);
  // This source assertion covers platform_ops_owner and future extra roles;
  // actual hosted inheritance and function ACL proof remains a runtime gate.
  assert.equal(sql.includes("p.rolname IN\n"), false);
});
test('known rollback versus unknown commit/rollback-loss are distinct and never leak SQL errors', async () => {
  for (const [options, expected] of [[{ failAt: CARD_SQL.apply }, 'rejected'],
    [{ failAt: 'COMMIT' }, 'unknown'], [{ failAt: CARD_SQL.seal, rollbackFails: true }, 'unknown']]) {
    const f = transport(options); const value = options.failAt === CARD_SQL.seal
      ? await f.store.seal(fixture().admission) : await f.store.apply({});
    assert.deepEqual(value, { state: expected }); assert.equal(JSON.stringify(value).includes('PASSWORD'), false);
  }
});
test('TLS connector rejects foreign target, admin/service role, missing CA and PG option overrides without connecting', () => {
  const config = { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres',
    user: 'platform_card_reader_login.bxtcuhkotumitoqtrcej', password: 'fixture', ca: 'fixture' };
  assert.equal(typeof createPrivateCardTlsConnector('reader', config), 'function');
  for (const changed of [{ host: 'evil.example' }, { user: 'postgres.bxtcuhkotumitoqtrcej' },
    { user: 'service_role' }, { ca: '' }, { ssl: false }, { connectionString: 'postgres://evil' },
    { host: { toString: () => config.host } }]) {
    assert.throws(() => createPrivateCardTlsConnector('reader', { ...config, ...changed }), { message: 'CARD_TRANSPORT_UNAVAILABLE' });
  }
});

test('actual connector constructor pins startup options against PGOPTIONS without network access', async () => {
  const previousClient = pg.Client; const previousOptions = process.env.PGOPTIONS; let captured;
  try {
    process.env.PGOPTIONS = '-c search_path=hostile,pg_catalog';
    pg.Client = class {
      constructor(config) { captured = config; }
      on() {}
      async connect() {}
      async end() {}
    };
    const connect = createPrivateCardTlsConnector('reader', { host: 'aws-0-us-east-1.pooler.supabase.com',
      port: 5432, database: 'postgres', user: 'platform_card_reader_login.bxtcuhkotumitoqtrcej', password: 'fixture', ca: 'fixture' });
    await connect();
    assert.equal(captured.options, '-c search_path=pg_catalog');
    assert.equal(captured.ssl.rejectUnauthorized, true); assert.equal(captured.user.startsWith('platform_card_reader_login.'), true);
  } finally {
    pg.Client = previousClient;
    if (previousOptions === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = previousOptions;
  }
});
