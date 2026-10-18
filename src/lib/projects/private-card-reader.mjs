import { readResponseJson } from '../operations/reader-client.mjs';

const ORIGIN = 'https://account.fawxzzy.com';
const SHA = /^sha256:[a-f0-9]{64}$/u;
const CARD = /^FF-[A-Z0-9][A-Z0-9-]*$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const LOCAL = new Set(['http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:4312', 'http://127.0.0.1:4312']);
const unavailable = () => { throw new Error('CARD_UNAVAILABLE'); };
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));

export function validatePrivateCardDisplay(value) {
  if (!exactKeys(value, ['stable_id', 'version', 'body_digest', 'board', 'board_revision',
    'source_revision', 'title', 'summary', 'lifecycle'])
    || !CARD.test(value.stable_id) || !Number.isSafeInteger(value.version) || value.version < 1
    || !SHA.test(value.body_digest) || value.board !== 'fawxzzyweb'
    || !SHA.test(value.board_revision) || !COMMIT.test(value.source_revision)
    || typeof value.title !== 'string' || value.title.length < 1 || value.title.length > 160
    || typeof value.summary !== 'string' || value.summary.length > 2000
    || value.lifecycle !== 'planning') unavailable();
  return value;
}

export async function readPrivateProjectCard({ adapter, origin, localTest = false,
  fetchImpl = fetch, signal, timeoutMs = 10_000 }) {
  if (!adapter || !(adapter.kind === 'supabase' && origin === ORIGIN
    || adapter.kind === 'test' && localTest === true && LOCAL.has(origin))
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) unavailable();
  const generation = adapter.getAuthGeneration();
  if (!generation || signal?.aborted) unavailable();
  const session = await adapter.getSession();
  if (!session?.userId || adapter.getAuthGeneration() !== generation || signal?.aborted) unavailable();
  const bearer = await adapter.getOAuthAccessToken(session.userId);
  if (typeof bearer !== 'string' || bearer.length < 16 || bearer.length > 16_384
    || /[^\x21-\x7e]/u.test(bearer) || adapter.getAuthGeneration() !== generation || signal?.aborted) unavailable();
  const checked = await adapter.getSession();
  if (checked?.userId !== session.userId || adapter.getAuthGeneration() !== generation || signal?.aborted) unavailable();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const deadline = new Promise((_, reject) => controller.signal.addEventListener('abort',
    () => reject(new Error('CARD_UNAVAILABLE')), { once: true }));
  try {
    if (signal?.aborted) unavailable();
    const response = await Promise.race([fetchImpl(`${origin}/api/projects/private-card`, {
      method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', mode: 'same-origin',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${bearer}`, 'X-Fawxzzy-Private-Card': '1' },
    }), deadline]);
    if (response.status !== 200 || response.redirected) { void response.body?.cancel().catch(() => {}); unavailable(); }
    const current = () => !controller.signal.aborted && adapter.getAuthGeneration() === generation && !signal?.aborted;
    const value = validatePrivateCardDisplay(await readResponseJson(response, current));
    const finalSession = await adapter.getSession();
    if (!current() || finalSession?.userId !== session.userId) unavailable();
    return value;
  } catch { unavailable(); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
