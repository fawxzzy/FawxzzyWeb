import { createHash } from 'node:crypto';
import { authenticate } from '../operations/consumer-auth.mjs';
import { validatePrivateCardResponse } from './private-card-http.mjs';

// No route, environment activation, credential lookup, grant, SQL or CLI here.
// The separately admitted host supplies independently verified source/trust and
// membership pins plus an atomic durable journal shared by ALL its instances.
// This source does not implement that host or claim its attestations are real.
// Process memory sees the complete private graph; DB-side minimization is open.
const SHA = /^sha256:[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const BATCH = /^[a-z][a-z0-9_-]{1,127}$/u;
const fail = () => { throw new Error('CARD_UNAVAILABLE'); };
const clone = (v) => JSON.parse(JSON.stringify(v));
const sha = (v) => `sha256:${createHash('sha256').update(JSON.stringify(v)).digest('hex')}`;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every((n) => Object.hasOwn(v, n));

export function createPrivateCardOwnerService({ ownerSubject, ownerSession, auth, store, journal,
  admission, selection, binding, verifyHostBinding, authenticateRequest = authenticate, authOptions, now = Date.now }) {
  if (!UUID.test(ownerSubject) || !UUID.test(ownerSession) || typeof authenticateRequest !== 'function'
    || typeof now !== 'function' || typeof verifyHostBinding !== 'function'
    || !store || !['seal', 'apply', 'readBatch', 'readGraph'].every((n) => typeof store[n] === 'function')
    || !journal || !['claim', 'set', 'get'].every((n) => typeof journal[n] === 'function')) fail();
  const plan = admission === undefined ? null : clone(admission);
  const selected = selection === undefined ? null : clone(selection);
  const acceptedBinding = binding === undefined ? null : clone(binding);
  const fixedAuth = auth && Object.freeze({ ...auth });
  async function owner(request, operation) {
    if (!(request instanceof Request) || request.signal.aborted) fail();
    const identity = await authenticateRequest(request, fixedAuth, authOptions);
    if (identity?.subject !== ownerSubject || identity.session !== ownerSession
      || !Number.isSafeInteger(identity.expires) || identity.expires <= Math.floor(now() / 1000)) fail();
    const fresh = () => { if (request.signal.aborted || identity.expires <= Math.floor(now() / 1000)) fail(); };
    selectionPins(); planPins(false); bindingPins();
    // Mandatory future host verifier: prove independent source/trust receipt,
    // PRIVATE membership, digest bridge and operation authority. Merely setting
    // status ACCEPTED or supplying SHA-shaped strings is never sufficient.
    // No verifier implementation/credentials/permission grant ships here.
    if (await verifyHostBinding({ binding: clone(acceptedBinding), selection: clone(selected),
      admission: clone(plan), identity: { ...identity }, operation }) !== true) fail();
    fresh(); return fresh;
  }
  function selectionPins() {
    if (!keys(selected, ['mapping', 'version', 'bodyDigest', 'graphDigest', 'membershipDigest', 'membership'])
      || selected.mapping?.status !== 'ACCEPTED' || selected.mapping.board !== 'fawxzzyweb'
      || !Number.isSafeInteger(selected.version) || selected.version < 1
      || ![selected.bodyDigest, selected.graphDigest, selected.membershipDigest].every((v) => SHA.test(v))) fail();
    const m = selected.membership;
    if (!keys(m, ['board', 'stableId', 'version', 'visibility', 'sourceId', 'sourceRevision', 'boardRevision'])
      || m.board !== selected.mapping.board || m.stableId !== selected.mapping.proposedStableId
      || m.version !== selected.version || m.visibility !== 'PRIVATE'
      || m.sourceId !== selected.mapping.sourceId || m.sourceRevision !== selected.mapping.sourceRevision
      || m.boardRevision !== selected.mapping.boardRevision || sha(m) !== selected.membershipDigest) fail();
  }
  function bindingPins() {
    if (!keys(acceptedBinding, ['schema', 'state', 'subject', 'session', 'selectionDigest', 'planDigest', 'nextBodyDigest'])
      || acceptedBinding.schema !== 'private-card-owner-binding.v1' || acceptedBinding.state !== 'ACCEPTED'
      || acceptedBinding.subject !== ownerSubject || acceptedBinding.session !== ownerSession
      || acceptedBinding.selectionDigest !== sha(selected) || acceptedBinding.planDigest !== sha(plan)
      || acceptedBinding.nextBodyDigest !== sha(plan.payload.changes[0].next)) fail();
    // The three JSON.stringify hashes bind the in-process host snapshot only.
    // They are NOT PostgreSQL JSONB hashes; verifyHostBinding must independently
    // verify that bridge against the actual source/trust receipt before use.
  }
  function planPins(checkExpiry = true) {
    if (!keys(plan, ['payload', 'payloadDigest', 'inputDigest', 'baselineDigest', 'postGraphDigest',
      'sourceRevision', 'trustReceipt', 'expiresAt'])
      || !keys(plan.payload, ['batch_id', 'baseline', 'changes']) || !BATCH.test(plan.payload.batch_id)
      || !Array.isArray(plan.payload.baseline) || !Array.isArray(plan.payload.changes)
      || plan.payload.changes.length !== 1 || sha(plan.payload) !== plan.payloadDigest
      || ![plan.inputDigest, plan.baselineDigest, plan.postGraphDigest, plan.trustReceipt].every((v) => SHA.test(v))
      || !/^[a-f0-9]{40}$/u.test(plan.sourceRevision)
      || Buffer.byteLength(JSON.stringify(plan.payload)) > 2 * 1024 * 1024) fail();
    const change = plan.payload.changes[0];
    if (!keys(change, ['stable_id', 'expected_version', 'expected_body_digest', 'next'])
      || change.stable_id !== selected.mapping.proposedStableId
      || !Number.isSafeInteger(change.expected_version) || change.expected_version < 0
      || (change.expected_version === 0 ? change.expected_body_digest !== null : !SHA.test(change.expected_body_digest))
      || change.next?.stable_id !== change.stable_id || change.next.visibility !== 'PRIVATE'
      || change.next.version !== change.expected_version + 1
      || change.next.version !== selected.version || plan.postGraphDigest !== selected.graphDigest
      || change.next.source_card_id !== selected.mapping.sourceId
      || plan.sourceRevision !== selected.mapping.sourceRevision) fail();
    validatePrivateCardResponse({ stable_id: change.stable_id, version: change.next.version,
      body_digest: selected.bodyDigest, body: change.next, board_revision: selected.mapping.boardRevision,
      source_revision: plan.sourceRevision }, selected.mapping);
    const until = Date.parse(plan.expiresAt); const time = now();
    if (!Number.isFinite(until) || new Date(until).toISOString() !== plan.expiresAt
      || (checkExpiry && (until <= time || until > time + 900000))) fail();
  }
  const resultMatches = (value) => value && value.batch_id === plan.payload.batch_id
    && value.input_digest === plan.inputDigest && value.post_graph_digest === plan.postGraphDigest;
  const service = {
    async read(request) {
      const fresh = await owner(request, 'read');
      const result = await store.readGraph(); fresh();
      if (result.state !== 'committed' || !keys(result.value, ['graph_digest', 'cards'])
        || result.value.graph_digest !== selected.graphDigest || !Array.isArray(result.value.cards)
        || result.value.cards.length > 4096) fail();
      const matches = result.value.cards.filter((row) => row?.body?.stable_id === selected.mapping.proposedStableId);
      if (matches.length !== 1 || !keys(matches[0], ['body', 'body_digest'])) fail();
      const row = matches[0];
      if (row.body_digest !== selected.bodyDigest || row.body.version !== selected.version) fail();
      return validatePrivateCardResponse({ stable_id: row.body.stable_id, version: row.body.version,
        body_digest: row.body_digest, body: row.body, board_revision: selected.mapping.boardRevision,
        source_revision: selected.mapping.sourceRevision }, selected.mapping);
    },
    async apply(request) {
      const fresh = await owner(request, 'apply'); planPins();
      const batch = plan.payload.batch_id;
      // claim must durably occupy batch BEFORE either transaction; no local Map
      // fallback, deletion, automatic retry, or automatic rollback of card data.
      if (await journal.claim(batch, { state: 'seal_pending', payloadDigest: plan.payloadDigest }) !== true) fail();
      const status = async (state) => { await journal.set(batch, { state, payloadDigest: plan.payloadDigest }); return { state }; };
      try {
        fresh(); planPins();
        const seal = await store.seal(clone(plan));
        if (seal.state === 'unknown') return await status('seal_unknown');
        if (seal.state !== 'committed') return await status('seal_rejected');
        if (seal.value !== plan.inputDigest) return await status('seal_unknown');
        await status('sealed'); fresh(); planPins();
        await status('apply_pending');
        fresh(); planPins();
        const applied = await store.apply(clone(plan.payload));
        if (applied.state === 'unknown') return await status('apply_unknown');
        if (applied.state !== 'committed') return await status('apply_rejected');
        if (!resultMatches(applied.value)
          || applied.value.disposition !== 'committed'
          || JSON.stringify(applied.value.changed_ids) !== JSON.stringify([selected.mapping.proposedStableId])) return await status('apply_unknown');
        fresh(); return await status('committed');
      } catch { /* claim persists even if durable journal/readback is unavailable */ fail(); }
    },
    async reconcile(request) {
      const fresh = await owner(request, 'reconcile');
      const occupied = await journal.get(plan.payload.batch_id);
      if (occupied?.payloadDigest !== plan.payloadDigest
        || !['sealed', 'apply_pending', 'apply_unknown'].includes(occupied.state)) fail();
      const result = await store.readBatch(plan.payload.batch_id); fresh();
      if (result.state !== 'committed' || !resultMatches(result.value)
        || result.value.baseline_digest !== plan.baselineDigest
        || JSON.stringify(result.value.changed_ids) !== JSON.stringify([selected.mapping.proposedStableId])) return { state: 'apply_unknown' };
      await journal.set(plan.payload.batch_id, { state: 'committed', payloadDigest: plan.payloadDigest });
      return { state: 'committed' };
    },
  };
  // No upstream Auth, connector, journal or DB exception may reflect a body,
  // subject, password or token through the host-facing service boundary.
  const guarded = (call) => async (request) => { try { return await call(request); } catch { fail(); } };
  return Object.freeze({ read: guarded(service.read), apply: guarded(service.apply), reconcile: guarded(service.reconcile) });
}
