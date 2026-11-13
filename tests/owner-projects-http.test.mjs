import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER } from '../src/server/operations/consumer-auth.mjs';
import { createOwnerProjectsHandler } from '../src/server/projects/owner-projects-http.mjs';

const now = 1800000000000;
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const SESSION = '22222222-2222-4222-8222-222222222222';
const auth = { url: MASTER, publishableKey: `sb_publishable_${'a'.repeat(24)}` };
const claims = (sub) => ({ sub, session_id: SESSION, iss: `${MASTER}/auth/v1`, aud: 'authenticated', role: 'authenticated', is_anonymous: false, exp: now / 1000 + 900 });
const jwt = (sub) => `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(claims(sub))).toString('base64url')}.c2lnbmF0dXJl`;
const board = { schema: 'fixture', boards: [{ id: 'fixture', cards: [{ title: 'OWNER_ONLY_CARD_TITLE' }] }] };

function request(kind = 'board', sub = OWNER, extra = {}) {
  const { headers = {}, url, method = 'GET' } = extra;
  return new Request(url ?? `https://account.fawxzzy.com/api/projects/${kind}`, { method,
    headers: { Origin: 'https://account.fawxzzy.com', 'X-Fawxzzy-Projects': '1', Authorization: `Bearer ${jwt(sub)}`,
      'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', ...headers } });
}
// The real consumer-auth.authenticate runs against a stubbed Auth provider.
function fixture(kind, overrides = {}) {
  const calls = { auth: 0, board: 0 };
  const deps = { auth, ownerSubject: OWNER, now: () => now,
    authOptions: { now: () => now, fetchImpl: async (_url, init) => {
      calls.auth += 1;
      const sub = JSON.parse(Buffer.from(init.headers.Authorization.slice(7).split('.')[1], 'base64url').toString()).sub;
      return Response.json({ id: sub, is_anonymous: false });
    } },
    loadBoard: async () => { calls.board += 1; return board; }, ...overrides };
  return { handler: createOwnerProjectsHandler(kind, deps), calls };
}

test('the owner gets { owner: true } from access and the full board from board', async () => {
  const access = fixture('access');
  const a = await access.handler(request('access'));
  assert.equal(a.status, 200);
  assert.deepEqual(await a.json(), { owner: true });
  assert.equal(access.calls.board, 0, 'access never loads the board');
  const full = fixture('board');
  const b = await full.handler(request('board'));
  assert.equal(b.status, 200);
  assert.deepEqual(await b.json(), board);
  assert.equal(b.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.match(b.headers.get('vary'), /Authorization/u);
});

test('any other signed-in account is denied with no board payload and no board load', async () => {
  for (const kind of ['access', 'board']) {
    const { handler, calls } = fixture(kind);
    const response = await handler(request(kind, OTHER));
    assert.equal(response.status, 403);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error: 'PROJECTS_ACCESS_DENIED' });
    assert.ok(!text.includes('OWNER_ONLY_CARD_TITLE'));
    assert.equal(calls.board, 0);
  }
});

test('a missing, malformed or unset owner subject fails closed before Auth is even called', async () => {
  for (const ownerSubject of [undefined, '', 'not-a-uuid', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA']) {
    const { handler, calls } = fixture('board', { ownerSubject });
    const response = await handler(request('board'));
    assert.equal(response.status, 403);
    assert.equal(calls.auth, 0);
    assert.equal(calls.board, 0);
  }
});

test('a signed-out or invalid bearer is denied; an Auth outage is unavailable, never allowed', async () => {
  const { handler } = fixture('board');
  assert.equal((await handler(request('board', OWNER, { headers: { Authorization: '' } }))).status, 403);
  assert.equal((await handler(request('board', OWNER, { headers: { Authorization: 'Bearer nope' } }))).status, 403);
  const rejected = fixture('board', { authOptions: { now: () => now, fetchImpl: async () => new Response('{}', { status: 401 }) } });
  assert.equal((await rejected.handler(request('board'))).status, 403);
  const outage = fixture('board', { authOptions: { now: () => now, fetchImpl: async () => new Response('{}', { status: 503 }) } });
  const down = await outage.handler(request('board'));
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { error: 'PROJECTS_UNAVAILABLE' });
  assert.equal(outage.calls.board, 0);
});

test('an expired identity is denied and a board load failure is unavailable without leaking', async () => {
  const stale = fixture('board', { now: () => now + 2_000_000 });
  assert.equal((await stale.handler(request('board'))).status, 403);
  const broken = fixture('board', { loadBoard: async () => { throw new Error('OWNER_ONLY_CARD_TITLE secret path'); } });
  const response = await broken.handler(request('board'));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('OWNER_ONLY_CARD_TITLE'));
});

test('the request guard rejects the wrong method, origin, path, query, fetch metadata and missing marker header', async () => {
  const { handler, calls } = fixture('board');
  const denied = [
    { method: 'POST' },
    { url: 'https://fawxzzy.com/api/projects/board' },
    { url: 'https://account.fawxzzy.com/api/projects/board?x=1' },
    { url: 'https://account.fawxzzy.com/api/projects/access' },
    { headers: { Origin: 'https://evil.example' } },
    { headers: { 'Sec-Fetch-Site': 'cross-site' } },
    { headers: { 'Sec-Fetch-Site': '' } },
    { headers: { 'Sec-Fetch-Mode': 'navigate' } },
    { headers: { 'Sec-Fetch-Dest': 'document' } },
    { headers: { 'X-Fawxzzy-Projects': '0' } },
    { headers: { 'X-Fawxzzy-Projects': '' } },
  ];
  for (const extra of denied) {
    const response = await handler(request('board', OWNER, extra));
    assert.equal(response.status, 403, JSON.stringify(extra));
  }
  assert.equal(calls.auth, 0);
  assert.equal(calls.board, 0);
});

test('only access and board endpoints exist', () => {
  assert.throws(() => createOwnerProjectsHandler('private-card', {}));
});
