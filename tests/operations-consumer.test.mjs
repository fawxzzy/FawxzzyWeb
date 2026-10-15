import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { authenticate, MASTER, COOKIE, handleDigest, newHandle, readHandle, boundedAuthJson } from '../src/server/operations/consumer-auth.mjs';
import { createConsumerHandler, validateView, operationsHandler } from '../src/server/operations/consumer-http.mjs';
import { createConsumerConnector, createConsumerStore, installProtocolCap, AUDIT_SQL, READ_SQL } from '../src/server/operations/consumer-store.mjs';

const require = createRequire(import.meta.url);
const Connection = require('pg/lib/connection.js');
const now = 1800000000000;
const identity = { subject: '11111111-1111-4111-8111-111111111111', session: '22222222-2222-4222-8222-222222222222', expires: now / 1000 + 900 };
const claims = { sub: identity.subject, session_id: identity.session, iss: `${MASTER}/auth/v1`, aud: 'authenticated', role: 'authenticated', exp: identity.expires };
const config = { url: MASTER, publishableKey: `sb_publishable_${'a'.repeat(24)}` };
const jwt = (c = claims) => `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(c)).toString('base64url')}.c2lnbmF0dXJl`;
const token = jwt();
function request(route = 'read', method = 'GET', extra = {}) {
  const { headers = {}, url, ...rest } = extra;
  return new Request(url ?? `https://account.fawxzzy.com/api/operations/${route}`, { method,
    headers: { Origin: 'https://account.fawxzzy.com', 'X-Fawxzzy-Operations': '1', Authorization: `Bearer ${token}`, ...headers }, ...rest });
}
const provider = () => Response.json({ id: identity.subject, is_anonymous: false, user_metadata: { admin: true } });
const authOptions = { now: () => now, fetchImpl: async () => provider() };
const producer = 'github-repository:1301080630'; const id = `card:${Buffer.from(producer).toString('base64url')}:fixture`;
const card = { stable_id: id, title: 'Reviewed title', lifecycle: 'planning', owner_role: 'fixture.owner',
  created_at: '2026-10-15T12:00:00Z', updated_at: '2026-10-15T12:00:00Z', dependency_ids: [], blocker_codes: [], evidence_handles: [], supersedes_id: null };
const view = { health: 'healthy', authoritative: true, actions_enabled: false, projection_revision: `sha256:${'a'.repeat(64)}`,
  source_watermark: [{ producer_identity: producer, source_revision: 'b'.repeat(40) }], cards: [card] };
const clone = (x) => structuredClone(x);
function fixture(overrides = {}) {
  const calls = [];
  const deps = { auth: config, authOptions, now: () => now,
    store: { async open(...args) { calls.push(['open', ...args]); }, async close(...args) { calls.push(['close', ...args]); },
      async read(...args) { calls.push(['read', ...args]); return clone(view); } }, ...overrides };
  return { handler: createConsumerHandler(deps), calls, deps };
}

test('exact master Auth validation precedes trusted claims; request is finite, uncached and redirect-denying', async () => {
  const seen = [];
  const result = await authenticate(request(), config, { now: () => now, fetchImpl: async (...args) => { seen.push(args); return provider(); } });
  assert.deepEqual(result, identity); assert.equal(seen[0][0], `${MASTER}/auth/v1/user`);
  assert.equal(seen[0][1].redirect, 'error'); assert.equal(seen[0][1].cache, 'no-store');
  assert.equal(seen[0][1].headers.Authorization, `Bearer ${token}`); assert.ok(seen[0][1].signal);
});
for (const [name, change] of Object.entries({ subject: { sub: 'wrong' }, session: { session_id: null }, issuer: { iss: 'https://legacy.invalid/auth/v1' },
  audience: { aud: 'service_role' }, role: { role: 'service_role' }, expired: { exp: now / 1000 }, future: { nbf: now / 1000 + 1 } })) {
  test(`reject Auth-acknowledged token with invalid ${name}`, async () => {
    await assert.rejects(authenticate(request('read', 'GET', { headers: { Authorization: `Bearer ${jwt({ ...claims, ...change })}` } }), config, authOptions), /OPS_ACCESS_DENIED/u);
  });
}
for (const user of [{ id: identity.subject, is_anonymous: true }, { id: identity.subject }, { id: identity.session, is_anonymous: false }]) {
  test(`reject anonymous/mismatched Auth response ${JSON.stringify(user)}`, async () => {
    await assert.rejects(authenticate(request(), config, { ...authOptions, fetchImpl: async () => Response.json(user) }), /OPS_ACCESS_DENIED/u);
  });
}
test('Auth body and elapsed time are bounded, including streams and fetches ignoring abort', async () => {
  await assert.rejects(authenticate(request(), config, { ...authOptions, fetchImpl: async () => new Response('x'.repeat(16385)) }), /OPS_AUTH_UNAVAILABLE/u);
  await assert.rejects(authenticate(request(), config, { ...authOptions, timeoutMs: 15, fetchImpl: () => new Promise(() => {}) }), /OPS_AUTH_UNAVAILABLE/u);
  const controller = new AbortController(); const pending = boundedAuthJson(new Response(new ReadableStream({ pull() { return new Promise(() => {}); } })), controller.signal);
  controller.abort(); await assert.rejects(pending, /OPS_AUTH_UNAVAILABLE/u);
});
test('Auth configuration rejects legacy and secret credentials without network', async () => {
  let calls = 0;
  for (const cfg of [{ ...config, url: 'https://legacy.supabase.co' }, { ...config, publishableKey: 'sb_secret_fixture' }]) {
    await assert.rejects(authenticate(request(), cfg, { fetchImpl: async () => { calls++; return provider(); } }), /OPS_UNAVAILABLE/u);
  }
  assert.equal(calls, 0);
});
test('opaque cookie has all host attributes; DB gets only digest and verified identity', async () => {
  const f = fixture(); const result = await f.handler(request('session', 'POST'), 'session');
  assert.equal(result.status, 204); const set = result.headers.get('set-cookie');
  assert.match(set, /^__Host-fawxzzy-operations=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=900; Secure; HttpOnly; SameSite=Strict$/u);
  assert.doesNotMatch(set, /Domain|Bearer|eyJ/u);
  const raw = set.split(';')[0].split('=')[1]; assert.equal(f.calls[0][1], handleDigest(raw, identity));
  assert.deepEqual(f.calls[0][2], identity); assert.ok(!JSON.stringify(f.calls).includes(raw));
});
test('read and close revalidate bearer and bind digest to the current account/session', async () => {
  const raw = newHandle(); const f = fixture(); const headers = { Cookie: `${COOKIE}=${raw}` };
  assert.equal((await f.handler(request('read', 'GET', { headers }), 'read')).status, 200);
  const original = f.calls[0][1]; assert.equal(original, handleDigest(raw, identity));
  f.deps.authenticate = async () => ({ ...identity, subject: identity.session });
  assert.equal((await f.handler(request('read', 'GET', { headers }), 'read')).status, 200);
  assert.notEqual(f.calls[1][1], original);
  f.deps.authenticate = async () => ({ ...identity, session: identity.subject });
  const closed = await f.handler(request('session', 'DELETE', { headers }), 'session');
  assert.notEqual(f.calls[2][1], original); assert.match(closed.headers.get('set-cookie'), /Path=\/; Max-Age=0; Secure; HttpOnly; SameSite=Strict/u);
});
test('uncertain session mutation is never retried and clears cookie without disclosing errors', async () => {
  const f = fixture(); let effects = 0;
  f.deps.store.open = async () => { effects++; throw new Error('PRIVATE_SECRET_CREDENTIAL'); };
  const res = await f.handler(request('session', 'POST'), 'session');
  assert.equal(effects, 1); assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: 'OPS_UNAVAILABLE' });
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/u);
});
for (const [name, mutate] of Object.entries({ origin: { headers: { Origin: 'https://evil.invalid' } }, header: { headers: { 'X-Fawxzzy-Operations': '0' } },
  navigation: { headers: { 'Sec-Fetch-Mode': 'navigate' } }, site: { headers: { 'Sec-Fetch-Site': 'cross-site' } },
  query: { url: 'https://account.fawxzzy.com/api/operations/read?x=1' }, domain: { url: 'https://fawxzzy.com/api/operations/read' },
  body: { headers: { 'Content-Length': '1' } } })) {
  test(`request guard rejects ${name} before credentials or DB`, async () => {
    let configReads = 0; const handler = createConsumerHandler(() => { configReads++; throw new Error('NO'); });
    assert.equal((await handler(request('read', 'GET', mutate), 'read')).status, 403); assert.equal(configReads, 0);
  });
}
test('unsupported methods, body-bearing session requests, missing and duplicate cookies deny', async () => {
  const f = fixture();
  for (const req of [request('session', 'POST', { body: 'secret' }), request('read', 'POST')]) assert.equal((await f.handler(req, req.method === 'POST' && req.body ? 'session' : 'read')).status, 403);
  assert.equal((await f.handler(request(), 'read')).status, 403);
  const h = newHandle(); assert.throws(() => readHandle(request('read', 'GET', { headers: { Cookie: `${COOKIE}=${h}; ${COOKIE}=${h}` } })), /OPS_ACCESS_DENIED/u);
  assert.equal(f.calls.length, 0);
});
test('existing cookie cannot be silently replaced; production default is disabled', async () => {
  const f = fixture(); const res = await f.handler(request('session', 'POST', { headers: { Cookie: `${COOKIE}=${newHandle()}` } }), 'session');
  assert.equal(res.status, 409); assert.equal(f.calls.length, 0);
  const old = process.env.OPERATIONS_READER_ENABLED; delete process.env.OPERATIONS_READER_ENABLED;
  try { assert.equal((await operationsHandler(request(), 'read')).status, 503); }
  finally { if (old !== undefined) process.env.OPERATIONS_READER_ENABLED = old; }
});
test('healthy closed display is accepted with private response headers', async () => {
  assert.deepEqual(validateView(clone(view)), view); const f = fixture();
  const res = await f.handler(request('read', 'GET', { headers: { Cookie: `${COOKIE}=${newHandle()}` } }), 'read');
  assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0'); assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await res.json(), view);
});
for (const health of ['stale', 'reconciling', 'incompatible', 'unavailable']) {
  test(`${health} never exposes old cards or revision`, () => {
    const v = { ...clone(view), health, authoritative: false, cards: [], source_watermark: [], projection_revision: null };
    assert.deepEqual(validateView(v), v);
    for (const leak of [{ cards: [card] }, { source_watermark: view.source_watermark }, { projection_revision: view.projection_revision }]) assert.throws(() => validateView({ ...v, ...leak }), /OPS_UNAVAILABLE/u);
  });
}
for (const [name, edit] of Object.entries({ extra: (v) => { v.secret = 'private'; }, action: (v) => { v.actions_enabled = true; },
  duplicate: (v) => { v.cards.push(clone(card)); }, cardExtra: (v) => { v.cards[0].private_text = 'private'; },
  reference: (v) => { v.cards[0].dependency_ids = [`${id}-missing`]; }, timestamp: (v) => { v.cards[0].updated_at = '2026-10-15T12:00:60Z'; },
  text: (v) => { v.cards[0].title = 'a'.repeat(257); }, watermark: (v) => { v.source_watermark.push(clone(v.source_watermark[0])); },
  revision: (v) => { v.projection_revision = null; }, wrongProducer: (v) => { v.source_watermark[0].producer_identity = 'github-repository:2'; } })) {
  test(`display rejects ${name}`, () => { const v = clone(view); edit(v); assert.throws(() => validateView(v), /OPS_UNAVAILABLE/u); });
}

test('pinned pg TLS upgrade installs parser then guarded instance stream, accepting only bounded protocol', () => {
  const connection = new Connection({ ssl: true }); connection.on('error', () => {});
  const client = { connection }; const check = installProtocolCap(client, 6); let messages = 0;
  connection.on('readyForQuery', () => { messages++; });
  connection.upgradeToSSL('localhost', () => {}); check();
  assert.equal(connection.stream.encrypted, true);
  const ready = Buffer.from([90, 0, 0, 0, 5, 73]);
  connection.stream.emit('data', ready); assert.equal(messages, 1);
  connection.stream.emit('data', ready); assert.equal(messages, 1); assert.equal(connection.stream.destroyed, true);
});
for (const chunks of [[7], [3, 4]]) {
  test(`one chunk/cumulative cap rejects before parser ${chunks}`, () => {
    const stream = new PassThrough(); stream.encrypted = true; stream.on('error', () => {});
    const connection = new EventEmitter(); connection.stream = stream; let bytes = 0; stream.on('data', (x) => { bytes += x.length; });
    const check = installProtocolCap({ connection }, 6); connection.emit('sslconnect'); check();
    for (const n of chunks) stream.emit('data', Buffer.alloc(n));
    assert.equal(bytes, chunks.length === 1 ? 0 : 3); assert.equal(stream.destroyed, true);
  });
}
test('hook drift fails closed and does not patch stream prototypes', () => {
  const prototype = PassThrough.prototype.emit; const stream = new PassThrough(); stream.encrypted = true; stream.on('error', () => {});
  const connection = new EventEmitter(); connection.stream = stream;
  const check = installProtocolCap({ connection }); connection.emit('sslconnect');
  assert.throws(check, /OPS_DATABASE_HOOK/u); assert.equal(stream.destroyed, true); assert.equal(PassThrough.prototype.emit, prototype);
});
test('structured scoped config excludes admin/legacy credentials and SSL overrides', () => {
  const cfg = { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres',
    user: 'platform_ops_reader_login.bxtcuhkotumitoqtrcej', password: 'synthetic', ca: '-----BEGIN CERTIFICATE-----\nfixture' };
  assert.equal(typeof createConsumerConnector('reader', cfg), 'function');
  for (const bad of [{ ...cfg, user: 'postgres.bxtcuhkotumitoqtrcej' }, { ...cfg, ssl: false }, { ...cfg, host: 'evil.invalid' }, { ...cfg, user: 'platform_ops_reader_login.legacy' }]) {
    assert.throws(() => createConsumerConnector('reader', bad), /OPS_DATABASE_CONFIG/u);
  }
});
test('exact read wrapper invokes once; audit covers effective PUBLIC/inherited privileges', () => {
  assert.equal((READ_SQL.match(/operations_read\(/gu) ?? []).length, 1); assert.match(READ_SQL, /WITH result AS MATERIALIZED/u);
  assert.match(READ_SQL, /jsonb_build_object\('error','OPS_UNAVAILABLE'\)/u);
  for (const invariant of ['current_user=$1', 'session_user=$1', 'rolbypassrls', 'rolcreaterole', 'pg_has_role', 'has_function_privilege', 'has_table_privilege', 'has_any_column_privilege', 'has_sequence_privilege']) assert.ok(AUDIT_SQL.includes(invariant));
});
test('failed audit forbids operation; failed mutation is single attempt with finite error', async () => {
  for (const allowed of [false, null, true]) {
    const calls = []; let destroyed = 0;
    const c = { connection: { stream: { destroy() { destroyed++; } } }, end: async () => {},
      async query(sql, args) { calls.push([sql, args]); if (sql === AUDIT_SQL) return { rows: [{ allowed }] }; throw new Error('PRIVATE_DATABASE_ERROR'); } };
    const store = createConsumerStore({ session: async () => c });
    await assert.rejects(store.open(`sha256:${'a'.repeat(64)}`, identity), /^Error: OPS_UNAVAILABLE$/u);
    assert.equal(calls.length, allowed ? 2 : 1); assert.equal(destroyed, 1);
    assert.deepEqual(calls[0][1].slice(0, 2), ['platform_ops_session_login', 'platform_ops_session_issuer']);
  }
});
test('route adapters preserve standalone deployment contract and expose only intended verbs', async () => {
  const session = await readFile(new URL('../api/operations/session.ts', import.meta.url), 'utf8');
  const read = await readFile(new URL('../api/operations/read.ts', import.meta.url), 'utf8');
  assert.match(session, /export const POST/u); assert.match(session, /export const DELETE/u); assert.doesNotMatch(session, /export const GET/u);
  assert.match(read, /export const GET/u); assert.doesNotMatch(read, /export const POST/u);
});
