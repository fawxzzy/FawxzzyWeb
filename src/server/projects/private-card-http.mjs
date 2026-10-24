import { authenticate, fail, handleDigest, MASTER, readHandle } from '../operations/consumer-auth.mjs';
import { selectedPrivateCard } from './selected-private-card.mjs';

const ORIGIN = 'https://account.fawxzzy.com';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const SHA = /^sha256:[a-f0-9]{64}$/u;
const CARD = /^FF-[A-Z0-9][A-Z0-9-]*$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const MAX_BYTES = 64 * 1024;
const MAX_IN_FLIGHT = 8;
const inFlightDigests = new Set();
const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Authorization, Cookie, Origin, Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest',
};
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: HEADERS });
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));

function guard(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' || url.origin !== ORIGIN || url.pathname !== '/api/projects/private-card'
    || url.search || url.hash || url.username || url.password || request.body !== null
    || request.headers.has('transfer-encoding')
    || (request.headers.has('content-length') && request.headers.get('content-length') !== '0')
    || (origin !== null && origin !== ORIGIN)
    || request.headers.get('sec-fetch-site') !== 'same-origin'
    || !['cors', 'same-origin'].includes(request.headers.get('sec-fetch-mode'))
    || request.headers.get('sec-fetch-dest') !== 'empty'
    || request.headers.get('x-fawxzzy-private-card') !== '1') fail('CARD_REQUEST_DENIED');
}

function acceptedMapping(mapping) {
  return exactKeys(mapping, ['status', 'sourceId', 'proposedStableId', 'board', 'sourceRevision', 'boardRevision'])
    && mapping.status === 'ACCEPTED' && mapping.sourceId === 'FW-ANALYTICS-001'
    && CARD.test(mapping.proposedStableId) && mapping.board === 'fawxzzyweb'
    && COMMIT.test(mapping.sourceRevision) && SHA.test(mapping.boardRevision);
}

export function validatePrivateCardResponse(value, mapping) {
  if (!acceptedMapping(mapping)
    || !exactKeys(value, ['stable_id', 'version', 'body_digest', 'body', 'board_revision', 'source_revision'])
    || value.stable_id !== mapping.proposedStableId
    || !Number.isSafeInteger(value.version) || value.version < 1
    || !SHA.test(value.body_digest) || value.board_revision !== mapping.boardRevision
    || value.source_revision !== mapping.sourceRevision
    || !value.body || typeof value.body !== 'object' || Array.isArray(value.body)
    || value.body.stable_id !== value.stable_id || value.body.visibility !== 'PRIVATE'
    || value.body.source_card_id !== mapping.sourceId
    || typeof value.body.title !== 'string' || value.body.title.length < 1 || value.body.title.length > 160
    || typeof value.body.summary !== 'string' || value.body.summary.length > 2000
    || value.body.lifecycle !== 'planning') fail('CARD_UNAVAILABLE');
  // The SQL wrapper must verify the PostgreSQL JSONB-text body digest before
  // returning the row. The browser receives only bounded display fields.
  return { stable_id: value.stable_id, version: value.version, body_digest: value.body_digest,
    board: mapping.board, board_revision: value.board_revision, source_revision: value.source_revision,
    title: value.body.title, summary: value.body.summary, lifecycle: value.body.lifecycle };
}

// Optional admitted server-only role service. Validate its minimized output
// again at the browser boundary; never serialize an arbitrary service result.
export function validatePrivateCardDisplay(value, mapping) {
  if (!exactKeys(value, ['stable_id', 'version', 'body_digest', 'board', 'board_revision',
    'source_revision', 'title', 'summary', 'lifecycle']) || value.board !== mapping?.board) fail('CARD_UNAVAILABLE');
  return validatePrivateCardResponse({ stable_id: value.stable_id, version: value.version,
    body_digest: value.body_digest, board_revision: value.board_revision, source_revision: value.source_revision,
    body: { stable_id: value.stable_id, visibility: 'PRIVATE', source_card_id: mapping.sourceId,
      title: value.title, summary: value.summary, lifecycle: value.lifecycle } }, mapping);
}

async function boundedJson(response, signal) {
  const length = response.headers.get('content-length');
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')
    || (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > MAX_BYTES)) || !response.body) {
    void response.body?.cancel().catch(() => {}); fail('CARD_UNAVAILABLE');
  }
  const reader = response.body.getReader(); const chunks = []; let bytes = 0; let abort;
  const deadline = new Promise((_, reject) => {
    abort = () => reject(new Error('CARD_UNAVAILABLE'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > MAX_BYTES - bytes) fail('CARD_UNAVAILABLE');
      bytes += part.value.byteLength; chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { fail('CARD_UNAVAILABLE'); }
  finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); }
}

export function createPrivateCardStore(config, authorization, { fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  if (!exactKeys(config, ['url', 'publishableKey']) || config.url !== MASTER
    || typeof config.publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/u.test(config.publishableKey)
    || typeof authorization !== 'string' || authorization.length > 8192
    || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(authorization)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3000) fail('CARD_UNAVAILABLE');
  return async (digest) => {
    if (!SHA.test(digest)) fail('CARD_ACCESS_DENIED');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const deadline = new Promise((_, reject) => controller.signal.addEventListener('abort',
      () => reject(new Error('CARD_UNAVAILABLE')), { once: true }));
    try {
      const upstream = await Promise.race([fetchImpl(`${MASTER}/rest/v1/rpc/read_private_project_card`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: authorization,
          'Content-Profile': 'operations_api', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ handle_digest: digest }),
      }), deadline]);
      if (upstream.status !== 200 || upstream.redirected) {
        void upstream.body?.cancel().catch(() => {}); fail('CARD_UNAVAILABLE');
      }
      return await boundedJson(upstream, controller.signal);
    } catch { fail('CARD_UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  };
}

// Dependency injection is for source tests. Request data cannot set the owner,
// selected card, RPC name, or server-only Supabase configuration.
export function createPrivateCardHandler(dependencies) {
  return async (request) => {
    try {
      guard(request);
      const handle = readHandle(request);
      if (!handle) fail('CARD_ACCESS_DENIED');
      const deps = typeof dependencies === 'function' ? dependencies() : dependencies;
      if (!UUID.test(deps.ownerSubject ?? '')) fail('CARD_ACCESS_DENIED');
      const identity = await (deps.authenticate ?? authenticate)(request, deps.auth, deps.authOptions);
      if (identity.subject !== deps.ownerSubject) fail('CARD_ACCESS_DENIED');
      if (!acceptedMapping(deps.mapping)) fail('CARD_UNAVAILABLE');
      if (!Number.isSafeInteger(identity.expires) || identity.expires <= Math.floor((deps.now ?? Date.now)() / 1000)
        || request.signal.aborted) fail('CARD_ACCESS_DENIED');
      const digest = handleDigest(handle, identity);
      if (inFlightDigests.has(digest) || inFlightDigests.size >= MAX_IN_FLIGHT) fail('CARD_UNAVAILABLE');
      const read = deps.ownerService ? () => deps.ownerService.read(request)
        : deps.read ?? createPrivateCardStore(deps.auth, request.headers.get('authorization'), deps.storeOptions);
      inFlightDigests.add(digest);
      try {
        const value = await read(digest);
        const card = deps.ownerService ? validatePrivateCardDisplay(value, deps.mapping)
          : validatePrivateCardResponse(value, deps.mapping);
        if (identity.expires <= Math.floor((deps.now ?? Date.now)() / 1000) || request.signal.aborted) fail('CARD_UNAVAILABLE');
        return json(200, card);
      } finally { inFlightDigests.delete(digest); }
    } catch (error) {
      const denied = error?.code === 'CARD_ACCESS_DENIED' || error?.code === 'CARD_REQUEST_DENIED'
        || error?.code === 'OPS_ACCESS_DENIED';
      return json(denied ? 403 : 503, { error: denied ? 'CARD_ACCESS_DENIED' : 'CARD_UNAVAILABLE' });
    }
  };
}

function environmentDependencies() {
  if (process.env.OPERATIONS_READER_ENABLED !== 'true') fail('CARD_ACCESS_DENIED');
  return { mapping: selectedPrivateCard, ownerSubject: process.env.OPERATIONS_OWNER_SUBJECT,
    auth: { url: MASTER, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } };
}
export const privateCardHandler = createPrivateCardHandler(environmentDependencies);
