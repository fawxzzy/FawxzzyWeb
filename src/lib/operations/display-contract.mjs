import { exactOrder } from './ordering.mjs';
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const fields = (x, keys) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));
const text = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/u.test(x);
const array = (x, check, max = 256) => Array.isArray(x) && x.length <= max && new Set(x).size === x.length && x.every(check);
const digest = (x) => typeof x === 'string' && /^sha256:[a-f0-9]{64}$/u.test(x);
const stable = (x) => text(x, 1024) && /^card:[A-Za-z0-9_-]+:[a-z0-9][a-z0-9-]{1,62}$/u.test(x);
const lifecycle = new Set(['planning', 'ready', 'in_progress', 'review', 'blocked', 'completed', 'superseded']);
export function validateView(value) {
  if (fields(value, ['error']) && value.error === 'OPS_ACCESS_DENIED') fail('OPS_ACCESS_DENIED');
  if (!fields(value, ['health', 'authoritative', 'actions_enabled', 'projection_revision', 'source_watermark', 'cards'])
    || !['healthy', 'stale', 'reconciling', 'incompatible', 'unavailable'].includes(value.health)
    || value.actions_enabled !== false || value.authoritative !== (value.health === 'healthy')
    || !Array.isArray(value.cards) || value.cards.length > 256 || !Array.isArray(value.source_watermark) || value.source_watermark.length > 256) fail('OPS_UNAVAILABLE');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 1048576) fail('OPS_UNAVAILABLE');
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
  const prefixes = new Set([...producers].map((p) => `card:${btoa(p).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')}:`));
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
