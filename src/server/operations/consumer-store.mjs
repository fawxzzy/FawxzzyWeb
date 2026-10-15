import { fail, MASTER } from './consumer-auth.mjs';

export const INPUT_LIMIT = 1024 * 1024;
const digestValid = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every((key) => Object.hasOwn(value, key));

// Includes stalled streams that ignore AbortSignal. No private body is logged.
export async function boundedRpcJson(response, signal) {
  const length = response.headers.get('content-length');
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')
    || (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > INPUT_LIMIT)) || !response.body) {
    response.body?.cancel().catch(() => {}); fail('OPS_UNAVAILABLE');
  }
  const reader = response.body.getReader(); const chunks = []; let size = 0; let abort;
  const deadline = new Promise((_, reject) => {
    abort = () => reject(new Error('OPS_UNAVAILABLE'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > INPUT_LIMIT - size) fail('OPS_UNAVAILABLE');
      size += value.byteLength; chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { fail('OPS_UNAVAILABLE'); }
  finally { signal.removeEventListener('abort', abort); reader.cancel().catch(() => {}); }
}

// Construct only after master Auth validates this exact bearer. All endpoints
// are fixed; there are no direct SQL credentials or caller-selected RPC names.
export function createConsumerStore(config, authorization, { fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  if (!keys(config, ['url', 'publishableKey']) || config.url !== MASTER
    || typeof config.publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/u.test(config.publishableKey)
    || typeof authorization !== 'string' || authorization.length > 8192
    || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(authorization)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3000) fail('OPS_UNAVAILABLE');
  async function call(name, digest, identity) {
    if (!digestValid(digest)) fail('OPS_ACCESS_DENIED');
    const body = { handle_digest: digest };
    if (name === 'open_session') {
      if (!Number.isSafeInteger(identity?.expires) || identity.expires < 1 || identity.expires > 253402300799) fail('OPS_ACCESS_DENIED');
      body.expires_at = new Date(identity.expires * 1000).toISOString();
    }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); let abort;
    const deadline = new Promise((_, reject) => {
      abort = () => reject(new Error('OPS_UNAVAILABLE'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const response = await Promise.race([fetchImpl(`${MASTER}/rest/v1/rpc/${name}`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: authorization,
          'Content-Profile': 'operations_api', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }), deadline]);
      if (response.status !== 200) {
        response.body?.cancel().catch(() => {});
        fail(response.status === 401 || response.status === 403 ? 'OPS_ACCESS_DENIED' : 'OPS_UNAVAILABLE');
      }
      const value = await boundedRpcJson(response, controller.signal);
      if (keys(value, ['error']) && value.error === 'OPS_ACCESS_DENIED') fail('OPS_ACCESS_DENIED');
      if (name === 'read') return value; // Complete display validation is in the HTTP adapter.
      if (!keys(value, ['status']) || value.status !== (name === 'open_session' ? 'opened' : 'closed')) fail('OPS_UNAVAILABLE');
      return undefined;
    } catch (error) { fail(error?.code === 'OPS_ACCESS_DENIED' ? 'OPS_ACCESS_DENIED' : 'OPS_UNAVAILABLE'); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
  }
  return Object.freeze({ read: (digest) => call('read', digest),
    open: (digest, identity) => call('open_session', digest, identity), close: (digest) => call('close_session', digest) });
}
