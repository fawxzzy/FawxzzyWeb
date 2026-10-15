import { authenticate, COOKIE, fail, handleDigest, newHandle, readHandle, cookie, clearCookie, MASTER } from './consumer-auth.mjs';
import { createConsumerConnector, createConsumerStore } from './consumer-store.mjs';
import { exactOrder } from './ordering.mjs';

const ORIGIN = 'https://account.fawxzzy.com';
const HEADERS = { 'Cache-Control': 'no-store, max-age=0', 'Content-Type': 'application/json; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Cookie, Origin' };
const fields = (x, keys) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));
const text = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/u.test(x);
const array = (x, check, max = 256) => Array.isArray(x) && x.length <= max && new Set(x).size === x.length && x.every(check);
const digest = (x) => typeof x === 'string' && /^sha256:[a-f0-9]{64}$/u.test(x);
const stable = (x) => text(x, 1024) && /^card:[A-Za-z0-9_-]+:[a-z0-9][a-z0-9-]{1,62}$/u.test(x);
const lifecycle = new Set(['planning', 'ready', 'in_progress', 'review', 'blocked', 'completed', 'superseded']);
const response = (status, value, extra = {}) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { ...HEADERS, ...extra } });

export function validateView(value) {
  if (fields(value, ['error']) && value.error === 'OPS_ACCESS_DENIED') fail('OPS_ACCESS_DENIED');
  if (!fields(value, ['health', 'authoritative', 'actions_enabled', 'projection_revision', 'source_watermark', 'cards'])
    || !['healthy', 'stale', 'reconciling', 'incompatible', 'unavailable'].includes(value.health)
    || value.actions_enabled !== false || value.authoritative !== (value.health === 'healthy')
    || !Array.isArray(value.cards) || value.cards.length > 256 || !Array.isArray(value.source_watermark) || value.source_watermark.length > 256) fail('OPS_UNAVAILABLE');
  if (Buffer.byteLength(JSON.stringify(value)) > 1048576) fail('OPS_UNAVAILABLE');
  if (value.health !== 'healthy') {
    if (value.cards.length || value.source_watermark.length || value.projection_revision !== null) fail('OPS_UNAVAILABLE');
    return value;
  }
  if (!digest(value.projection_revision) || !value.source_watermark.length) fail('OPS_UNAVAILABLE');
  const producers = new Set();
  for (const w of value.source_watermark) {
    if (!fields(w, ['producer_identity', 'source_revision']) || !/^github-repository:[1-9][0-9]{0,19}$/u.test(w.producer_identity)
      || typeof w.source_revision !== 'string' || !/^[a-f0-9]{40}$/u.test(w.source_revision) || producers.has(w.producer_identity)) fail('OPS_UNAVAILABLE');
    producers.add(w.producer_identity);
  }
  const prefixes = new Set([...producers].map((p) => `card:${Buffer.from(p).toString('base64url')}:`));
  const ids = new Set(value.cards.map((c) => c?.stable_id));
  if (ids.size !== value.cards.length) fail('OPS_UNAVAILABLE');
  for (const c of value.cards) {
    if (!fields(c, ['stable_id', 'title', 'lifecycle', 'owner_role', 'created_at', 'updated_at', 'dependency_ids', 'blocker_codes', 'evidence_handles', 'supersedes_id'])
      || !stable(c.stable_id) || !prefixes.has(c.stable_id.slice(0, c.stable_id.lastIndexOf(':') + 1))
      || !text(c.title, 256) || !text(c.owner_role, 128) || !lifecycle.has(c.lifecycle)
      || !text(c.created_at, 300) || !text(c.updated_at, 300)
      || !array(c.dependency_ids, (id) => stable(id) && ids.has(id) && id !== c.stable_id)
      || !array(c.blocker_codes, (x) => typeof x === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(x))
      || !array(c.evidence_handles, (x) => typeof x === 'string' && /^evidence:[A-Za-z0-9_-]{16,128}$/u.test(x))
      || !(c.supersedes_id === null || (stable(c.supersedes_id) && ids.has(c.supersedes_id) && c.supersedes_id !== c.stable_id))) fail('OPS_UNAVAILABLE');
    let created; let updated;
    try { created = exactOrder(c.created_at); updated = exactOrder(c.updated_at); } catch { fail('OPS_UNAVAILABLE'); }
    if (BigInt(created.order_seconds) > BigInt(updated.order_seconds)) fail('OPS_UNAVAILABLE');
    if (created.order_seconds === updated.order_seconds) {
      const length = Math.max(created.order_fraction.length, updated.order_fraction.length);
      if (created.order_fraction.padEnd(length, '0') > updated.order_fraction.padEnd(length, '0')) fail('OPS_UNAVAILABLE');
    }
  }
  return value;
}

function guard(request, route) {
  const url = new URL(request.url); const methods = route === 'session' ? ['POST', 'DELETE'] : ['GET'];
  if (url.origin !== ORIGIN || url.pathname !== `/api/operations/${route}` || url.search || url.hash || url.username || url.password
    || request.headers.get('origin') !== ORIGIN || request.headers.get('x-fawxzzy-operations') !== '1'
    || !methods.includes(request.method) || request.body !== null
    || (request.headers.has('content-length') && request.headers.get('content-length') !== '0')
    || request.headers.has('transfer-encoding') || request.headers.get('sec-fetch-mode') === 'navigate'
    || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) fail('OPS_REQUEST_DENIED');
}

// Trusted module injection is used by deterministic tests, never request data.
export function createConsumerHandler(dependencies) {
  return async (request, route) => {
    let mutation = false;
    try {
      guard(request, route);
      const handle = readHandle(request);
      const deps = typeof dependencies === 'function' ? dependencies() : dependencies;
      const identity = await (deps.authenticate ?? authenticate)(request, deps.auth, deps.authOptions);
      if (route === 'session' && request.method === 'POST') {
        // One current session per browser cookie. Explicitly close before reopen.
        if (handle) return response(409, { error: 'OPS_SESSION_EXISTS' });
        const raw = newHandle(); const now = Math.floor((deps.now ?? Date.now)() / 1000);
        const age = identity.expires - now;
        if (!Number.isSafeInteger(age) || age < 1 || age > 900) fail('OPS_ACCESS_DENIED');
        mutation = true;
        await deps.store.open(handleDigest(raw, identity), identity);
        return response(204, null, { 'Set-Cookie': cookie(raw, age) });
      }
      if (!handle) fail('OPS_ACCESS_DENIED');
      const digest = handleDigest(handle, identity);
      if (route === 'session') {
        mutation = true; await deps.store.close(digest);
        return response(204, null, { 'Set-Cookie': clearCookie() });
      }
      return response(200, validateView(await deps.store.read(digest)));
    } catch (error) {
      const code = ['OPS_ACCESS_DENIED', 'OPS_REQUEST_DENIED'].includes(error?.code) ? error.code : 'OPS_UNAVAILABLE';
      return response(code === 'OPS_UNAVAILABLE' ? 503 : 403, { error: code },
        mutation || code === 'OPS_ACCESS_DENIED' ? { 'Set-Cookie': clearCookie() } : {});
    }
  };
}

function environmentDependencies() {
  // Explicitly off by default. These new scoped credentials are not provisioned
  // by publishing this source. No existing intake/provider capsules are read.
  if (process.env.OPERATIONS_READER_ENABLED !== 'true') fail('OPS_UNAVAILABLE');
  const settings = (kind) => {
    const name = kind.toUpperCase();
    return { host: process.env[`OPERATIONS_${name}_DB_HOST`], port: Number(process.env[`OPERATIONS_${name}_DB_PORT`]),
      database: 'postgres', user: process.env[`OPERATIONS_${name}_DB_USER`], password: process.env[`OPERATIONS_${name}_DB_PASSWORD`],
      ca: process.env[`OPERATIONS_${name}_DB_CA`] };
  };
  return { auth: { url: MASTER, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    store: createConsumerStore({ reader: createConsumerConnector('reader', settings('reader')),
      session: createConsumerConnector('session', settings('session')) }) };
}
export const operationsHandler = createConsumerHandler(environmentDependencies);
export { COOKIE };
