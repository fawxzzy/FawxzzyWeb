import { createHash, randomBytes } from 'node:crypto';

export const MASTER = 'https://bxtcuhkotumitoqtrcej.supabase.co';
export const COOKIE = '__Host-fawxzzy-operations';
export const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const uuid = (x) => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(x);
export const handleValid = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(x)
  && Buffer.from(x, 'base64url').length === 32 && Buffer.from(x, 'base64url').toString('base64url') === x;
export function handleDigest(handle, identity) {
  if (!handleValid(handle) || !uuid(identity?.subject) || !uuid(identity?.session)) fail('OPS_ACCESS_DENIED');
  return `sha256:${createHash('sha256').update(JSON.stringify(['operations-session-v1', handle, identity.subject, identity.session])).digest('hex')}`;
}
export const newHandle = () => randomBytes(32).toString('base64url');
export const cookie = (handle, age) => `${COOKIE}=${handle}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Strict`;
export const clearCookie = () => cookie('', 0);
export function readHandle(request) {
  const raw = request.headers.get('cookie') ?? '';
  if (raw.length > 8192) fail('OPS_ACCESS_DENIED');
  const found = raw.split(';').map((s) => s.trim()).filter((s) => s.startsWith(`${COOKIE}=`));
  if (found.length > 1) fail('OPS_ACCESS_DENIED');
  if (found.length === 0) return null;
  const handle = found[0].slice(COOKIE.length + 1);
  if (!handleValid(handle)) fail('OPS_ACCESS_DENIED');
  return handle;
}

// A bounded stream read, including a finite wait when a producer ignores abort.
export async function boundedAuthJson(response, signal) {
  if (!response.body) fail('OPS_AUTH_UNAVAILABLE');
  const reader = response.body.getReader(); const chunks = []; let size = 0; let abort;
  const timed = new Promise((_, reject) => {
    abort = () => reject(new Error('OPS_AUTH_UNAVAILABLE'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), timed]);
      if (done) break;
      size += value.byteLength;
      if (size > 16384) fail('OPS_AUTH_UNAVAILABLE');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { fail('OPS_AUTH_UNAVAILABLE'); }
  finally {
    signal.removeEventListener('abort', abort);
    // Cancellation may itself be implemented by a nonsettling upstream.
    reader.cancel().catch(() => {});
  }
}

export async function authenticate(request, config, { fetchImpl = fetch, now = Date.now, timeoutMs = 3000 } = {}) {
  const header = request.headers.get('authorization') ?? '';
  if (header.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(header)) fail('OPS_ACCESS_DENIED');
  if (!config || config.url !== MASTER || typeof config.publishableKey !== 'string'
      || !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/u.test(config.publishableKey)) fail('OPS_UNAVAILABLE');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  let abort;
  const deadline = new Promise((_, reject) => {
    abort = () => reject(new Error('OPS_AUTH_UNAVAILABLE'));
    controller.signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const upstream = await Promise.race([fetchImpl(`${MASTER}/auth/v1/user`, { method: 'GET',
      headers: { apikey: config.publishableKey, Authorization: header, Accept: 'application/json' },
      redirect: 'error', cache: 'no-store', signal: controller.signal }), deadline]);
    if (!upstream.ok) {
      upstream.body?.cancel().catch(() => {});
      fail(upstream.status === 401 || upstream.status === 403 ? 'OPS_ACCESS_DENIED' : 'OPS_AUTH_UNAVAILABLE');
    }
    const user = await boundedAuthJson(upstream, controller.signal);
    let claims;
    try { claims = JSON.parse(Buffer.from(header.slice(7).split('.')[1], 'base64url').toString('utf8')); }
    catch { fail('OPS_ACCESS_DENIED'); }
    const seconds = Math.floor(now() / 1000);
    if (!uuid(claims?.sub) || !uuid(claims?.session_id) || claims.iss !== `${MASTER}/auth/v1`
      || claims.aud !== 'authenticated' || claims.role !== 'authenticated'
      || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds
      || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > seconds))
      || !user || user.id !== claims.sub || user.is_anonymous !== false) fail('OPS_ACCESS_DENIED');
    return { subject: claims.sub, session: claims.session_id, expires: Math.min(claims.exp, seconds + 900) };
  } catch (error) { fail(error?.code === 'OPS_ACCESS_DENIED' ? 'OPS_ACCESS_DENIED' : 'OPS_AUTH_UNAVAILABLE'); }
  finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
}
