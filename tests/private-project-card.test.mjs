import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, newHandle } from '../src/server/operations/consumer-auth.mjs';
import { createPrivateCardHandler, createPrivateCardStore, privateCardHandler } from '../src/server/projects/private-card-http.mjs';
import { selectedPrivateCard } from '../src/server/projects/selected-private-card.mjs';
import { readPrivateProjectCard } from '../src/lib/projects/private-card-reader.mjs';

const ORIGIN = 'https://account.fawxzzy.com';
const owner = '11111111-1111-1111-1111-111111111111';
const session = '22222222-2222-2222-2222-222222222222';
const mapping = { status: 'ACCEPTED', sourceId: 'FW-ANALYTICS-001',
  proposedStableId: 'FF-WEB-ANALYTICS-001', board: 'fawxzzyweb',
  sourceRevision: 'a'.repeat(40), boardRevision: `sha256:${'b'.repeat(64)}` };
const card = () => ({ stable_id: mapping.proposedStableId, version: 1,
  body_digest: `sha256:${'c'.repeat(64)}`, board_revision: mapping.boardRevision,
  source_revision: mapping.sourceRevision,
  body: { stable_id: mapping.proposedStableId, visibility: 'PRIVATE',
    source_card_id: mapping.sourceId, title: 'Traffic Analytics', summary: 'Private plan',
    lifecycle: 'planning', criteria: ['not sent to browser'] } });
function request(raw = newHandle(), extra = {}) {
  return new Request(`${ORIGIN}/api/projects/private-card`, { headers: {
    Authorization: 'Bearer aaa.bbb.ccc', Cookie: `${COOKIE}=${raw}`,
    'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty', 'X-Fawxzzy-Private-Card': '1', ...extra,
  } });
}
function fixture(options = {}) {
  let reads = 0;
  const deps = { mapping, ownerSubject: owner, now: () => 1000 * 1000,
    authenticate: async () => ({ subject: owner, session, expires: 1100 }),
    read: async () => { reads++; return card(); }, ...options };
  return { handler: createPrivateCardHandler(deps), reads: () => reads };
}

test('unadopted mapping, absent cookie and wrong owner do not reach the card RPC', async () => {
  assert.equal(selectedPrivateCard.status, 'PENDING_CANONICAL_EQUIVALENCE');
  assert.equal(selectedPrivateCard.boardRevision, null);
  assert.equal((await privateCardHandler(request())).status, 403);
  const pending = fixture({ mapping: { ...mapping, status: 'PENDING_CANONICAL_EQUIVALENCE' } });
  assert.equal((await pending.handler(request())).status, 503);
  assert.equal(pending.reads(), 0);
  const missing = fixture(); const absent = request(); absent.headers.delete('cookie');
  assert.equal((await missing.handler(absent)).status, 403); assert.equal(missing.reads(), 0);
  const foreign = fixture({ authenticate: async () => ({ subject: session, session, expires: 1100 }) });
  assert.equal((await foreign.handler(request())).status, 403); assert.equal(foreign.reads(), 0);
});

test('real endpoint denies signed-out calls identically across reader activation', async () => {
  const initial = process.env.OPERATIONS_READER_ENABLED;
  try {
    const absent = request(); absent.headers.delete('cookie');
    for (const enabled of ['false', 'true']) {
      process.env.OPERATIONS_READER_ENABLED = enabled;
      const response = await privateCardHandler(absent);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'CARD_ACCESS_DENIED' });
    }
    process.env.OPERATIONS_READER_ENABLED = 'false';
    const foreign = await privateCardHandler(request());
    assert.equal(foreign.status, 403);
    assert.deepEqual(await foreign.json(), { error: 'CARD_ACCESS_DENIED' });
  } finally {
    if (initial === undefined) delete process.env.OPERATIONS_READER_ENABLED;
    else process.env.OPERATIONS_READER_ENABLED = initial;
  }
});

test('signed-out and foreign callers cannot distinguish mapping or owner configuration', async () => {
  for (const selected of [mapping, { ...mapping, status: 'PENDING_CANONICAL_EQUIVALENCE' }]) {
    for (const ownerSubject of [owner, undefined]) {
      const absent = fixture({ mapping: selected, ownerSubject });
      const withoutCookie = request(); withoutCookie.headers.delete('cookie');
      assert.deepEqual(await (await absent.handler(withoutCookie)).json(), { error: 'CARD_ACCESS_DENIED' });
      assert.equal(absent.reads(), 0);
      const foreign = fixture({ mapping: selected, ownerSubject,
        authenticate: async () => ({ subject: session, session, expires: 1100 }) });
      const response = await foreign.handler(request());
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'CARD_ACCESS_DENIED' });
      assert.equal(foreign.reads(), 0);
    }
  }
});

test('only an authenticated owner gets one bounded display card and no private criteria', async () => {
  const f = fixture(); const response = await f.handler(request());
  assert.equal(response.status, 200); assert.equal(f.reads(), 1);
  assert.match(response.headers.get('cache-control'), /private, no-store/u);
  assert.match(response.headers.get('vary'), /Authorization, Cookie/u);
  const value = await response.json();
  assert.equal(value.stable_id, mapping.proposedStableId);
  assert.equal(value.board, 'fawxzzyweb');
  assert.equal(value.title, 'Traffic Analytics');
  assert.equal(Object.hasOwn(value, 'body'), false);
  assert.equal(JSON.stringify(value).includes('not sent to browser'), false);
});

test('wrong source, board revision, visibility and request origin fail closed', async () => {
  for (const changed of [
    { source_revision: 'd'.repeat(40) }, { board_revision: `sha256:${'d'.repeat(64)}` },
    { body: { ...card().body, visibility: 'PUBLIC' } },
  ]) {
    const f = fixture({ read: async () => ({ ...card(), ...changed }) });
    const result = await f.handler(request());
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: 'CARD_UNAVAILABLE' });
  }
  const f = fixture();
  assert.equal((await f.handler(request(newHandle(), { Origin: 'https://hostile.example' }))).status, 403);
  assert.equal(f.reads(), 0);
});

test('a second same-session read is held and expiry after the RPC suppresses the response', async () => {
  let release; const wait = new Promise((resolve) => { release = resolve; });
  const f = fixture({ read: () => wait }); const raw = newHandle();
  const first = f.handler(request(raw));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f.handler(request(raw))).status, 503);
  release(card()); assert.equal((await first).status, 200);
  let now = 1000;
  const expired = fixture({ now: () => now * 1000, read: async () => { now = 1100; return card(); } });
  assert.equal((await expired.handler(request())).status, 503);
});

test('distinct valid handles share one bounded server read budget', async () => {
  let release; const wait = new Promise((resolve) => { release = resolve; });
  const f = fixture({ read: () => { calls++; return wait; } }); let calls = 0;
  const active = Array.from({ length: 8 }, () => f.handler(request(newHandle())));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 8);
  const excess = await f.handler(request(newHandle()));
  assert.equal(excess.status, 503);
  assert.deepEqual(await excess.json(), { error: 'CARD_UNAVAILABLE' });
  assert.equal(calls, 8);
  release(card());
  assert.deepEqual(await Promise.all(active.map(async (result) => (await result).status)), Array(8).fill(200));
  assert.equal((await f.handler(request(newHandle()))).status, 200);
});

test('server store uses only the fixed authenticated operations_api RPC', async () => {
  let call;
  const store = createPrivateCardStore({ url: 'https://bxtcuhkotumitoqtrcej.supabase.co',
    publishableKey: `sb_publishable_${'x'.repeat(20)}` }, 'Bearer aaa.bbb.ccc', {
    fetchImpl: async (...args) => { call = args; return Response.json(card()); },
  });
  const digest = `sha256:${'e'.repeat(64)}`;
  assert.deepEqual(await store(digest), card());
  assert.equal(call[0], 'https://bxtcuhkotumitoqtrcej.supabase.co/rest/v1/rpc/read_private_project_card');
  assert.equal(call[1].headers['Content-Profile'], 'operations_api');
  assert.equal(call[1].headers.Authorization, 'Bearer aaa.bbb.ccc');
  assert.equal(call[1].cache, 'no-store');
  assert.deepEqual(JSON.parse(call[1].body), { handle_digest: digest });
});

test('browser reader sends a single same-origin no-store request and rejects changed Auth generation', async () => {
  let generation = 'g1'; let seen;
  const adapter = { kind: 'supabase', getAuthGeneration: () => generation,
    getSession: async () => ({ userId: owner }), getOAuthAccessToken: async () => 'bearer-for-source-test' };
  const display = { stable_id: mapping.proposedStableId, version: 1,
    body_digest: `sha256:${'c'.repeat(64)}`, board: 'fawxzzyweb', board_revision: mapping.boardRevision,
    source_revision: mapping.sourceRevision, title: 'Traffic Analytics', summary: 'Private plan', lifecycle: 'planning' };
  const value = await readPrivateProjectCard({ adapter, origin: ORIGIN,
    fetchImpl: async (...args) => { seen = args; return Response.json(display); } });
  assert.deepEqual(value, display);
  assert.equal(seen[0], `${ORIGIN}/api/projects/private-card`);
  assert.equal(seen[1].method, 'GET'); assert.equal(seen[1].cache, 'no-store');
  assert.equal(seen[1].credentials, 'include');
  await assert.rejects(readPrivateProjectCard({ adapter, origin: ORIGIN,
    fetchImpl: async () => { generation = 'g2'; return Response.json(display); } }));
  await assert.rejects(readPrivateProjectCard({ adapter, origin: 'https://fawxzzy.com',
    fetchImpl: () => { throw new Error('MUST_NOT_FETCH'); } }));
});
