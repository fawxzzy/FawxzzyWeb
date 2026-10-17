import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { authenticate, MASTER, COOKIE, handleDigest, newHandle, readHandle, boundedAuthJson } from '../src/server/operations/consumer-auth.mjs';
import { createConsumerHandler, validateView, operationsHandler } from '../src/server/operations/consumer-http.mjs';
import { createConsumerStore, boundedRpcJson, INPUT_LIMIT } from '../src/server/operations/consumer-store.mjs';

const now = 1800000000000;
const identity = { subject: '11111111-1111-4111-8111-111111111111', session: '22222222-2222-4222-8222-222222222222', expires: now / 1000 + 900 };
const claims = { sub: identity.subject, session_id: identity.session, iss: `${MASTER}/auth/v1`, aud: 'authenticated', role: 'authenticated', is_anonymous: false, exp: identity.expires };
const config = { url: MASTER, publishableKey: `sb_publishable_${'a'.repeat(24)}` };
const jwt = (c = claims) => `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(c)).toString('base64url')}.c2lnbmF0dXJl`;
const token = jwt();
function request(route = 'read', method = 'GET', extra = {}) {
  const { headers = {}, url, ...rest } = extra;
  return new Request(url ?? `https://account.fawxzzy.com/api/operations/${route}`, { method,
    headers: { Origin: 'https://account.fawxzzy.com', 'X-Fawxzzy-Operations': '1', Authorization: `Bearer ${token}`,
      'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', ...headers }, ...rest });
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
  const deps = { auth: config, authOptions, ownerSubject: identity.subject, now: () => now,
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
test('another authenticated subject and an absent owner binding cannot read or open private work', async () => {
  const raw = newHandle(); const headers = { Cookie: `${COOKIE}=${raw}` };
  const other = fixture({ ownerSubject: identity.session });
  for (const [route, method] of [['read', 'GET'], ['session', 'POST']]) {
    const res = await other.handler(request(route, method, { headers: method === 'GET' ? headers : {} }), route);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'OPS_ACCESS_DENIED' });
    assert.match(res.headers.get('cache-control'), /no-store/u);
    assert.equal(res.headers.get('vary')?.includes('Authorization'), true);
  }
  assert.deepEqual(other.calls, []);
  const unbound = fixture({ ownerSubject: undefined });
  const res = await unbound.handler(request('read', 'GET', { headers }), 'read');
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'OPS_UNAVAILABLE' });
  assert.deepEqual(unbound.calls, []);
});
test('only the verified owner without a read cookie receives the missing-session signal', async () => {
  const owner = fixture();
  const absent = await owner.handler(request('read', 'GET'), 'read');
  assert.equal(absent.status, 403);
  assert.deepEqual(await absent.json(), { error: 'OPS_SESSION_MISSING' });
  assert.match(absent.headers.get('set-cookie'), /Max-Age=0/u);
  assert.deepEqual(owner.calls, []);

  const other = fixture({ ownerSubject: identity.session });
  const denied = await other.handler(request('read', 'GET'), 'read');
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'OPS_ACCESS_DENIED' });
  assert.deepEqual(other.calls, []);
});
test('read and close revalidate bearer and bind digest to the current account/session', async () => {
  const raw = newHandle(); const f = fixture(); const headers = { Cookie: `${COOKIE}=${raw}` };
  assert.equal((await f.handler(request('read', 'GET', { headers }), 'read')).status, 200);
  const original = f.calls[0][1]; assert.equal(original, handleDigest(raw, identity));
  f.deps.authenticate = async () => ({ ...identity, subject: identity.session });
  assert.equal((await f.handler(request('read', 'GET', { headers }), 'read')).status, 403);
  assert.equal(f.calls.length, 1);
  f.deps.authenticate = async () => ({ ...identity, session: identity.subject });
  const closed = await f.handler(request('session', 'DELETE', { headers }), 'session');
  assert.notEqual(f.calls[1][1], original); assert.match(closed.headers.get('set-cookie'), /Path=\/; Max-Age=0; Secure; HttpOnly; SameSite=Strict/u);
});

for (const mode of ['cors', 'same-origin']) {
  test(`browser GET without Origin accepts exact ${mode} fetch context and still validates Auth/session`, async () => {
    const f = fixture(); const raw = newHandle();
    const req = request('read', 'GET', { headers: { Cookie: `${COOKIE}=${raw}`, 'Sec-Fetch-Mode': mode } });
    req.headers.delete('origin');
    const res = await f.handler(req, 'read');
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), view);
    assert.deepEqual(f.calls, [['read', handleDigest(raw, identity)]]);
    assert.match(res.headers.get('vary'), /Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest/u);
    req.headers.delete('authorization');
    assert.equal((await f.handler(req, 'read')).status, 403); assert.equal(f.calls.length, 1);
  });
}
for (const [header, values] of Object.entries({
  'Origin': ['', 'null', 'https://evil.invalid', 'https://account.fawxzzy.com.evil.invalid'],
  'Sec-Fetch-Site': [null, '', 'same-site', 'cross-site', 'none', 'same-origin, cross-site', 'Same-Origin'],
  'Sec-Fetch-Mode': [null, '', 'navigate', 'no-cors', 'websocket', 'cors, same-origin', 'CORS'],
  'Sec-Fetch-Dest': [null, '', 'document', 'iframe', 'image', 'empty, document', 'Empty'],
})) {
  for (const value of values) {
    test(`GET rejects ${header}=${String(value)} before credentials or store`, async () => {
      let configReads = 0; const handler = createConsumerHandler(() => { configReads++; throw new Error('NO'); });
      for (const suppliedOrigin of [false, true]) {
        const req = request(); if (!suppliedOrigin) req.headers.delete('origin');
        if (value === null) req.headers.delete(header); else req.headers.set(header, value);
        assert.equal((await handler(req, 'read')).status, 403);
      }
      assert.equal(configReads, 0);
    });
  }
}
for (const method of ['POST', 'DELETE']) {
  test(`${method} session never uses the GET absent-Origin allowance`, async () => {
    let configReads = 0; const handler = createConsumerHandler(() => { configReads++; throw new Error('NO'); });
    const req = request('session', method); req.headers.delete('origin');
    assert.equal((await handler(req, 'session')).status, 403); assert.equal(configReads, 0);
  });
}
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

for (const method of ['POST', 'DELETE']) {
  for (const length of [undefined, '0']) {
    test(`${method} accepts proven empty streams with Content-Length ${String(length)}`, async () => {
      const f = fixture(); const headers = { Cookie: `${COOKIE}=${newHandle()}` };
      if (method === 'POST') delete headers.Cookie;
      if (length !== undefined) headers['Content-Length'] = length;
      const req = request('session', method, { headers, duplex: 'half', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(0)); c.close(); } }) });
      assert.notEqual(req.body, null);
      const res = await f.handler(req, 'session'); assert.equal(res.status, 204);
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], method === 'POST' ? 'open' : 'close');
    });
  }
}

for (const [name, stream] of Object.entries({
  'nonempty despite claimed zero length': () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }),
  'nonempty after empty chunk': () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(0)); c.enqueue(new Uint8Array([1])); c.close(); } }),
  'wrong chunk type': () => new ReadableStream({ start(c) { c.enqueue(''); c.close(); } }),
  'too many empty chunks': () => new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(0)); } }),
  'stream failure': () => new ReadableStream({ start(c) { c.error(new Error('PRIVATE')); } }),
})) test(`empty-body guard rejects ${name} before configuration/Auth/DB`, async () => {
  let calls = 0; const handler = createConsumerHandler(() => { calls++; throw new Error('NO'); });
  const res = await handler(request('session', 'POST', { headers: { 'Content-Length': '0' }, body: stream(), duplex: 'half' }), 'session');
  assert.equal(res.status, 403); assert.deepEqual(await res.json(), { error: 'OPS_REQUEST_DENIED' }); assert.equal(calls, 0);
});

test('stalled empty body and nonsettling cancellation have a finite denial', async () => {
  let calls = 0; const handler = createConsumerHandler(() => { calls++; throw new Error('NO'); });
  const start = performance.now();
  const body = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
  const res = await handler(request('session', 'POST', { body, duplex: 'half' }), 'session');
  assert.equal(res.status, 403); assert.deepEqual(await res.json(), { error: 'OPS_REQUEST_DENIED' }); assert.equal(calls, 0);
  assert.ok(performance.now() - start < 3000);
});

test('aborted, already consumed, or locked bodies cannot reach Auth', async () => {
  let calls = 0; const handler = createConsumerHandler(() => { calls++; throw new Error('NO'); });
  const empty = () => new ReadableStream({ start(c) { c.close(); } });
  const controller = new AbortController(); controller.abort();
  const aborted = request('session', 'POST', { body: empty(), duplex: 'half', signal: controller.signal });
  const used = request('session', 'POST', { body: empty(), duplex: 'half' }); await used.text();
  const locked = request('session', 'POST', { body: empty(), duplex: 'half' }); const reader = locked.body.getReader();
  for (const req of [aborted, used, locked]) assert.deepEqual(await (await handler(req, 'session')).json(), { error: 'OPS_REQUEST_DENIED' });
  reader.releaseLock(); assert.equal(calls, 0);
});

test('abort during an empty stream read denies without waiting for its producer', async () => {
  let calls = 0; const handler = createConsumerHandler(() => { calls++; throw new Error('NO'); });
  const controller = new AbortController(); const req = request('session', 'POST', { body: new ReadableStream(), duplex: 'half', signal: controller.signal });
  const result = handler(req, 'session'); controller.abort();
  assert.deepEqual(await (await result).json(), { error: 'OPS_REQUEST_DENIED' }); assert.equal(calls, 0);
});

test('invalid framing and origin reject without pulling even a stalled body', async () => {
  for (const headers of [{ 'Content-Length': '1' }, { 'Content-Length': '00' }, { 'Transfer-Encoding': 'chunked' }, { Origin: 'https://wrong.invalid' }]) {
    let calls = 0; const handler = createConsumerHandler(() => { calls++; throw new Error('NO'); });
    const res = await handler(request('session', 'POST', { headers, body: new ReadableStream(), duplex: 'half' }), 'session');
    assert.deepEqual(await res.json(), { error: 'OPS_REQUEST_DENIED' }); assert.equal(calls, 0);
  }
});

test('real loopback zero-byte HTTP POST and DELETE reach Auth; payload and foreign origin do not', async () => {
  let authCalls = 0; const observed = [];
  const handler = createConsumerHandler({ ownerSubject: identity.subject,
    authenticate: async () => { authCalls++; throw Object.assign(new Error('denied'), { code: 'OPS_ACCESS_DENIED' }); } });
  const server = http.createServer(async (incoming, outgoing) => {
    const req = new Request('https://account.fawxzzy.com/api/operations/session', { method: incoming.method, headers: incoming.headers, body: Readable.toWeb(incoming), duplex: 'half' });
    observed.push({ method: incoming.method, body: req.body !== null });
    const res = await handler(req, 'session'); outgoing.writeHead(res.status, Object.fromEntries(res.headers)); outgoing.end(await res.text());
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const send = (method, payload = '', origin = 'https://account.fawxzzy.com') => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method, agent: false, headers: { Origin: origin, 'X-Fawxzzy-Operations': '1', 'Content-Length': Buffer.byteLength(payload), 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' } }, (res) => {
        let value = ''; res.on('data', (b) => { value += b.toString(); }); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(value) }));
      }); req.on('error', reject); req.end(payload);
    });
    for (const method of ['POST', 'DELETE']) assert.deepEqual(await send(method), { status: 403, value: { error: 'OPS_ACCESS_DENIED' } });
    for (const [payload, origin] of [['x', 'https://account.fawxzzy.com'], ['', 'https://wrong.invalid']]) assert.deepEqual(await send('POST', payload, origin), { status: 403, value: { error: 'OPS_REQUEST_DENIED' } });
    assert.equal(authCalls, 2); assert.equal(observed.length, 4); assert.ok(observed.every((x) => x.body));
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
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

const digest = `sha256:${'a'.repeat(64)}`;
test('three fixed RPCs forward only the Auth-validated bearer and public key', async () => {
  const calls = [];
  const store = createConsumerStore(config, `Bearer ${token}`, { fetchImpl: async (url, init) => {
    calls.push([url, init]); return Response.json(url.endsWith('/read') ? view : { status: url.endsWith('/open_session') ? 'opened' : 'closed' });
  } });
  await store.open(digest, identity); assert.deepEqual(await store.read(digest), view); await store.close(digest);
  assert.deepEqual(calls.map(([url]) => url), ['open_session', 'read', 'close_session'].map((name) => `${MASTER}/rest/v1/rpc/${name}`));
  assert.deepEqual(JSON.parse(calls[0][1].body), { handle_digest: digest, expires_at: new Date(identity.expires * 1000).toISOString() });
  for (const [, init] of calls) {
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal);
    assert.deepEqual(init.headers, { apikey: config.publishableKey, Authorization: `Bearer ${token}`,
      'Content-Profile': 'operations_api', 'Content-Type': 'application/json', Accept: 'application/json' });
    assert.ok(!init.body.includes(identity.subject)); assert.ok(!init.body.includes(identity.session));
  }
  assert.deepEqual(JSON.parse(calls[1][1].body), { handle_digest: digest });
  assert.deepEqual(JSON.parse(calls[2][1].body), { handle_digest: digest });
});
test('handler validates Auth before constructing the per-request transport', async () => {
  const calls = []; const deps = { auth: config, ownerSubject: identity.subject, now: () => now,
    authOptions: { now: () => now, fetchImpl: async (_, init) => { calls.push(['auth', init.headers.Authorization]); return provider(); } },
    storeOptions: { fetchImpl: async (_, init) => { calls.push(['rpc', init.headers.Authorization]); return Response.json({ status: 'opened' }); } } };
  const handler = createConsumerHandler(deps);
  assert.equal((await handler(request('session', 'POST'), 'session')).status, 204);
  assert.deepEqual(calls, [['auth', `Bearer ${token}`], ['rpc', `Bearer ${token}`]]);
  calls.length = 0; deps.authOptions.fetchImpl = async () => new Response(null, { status: 401 });
  assert.equal((await handler(request('session', 'POST'), 'session')).status, 403); assert.equal(calls.length, 0);
});
test('transport rejects legacy URLs, arbitrary profile, secret keys and malformed bearer before network', () => {
  for (const cfg of [{ ...config, url: 'https://legacy.supabase.co' }, { ...config, schema: 'public' },
    { ...config, publishableKey: 'sb_secret_fixture' }, { ...config, password: 'fixture' }]) {
    assert.throws(() => createConsumerStore(cfg, `Bearer ${token}`), /OPS_UNAVAILABLE/u);
  }
  for (const bearer of ['', token, 'Bearer a.b', `Bearer ${'a'.repeat(8192)}.b.c`]) assert.throws(() => createConsumerStore(config, bearer), /OPS_UNAVAILABLE/u);
  assert.throws(() => createConsumerStore(config, `Bearer ${token}`, { timeoutMs: 3001 }), /OPS_UNAVAILABLE/u);
});
test('invalid digests and expiry never invoke RPC', async () => {
  let calls = 0; const store = createConsumerStore(config, `Bearer ${token}`, { fetchImpl: async () => { calls++; return Response.json({}); } });
  for (const value of [null, 'sha256:a', `sha256:${'A'.repeat(64)}`]) for (const op of ['read', 'close', 'open']) await assert.rejects(store[op](value, identity), /OPS_ACCESS_DENIED/u);
  for (const expires of [null, Infinity, 1.5, 253402300800]) await assert.rejects(store.open(digest, { ...identity, expires }), /OPS_ACCESS_DENIED/u);
  assert.equal(calls, 0);
});
for (const [name, result] of Object.entries({ null: null, empty: {}, array: [], extra: { status: 'opened', private: 'secret' }, wrong: { status: 'closed' } })) {
  test(`malformed open acknowledgment ${name} is unknown and never retried`, async () => {
    let calls = 0; const store = createConsumerStore(config, `Bearer ${token}`, { fetchImpl: async () => { calls++; return Response.json(result); } });
    await assert.rejects(store.open(digest, identity), /^Error: OPS_UNAVAILABLE$/u); assert.equal(calls, 1);
  });
}
test('lost/denied/failed RPC responses use finite codes and single attempts', async () => {
  for (const status of [202, 204, 301, 401, 403, 429, 500]) {
    let calls = 0; const store = createConsumerStore(config, `Bearer ${token}`, { fetchImpl: async () => { calls++; return new Response(null, { status }); } });
    await assert.rejects(store.close(digest), status === 401 || status === 403 ? /OPS_ACCESS_DENIED/u : /OPS_UNAVAILABLE/u); assert.equal(calls, 1);
  }
  for (const error of ['OPS_ACCESS_DENIED', 'OPS_UNAVAILABLE', 'PRIVATE_PROVIDER_ERROR']) {
    const store = createConsumerStore(config, `Bearer ${token}`, { fetchImpl: async () => Response.json({ error }) });
    await assert.rejects(store.open(digest, identity), error === 'OPS_ACCESS_DENIED' ? /OPS_ACCESS_DENIED/u : /^Error: OPS_UNAVAILABLE$/u);
  }
  let calls = 0; const store = createConsumerStore(config, `Bearer ${token}`, { fetchImpl: async () => { calls++; throw new Error('PRIVATE_RESPONSE'); } });
  await assert.rejects(store.close(digest), /^Error: OPS_UNAVAILABLE$/u); assert.equal(calls, 1);
});
test('RPC enforces streamed size, content type, encoding and claimed length before JSON acceptance', async () => {
  for (const response of [new Response('x'.repeat(INPUT_LIMIT + 1), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
    new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(INPUT_LIMIT + 1) } }),
    new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': 'invalid' } }),
    new Response(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{', { headers: { 'Content-Type': 'application/json' } })]) {
    await assert.rejects(boundedRpcJson(response, new AbortController().signal), /^Error: OPS_UNAVAILABLE$/u);
  }
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(INPUT_LIMIT)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  await assert.rejects(boundedRpcJson(new Response(stream, { headers: { 'Content-Type': 'application/json' } }), new AbortController().signal), /OPS_UNAVAILABLE/u);
});
test('RPC deadline covers nonsettling fetch, stream and cancellation', async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } }), { headers: { 'Content-Type': 'application/json' } })]) {
    const store = createConsumerStore(config, `Bearer ${token}`, { fetchImpl, timeoutMs: 15 });
    await assert.rejects(store.open(digest, identity), /OPS_UNAVAILABLE/u);
  }
});
test('RPC read cannot bypass closed display validation', async () => {
  const handler = createConsumerHandler({ auth: config, authOptions, ownerSubject: identity.subject,
    storeOptions: { fetchImpl: async () => Response.json({ ...view, private: 'secret' }) } });
  const res = await handler(request('read', 'GET', { headers: { Cookie: `${COOKIE}=${newHandle()}` } }), 'read');
  assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: 'OPS_UNAVAILABLE' });
});
test('route adapters preserve standalone deployment contract and expose only intended verbs', async () => {
  const session = await readFile(new URL('../api/operations/session.ts', import.meta.url), 'utf8');
  const read = await readFile(new URL('../api/operations/read.ts', import.meta.url), 'utf8');
  assert.match(session, /export const POST/u); assert.match(session, /export const DELETE/u); assert.doesNotMatch(session, /export const GET/u);
  assert.match(read, /export const GET/u); assert.doesNotMatch(read, /export const POST/u);
});
