import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOperationsReader, createTransportGate, readResponseJson, OBSERVATION_MS } from '../src/lib/operations/reader-client.mjs';
import { validateView } from '../src/lib/operations/display-contract.mjs';
import { validateView as serverValidate } from '../src/server/operations/consumer-http.mjs';
import { exactOrder } from '../src/lib/operations/ordering.mjs';
import { exactOrder as serverOrder } from '../src/server/operations/ordering.mjs';

const ORIGIN = 'https://account.fawxzzy.com';
const bearer = 'only-in-request-fixture-token';
const producer = 'github-repository:1301080630';
const stableId = `card:${Buffer.from(producer).toString('base64url')}:fixture`;
const healthy = () => ({ health: 'healthy', authoritative: true, actions_enabled: false,
  projection_revision: `sha256:${'a'.repeat(64)}`,
  source_watermark: [{ producer_identity: producer, source_revision: 'b'.repeat(40) }],
  cards: [{ stable_id: stableId, title: 'Private fixture', lifecycle: 'in_progress', owner_role: 'fixture.owner',
    created_at: '2026-10-15T12:00:00.0000001Z', updated_at: '2026-10-15T12:00:00.0000002Z',
    dependency_ids: [], blocker_codes: [], evidence_handles: ['evidence:abcdefghijklmnop'], supersedes_id: null }] });
const unhealthy = (health) => ({ health, authoritative: false, actions_enabled: false, projection_revision: null, source_watermark: [], cards: [] });
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function clock() {
  let time = 0; let next = 0; const timers = new Map();
  return { now: () => time,
    setTimer(fn, delay) { const id = ++next; timers.set(id, { at: time + delay, fn }); return id; },
    clearTimer(id) { timers.delete(id); },
    tick(delta) { time += delta; for (const [id, value] of [...timers]) if (value.at <= time) { timers.delete(id); value.fn(); } },
  };
}
function fixture(options = {}) {
  const calls = []; const updates = []; const timers = clock(); const gate = options.gate ?? createTransportGate();
  let session = { userId: 'A' }; let generation = 'generation-a'; const authListeners = new Set();
  const adapter = { kind: 'supabase', getAuthGeneration: () => generation,
    getSession: async () => session, getOAuthAccessToken: async (expected) => { assert.equal(expected, session?.userId); return bearer; },
    onSessionChange(listener) { authListeners.add(listener); return () => authListeners.delete(listener); } };
  let respond = async (_url, config) => config.method === 'GET' ? Response.json(healthy()) : new Response(null, { status: 204 });
  const reader = createOperationsReader({ adapter, origin: ORIGIN, gate, now: timers.now, monotonic: timers.now,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, fetchImpl: async (...args) => { calls.push(args); return respond(...args); }, ...options });
  reader.subscribe(() => updates.push(structuredClone(reader.getSnapshot())));
  return { reader, gate, adapter, calls, updates, timers,
    respond(fn) { respond = fn; },
    generation(value) { generation = value; },
    session(value, event = true) { session = value === null ? null : { userId: value }; if (event) for (const listener of authListeners) listener(session); },
  };
}

test('shared browser/server contract and exact ordering are literally one implementation', () => {
  assert.equal(validateView, serverValidate); assert.equal(exactOrder, serverOrder);
  assert.deepEqual(validateView(healthy()), healthy());
  for (const value of [null, { ...healthy(), surprise: true }, { ...unhealthy('stale'), cards: healthy().cards }]) assert.throws(() => validateView(value));
  const unicode = healthy(); unicode.cards[0].title = '東京 🎹'; assert.equal(validateView(unicode), unicode);
  const reversed = healthy(); reversed.cards[0].created_at = '2026-10-15T12:00:00.0000003Z'; assert.throws(() => validateView(reversed));
});
test('manual open/read/close sends only exact uncached same-origin paths and request-local bearer', async () => {
  const f = fixture(); await f.reader.start(); assert.equal(f.calls.length, 0);
  await f.reader.open(); assert.equal(f.reader.getSnapshot().session, 'open'); assert.equal(f.calls.length, 1);
  await f.reader.refresh(); assert.equal(f.reader.getSnapshot().view.cards[0].title, 'Private fixture');
  await f.reader.close(); assert.equal(f.reader.getSnapshot().session, 'closed'); assert.equal(f.reader.getSnapshot().view, null);
  assert.deepEqual(f.calls.map(([url, init]) => [url, init.method]), [[`${ORIGIN}/api/operations/session`, 'POST'], [`${ORIGIN}/api/operations/read`, 'GET'], [`${ORIGIN}/api/operations/session`, 'DELETE']]);
  for (const [, init] of f.calls) {
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error'); assert.equal(init.mode, 'same-origin');
    assert.deepEqual(init.headers, { Authorization: `Bearer ${bearer}`, 'X-Fawxzzy-Operations': '1' });
    assert.equal(init.body, undefined);
  }
  assert.ok(!JSON.stringify(f.updates).includes(bearer)); f.reader.dispose();
});
test('synchronous single flight suppresses double clicks before token acquisition', async () => {
  const f = fixture(); await f.reader.start(); const pending = deferred(); f.respond(() => pending.promise);
  const first = f.reader.open(); const second = f.reader.open(); await flush(); assert.equal(f.calls.length, 1);
  pending.resolve(new Response(null, { status: 204 })); await Promise.all([first, second]); f.reader.dispose();
});
test('browser-style 204 empty stream is accepted; nonempty or declared bytes stay UNKNOWN', async () => {
  for (const [bytes, length, accepted] of [[[], null, true], [[1], null, false], [[], '1', false]]) {
    const f = fixture(); await f.reader.start();
    f.respond(async () => ({ status: 204, redirected: false,
      headers: new Headers(length ? { 'Content-Length': length } : {}),
      body: new ReadableStream({ start(controller) { if (bytes.length) controller.enqueue(new Uint8Array(bytes)); controller.close(); } }),
    }));
    await f.reader.open(); assert.equal(f.reader.getSnapshot().session === 'open', accepted);
    assert.equal(f.gate.uncertain, !accepted); f.reader.dispose();
  }
});
test('204 stream stall holds the mutation gate through timeout and late settlement', async () => {
  const f = fixture(); await f.reader.start(); let stream;
  f.respond(async () => ({ status: 204, redirected: false, headers: new Headers(),
    body: new ReadableStream({ start(controller) { stream = controller; } }) }));
  const work = f.reader.open(); await flush(); f.timers.tick(10_000); await work;
  assert.equal(f.reader.getSnapshot().pending, true); stream.close(); await flush();
  assert.equal(f.reader.getSnapshot().pending, false); assert.equal(f.gate.uncertain, true);
  assert.notEqual(f.reader.getSnapshot().session, 'open'); f.reader.dispose();
});
for (const health of ['stale', 'reconciling', 'incompatible', 'unavailable']) {
  test(`${health} removes previously displayed cards`, async () => {
    const f = fixture(); await f.reader.start(); await f.reader.refresh(); assert.ok(f.reader.getSnapshot().view);
    f.respond(async () => Response.json(unhealthy(health))); await f.reader.refresh();
    assert.equal(f.reader.getSnapshot().status, health); assert.equal(f.reader.getSnapshot().view, null); f.reader.dispose();
  });
}
test('60-second observation expiry only erases, never polls', async () => {
  const f = fixture(); await f.reader.start(); await f.reader.refresh(); f.timers.tick(OBSERVATION_MS - 1);
  assert.ok(f.reader.getSnapshot().view); f.timers.tick(1); assert.equal(f.reader.getSnapshot().view, null);
  assert.equal(f.reader.getSnapshot().status, 'expired'); assert.equal(f.calls.length, 1); f.reader.dispose();
});
test('visibility restoration cannot restore private cards or trigger network', async () => {
  const f = fixture(); await f.reader.start(); await f.reader.refresh(); f.reader.setVisible(false);
  assert.equal(f.reader.getSnapshot().view, null); await f.reader.refresh(); assert.equal(f.calls.length, 1);
  f.reader.setVisible(true); assert.equal(f.reader.getSnapshot().view, null); assert.equal(f.calls.length, 1);
  await f.reader.refresh(); assert.ok(f.reader.getSnapshot().view); f.reader.dispose();
});
for (const change of ['A-B-A', 'passive-event', 'generation', 'null-generation', 'hide', 'dispose']) {
  test(`discard delayed read after ${change}`, async () => {
    const f = fixture(); await f.reader.start(); const pending = deferred(); f.respond(() => pending.promise);
    const work = f.reader.refresh(); await flush(); assert.equal(f.calls.length, 1);
    if (change === 'A-B-A') { f.session('B'); f.session('A'); }
    if (change === 'passive-event') f.session('A');
    if (change === 'generation') f.generation('generation-b');
    if (change === 'null-generation') f.generation(null);
    if (change === 'hide') f.reader.setVisible(false);
    if (change === 'dispose') f.reader.dispose();
    pending.resolve(Response.json(healthy())); await work;
    assert.equal(f.reader.getSnapshot().view, null); assert.equal(f.gate.uncertain, true); f.reader.dispose();
  });
}
test('null durable Auth generation denies without token or network', async () => {
  const f = fixture(); await f.reader.start(); f.generation(null); await f.reader.open(); await f.reader.refresh();
  assert.equal(f.calls.length, 0); assert.equal(f.reader.getSnapshot().status, 'unavailable'); f.reader.dispose();
});
test('a passive Auth event immediately erases displayed work without generation change', async () => {
  const f = fixture(); await f.reader.start(); await f.reader.refresh(); f.session('A');
  assert.equal(f.reader.getSnapshot().view, null); assert.equal(f.reader.getSnapshot().uncertain, true); f.reader.dispose();
});
test('storage/focus generation check erases displayed work', async () => {
  const f = fixture(); await f.reader.start(); await f.reader.refresh(); f.generation('changed'); f.reader.checkDisplay();
  assert.equal(f.reader.getSnapshot().view, null); f.reader.dispose();
});
test('identity drift during token acquisition prevents sending the request', async () => {
  const f = fixture(); await f.reader.start(); const token = deferred(); f.adapter.getOAuthAccessToken = () => token.promise;
  const work = f.reader.open(); await flush(); f.session('B'); token.resolve(bearer); await work;
  assert.equal(f.calls.length, 0); f.reader.dispose();
});
test('silent identity drift at mutation acknowledgment is unknown, never an open claim', async () => {
  const f = fixture(); await f.reader.start(); f.respond(async () => { f.session('B', false); return new Response(null, { status: 204 }); });
  await f.reader.open(); assert.equal(f.reader.getSnapshot().session, 'unverified'); assert.equal(f.gate.uncertain, true); f.reader.dispose();
});
test('late mutation cookie is serialized across remount and A-B-A; only a subsequent read reconciles', async () => {
  const gate = createTransportGate(); const a = fixture({ gate }); await a.reader.start(); const pending = deferred();
  a.respond(() => pending.promise); const work = a.reader.open(); await flush(); a.session('B'); a.session('A'); a.reader.dispose();
  const b = fixture({ gate }); await b.reader.start(); await b.reader.open(); await b.reader.refresh(); assert.equal(b.calls.length, 0);
  pending.resolve(new Response(null, { status: 204 })); await work;
  assert.equal(gate.uncertain, true); await b.reader.open(); assert.equal(b.calls.length, 0);
  await b.reader.refresh(); assert.equal(gate.uncertain, false); assert.equal(b.reader.getSnapshot().session, 'open');
  await b.reader.close(); assert.equal(b.reader.getSnapshot().session, 'closed'); b.reader.dispose();
});
test('denied reads also hold cookie-changing transport across remount', async () => {
  const gate = createTransportGate(); const a = fixture({ gate }); await a.reader.start(); const pending = deferred(); a.respond(() => pending.promise);
  const work = a.reader.refresh(); await flush(); a.reader.dispose(); const b = fixture({ gate }); await b.reader.start();
  await b.reader.open(); assert.equal(b.calls.length, 0); pending.resolve(Response.json({ error: 'OPS_ACCESS_DENIED' }, { status: 403 }));
  await work; assert.equal(gate.uncertain, true); b.respond(async () => Response.json({ error: 'OPS_ACCESS_DENIED' }, { status: 403 }));
  await b.reader.refresh(); assert.equal(gate.uncertain, false); assert.equal(b.reader.getSnapshot().status, 'denied'); assert.equal(b.calls.length, 1); b.reader.dispose();
});
test('only an exact missing-session read response is distinguishable from access denial', async () => {
  const f = fixture(); await f.reader.start();
  f.respond(async () => Response.json({ error: 'OPS_SESSION_MISSING' }, { status: 403 }));
  await f.reader.refresh();
  assert.equal(f.reader.getSnapshot().status, 'session-missing');
  assert.equal(f.reader.getSnapshot().session, 'closed');
  assert.equal(f.gate.uncertain, false);
  f.respond(async () => Response.json({ error: 'OPS_ACCESS_DENIED' }, { status: 403 }));
  await f.reader.refresh();
  assert.equal(f.reader.getSnapshot().status, 'denied');
  assert.equal(f.reader.getSnapshot().session, 'closed');
  assert.deepEqual(f.calls.map(([, init]) => init.method), ['GET', 'GET']);
  f.reader.dispose();
});
test('timeout never assumes abort canceled a mutation, and does not retry', async () => {
  const f = fixture(); await f.reader.start(); const pending = deferred(); f.respond(() => pending.promise);
  const work = f.reader.open(); await flush(); f.timers.tick(10_000); await work;
  assert.equal(f.reader.getSnapshot().pending, true); assert.equal(f.gate.uncertain, true);
  await f.reader.open(); await f.reader.refresh(); assert.equal(f.calls.length, 1);
  pending.resolve(new Response(null, { status: 204 })); await flush(); assert.equal(f.reader.getSnapshot().pending, false);
  assert.notEqual(f.reader.getSnapshot().session, 'open'); await f.reader.open(); assert.equal(f.calls.length, 1); f.reader.dispose();
});
test('fetch rejection yields UNKNOWN and requires explicit read reconciliation', async () => {
  const f = fixture(); await f.reader.start(); f.respond(async () => { throw new Error(bearer); }); await f.reader.open();
  assert.equal(f.reader.getSnapshot().status, 'unknown'); await f.reader.open(); assert.equal(f.calls.length, 1);
  assert.ok(!JSON.stringify(f.updates).includes(bearer)); f.reader.dispose();
});
test('body stall timeout erases prior cards and keeps gate until stream settlement', async () => {
  const f = fixture(); await f.reader.start(); await f.reader.refresh(); let stream;
  f.respond(async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'application/json' } }));
  const work = f.reader.refresh(); await flush(); assert.equal(f.reader.getSnapshot().view, null);
  f.timers.tick(10_000); await work; assert.equal(f.reader.getSnapshot().pending, true);
  stream.close(); await flush(); assert.equal(f.reader.getSnapshot().pending, false); assert.equal(f.gate.uncertain, true); f.reader.dispose();
});
test('startup Auth wait has a display timeout; late identity result cannot revive it', async () => {
  const f = fixture(); const pending = deferred(); f.adapter.getSession = () => pending.promise;
  const work = f.reader.start(); f.timers.tick(10_000); assert.equal(f.reader.getSnapshot().status, 'unavailable');
  pending.resolve({ userId: 'A' }); await work; assert.equal(f.reader.getSnapshot().signedIn, false); f.reader.dispose();
});
for (const [name, response] of [
  ['HTML', () => new Response('<p>private</p>', { headers: { 'Content-Type': 'text/html' } })],
  ['malformed JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
  ['UTF8', () => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } })],
  ['declared size', () => Response.json({}, { headers: { 'Content-Length': '1048577' } })],
  ['actual size', () => new Response(' '.repeat(1048577), { headers: { 'Content-Type': 'application/json' } })],
  ['negative size', () => Response.json({}, { headers: { 'Content-Length': '-1' } })],
]) test(`bounded response rejects ${name}`, async () => { await assert.rejects(readResponseJson(response())); });
for (const [name, options] of [
  ['wrong production origin', { origin: 'https://fawxzzy.com' }],
  ['synthetic auth on production', { adapter: { kind: 'test' }, localTest: true }],
  ['test without explicit loopback fixture', { adapter: { kind: 'test' }, origin: 'http://127.0.0.1:3210' }],
  ['arbitrary loopback port', { adapter: { kind: 'test' }, localTest: true, origin: 'http://127.0.0.1:9999' }],
]) test(`deny ${name} without any request`, async () => {
  const f = fixture(options); await f.reader.start(); await f.reader.open(); assert.equal(f.calls.length, 0);
  assert.equal(f.reader.getSnapshot().status, 'unavailable'); f.reader.dispose();
});
test('source contains no token/cookie persistence, logging, polling, or custom Origin spoofing', async () => {
  const source = await readFile(new URL('../src/lib/operations/reader-client.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|console\.|setInterval|headers:.*Origin/u);
});
