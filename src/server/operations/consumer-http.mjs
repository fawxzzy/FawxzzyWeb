import { authenticate, COOKIE, fail, handleDigest, newHandle, readHandle, cookie, clearCookie, MASTER } from './consumer-auth.mjs';
import { createConsumerStore } from './consumer-store.mjs';
import { validateView } from '../../lib/operations/display-contract.mjs';
export { validateView } from '../../lib/operations/display-contract.mjs';

const ORIGIN = 'https://account.fawxzzy.com';
const HEADERS = { 'Cache-Control': 'no-store, max-age=0', 'Content-Type': 'application/json; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Cookie, Origin, Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest' };
const response = (status, value, extra = {}) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { ...HEADERS, ...extra } });

function guard(request, route) {
  const url = new URL(request.url); const methods = route === 'session' ? ['POST', 'DELETE'] : ['GET'];
  const origin = request.headers.get('origin');
  // Browsers normally omit Origin on same-origin GET. Require their exact
  // fetch context instead; it supplements, never replaces, Auth/session checks.
  const validOrigin = route === 'read' && request.method === 'GET'
    ? (origin === null || origin === ORIGIN)
      && request.headers.get('sec-fetch-site') === 'same-origin'
      && ['cors', 'same-origin'].includes(request.headers.get('sec-fetch-mode'))
      && request.headers.get('sec-fetch-dest') === 'empty'
    : origin === ORIGIN;
  if (url.origin !== ORIGIN || url.pathname !== `/api/operations/${route}` || url.search || url.hash || url.username || url.password
    || !validOrigin || request.headers.get('x-fawxzzy-operations') !== '1'
    || !methods.includes(request.method)
    || (request.headers.has('content-length') && request.headers.get('content-length') !== '0')
    || request.headers.has('transfer-encoding') || request.headers.get('sec-fetch-mode') === 'navigate'
    || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) fail('OPS_REQUEST_DENIED');
}

async function requireEmptyBody(request) {
  if (request.signal.aborted || request.bodyUsed) fail('OPS_REQUEST_DENIED');
  if (request.body === null) return;
  if (request.method === 'GET' || request.body.locked) fail('OPS_REQUEST_DENIED');
  // A server may represent a zero-byte POST/DELETE as a stream. Prove EOF
  // before reading configuration or credentials; never accept a claimed zero
  // Content-Length in place of the actual payload check.
  const reader = request.body.getReader(); let timer; let abort; let emptyChunks = 0;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('body timeout')), 1000);
    abort = () => reject(new Error('body aborted'));
    request.signal.addEventListener('abort', abort, { once: true });
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (request.signal.aborted) fail('OPS_REQUEST_DENIED');
      if (done) return;
      if (!(value instanceof Uint8Array) || value.byteLength !== 0 || ++emptyChunks > 16) fail('OPS_REQUEST_DENIED');
    }
  } catch {
    // Cancellation itself may never settle. It must not delay the denial.
    void reader.cancel().catch(() => {});
    fail('OPS_REQUEST_DENIED');
  } finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch { /* Pending reads remain canceled. */ }
  }
}

// Trusted module injection is used by deterministic tests, never request data.
export function createConsumerHandler(dependencies) {
  return async (request, route) => {
    let mutation = false;
    try {
      guard(request, route);
      await requireEmptyBody(request);
      const handle = readHandle(request);
      const deps = typeof dependencies === 'function' ? dependencies() : dependencies;
      const identity = await (deps.authenticate ?? authenticate)(request, deps.auth, deps.authOptions);
      const store = deps.store ?? createConsumerStore(deps.auth, request.headers.get('authorization'), deps.storeOptions);
      if (route === 'session' && request.method === 'POST') {
        // One current session per browser cookie. Explicitly close before reopen.
        if (handle) return response(409, { error: 'OPS_SESSION_EXISTS' });
        const raw = newHandle(); const now = Math.floor((deps.now ?? Date.now)() / 1000);
        const age = identity.expires - now;
        if (!Number.isSafeInteger(age) || age < 1 || age > 900) fail('OPS_ACCESS_DENIED');
        mutation = true;
        await store.open(handleDigest(raw, identity), identity);
        return response(204, null, { 'Set-Cookie': cookie(raw, age) });
      }
      if (!handle) fail('OPS_ACCESS_DENIED');
      const digest = handleDigest(handle, identity);
      if (route === 'session') {
        mutation = true; await store.close(digest);
        return response(204, null, { 'Set-Cookie': clearCookie() });
      }
      return response(200, validateView(await store.read(digest)));
    } catch (error) {
      const code = ['OPS_ACCESS_DENIED', 'OPS_REQUEST_DENIED'].includes(error?.code) ? error.code : 'OPS_UNAVAILABLE';
      return response(code === 'OPS_UNAVAILABLE' ? 503 : 403, { error: code },
        mutation || code === 'OPS_ACCESS_DENIED' ? { 'Set-Cookie': clearCookie() } : {});
    }
  };
}

function environmentDependencies() {
  // Explicitly off by default. RPC installation, exposure, operator grant and
  // deployment are separate acceptance steps. Only a publishable key is used.
  if (process.env.OPERATIONS_READER_ENABLED !== 'true') fail('OPS_UNAVAILABLE');
  return { auth: { url: MASTER, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } };
}
export const operationsHandler = createConsumerHandler(environmentDependencies);
export { COOKIE };
