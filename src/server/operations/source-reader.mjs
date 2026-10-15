import { createHash } from 'node:crypto';
import { digest, fields, hash, loadRuntime, reject, revision } from './runtime.mjs';

const producer = 'github-repository:1301080630';
const repositories = Object.freeze({
  source: { id: 1301080630, name: 'fawxzzy/socials-os', path: 'operations/export/manifest.v1.json' },
});
const maxBytes = 262144;
function pin(p, policy) {
  if (policy) {
    fields(p, ['kind', 'sha256', 'registryRevision', 'redactionRevision', 'approvalReceiptSha256']);
    if (p.kind !== 'host-private-v1' || !digest(p.sha256) || !revision(p.registryRevision)
      || !revision(p.redactionRevision) || !digest(p.approvalReceiptSha256)) reject('POLICY_PIN');
    return;
  }
  fields(p, ['commit', 'sourceRevision', 'sha256', 'admittedRevisions']);
  if (!revision(p.commit) || !revision(p.sourceRevision) || !digest(p.sha256)
    || !Array.isArray(p.admittedRevisions) || p.admittedRevisions.length < 1 || p.admittedRevisions.length > 256
    || new Set(p.admittedRevisions).size !== p.admittedRevisions.length || !p.admittedRevisions.every(revision)
    || !p.admittedRevisions.includes(p.sourceRevision)) reject('SOURCE_PIN');
}
async function boundedBody(response, budget) {
  if (!response.body) reject('SOURCE_RESPONSE');
  const chunks = []; let total = 0; const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await budget.wait(reader.read());
      if (done) break;
      total += value.length;
      if (total > 786432) reject('SOURCE_RESPONSE_SIZE');
      chunks.push(value);
    }
  } finally {
    // Cancellation may itself be implemented by a stalled remote stream. Do
    // not let its acknowledgement extend the whole-read deadline.
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/** Trusted host inputs only. Pins select bytes; they do not grant admission. */
export async function readTrustedSources(options) {
  const timeoutMs = options.timeoutMs ?? 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) reject('SOURCE_BUDGET');
  const start = performance.now(); const controller = new AbortController(); let requests = 0;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const budget = {
    signal: controller.signal,
    check() {
      if (performance.now() - start >= timeoutMs) controller.abort();
      if (controller.signal.aborted) reject('SOURCE_DEADLINE');
    },
    request() { this.check(); requests += 1; if (requests > 600) reject('SOURCE_REQUEST_LIMIT'); },
    async wait(promise) {
      // Observe even a promise created just before the deadline check. A late
      // rejection after timeout must not become an unhandled process error.
      promise = Promise.resolve(promise); void promise.catch(() => {});
      this.check(); let onAbort;
      try {
        return await Promise.race([promise, new Promise((_, fail) => {
          onAbort = () => fail(Object.assign(new Error('OPS_SOURCE_DEADLINE'), { code: 'OPS_SOURCE_DEADLINE' }));
          controller.signal.addEventListener('abort', onAbort, { once: true });
        })]);
      } finally { controller.signal.removeEventListener('abort', onAbort); this.check(); }
    },
  };
  try { return await readWithinBudget(options, budget); }
  finally { clearTimeout(timer); controller.abort(); }
}

async function readWithinBudget({ pins, readPolicy, tokenForRepository, fetcher = fetch, clock = () => new Date() }, budget) {
  fields(pins, ['source', 'policy']); pin(pins.source, false); pin(pins.policy, true);
  const runtime = await budget.wait(loadRuntime());
  if (typeof readPolicy !== 'function') reject('PRIVATE_POLICY_REQUIRED');
  let policyBytes;
  try {
    // Only the canonical host supplies this callback, after validating native
    // independent approval, ownership, scope, private custody and exact hashes.
    // A returned digest is a binding check here, never proof of that approval.
    const held = await budget.wait(readPolicy({ pins: Object.freeze({ ...pins.policy }), signal: budget.signal }));
    fields(held, ['bytes', 'approvalReceiptSha256']);
    if (!(held.bytes instanceof Uint8Array) || held.bytes.byteLength < 1 || held.bytes.byteLength > maxBytes
      || held.approvalReceiptSha256 !== pins.policy.approvalReceiptSha256) reject('PRIVATE_POLICY_BINDING');
    policyBytes = Buffer.from(held.bytes); // Own immutable input bytes before parsing.
    if (hash(policyBytes) !== pins.policy.sha256) reject('PRIVATE_POLICY_BINDING');
  } catch { budget.check(); reject('PRIVATE_POLICY'); }
  const policy = runtime.parse(policyBytes);
  fields(policy, ['schema', 'registry_revision', 'redaction_revision', 'mapping_version', 'max_observation_age_seconds', 'redactions']);
  if (policy.schema !== 'platform.operations-redaction.v1' || policy.registry_revision !== pins.policy.registryRevision
    || policy.redaction_revision !== pins.policy.redactionRevision || policy.mapping_version !== 'socials-card-snapshot:v1'
    || !Number.isInteger(policy.max_observation_age_seconds) || policy.max_observation_age_seconds < 1
    || policy.max_observation_age_seconds > 86400 || !Array.isArray(policy.redactions) || policy.redactions.length > 256) reject('REDACTION_POLICY');
  async function repository(kind) {
    const fixed = repositories[kind]; const selected = pins[kind];
    budget.check();
    const token = await budget.wait(tokenForRepository(fixed.id, { signal: budget.signal }));
    if (typeof token !== 'string' || token.length < 1 || /[\r\n]/u.test(token)) reject('SOURCE_ACCESS');
    async function get(path) {
      let response;
      try {
        budget.request();
        response = await budget.wait(fetcher(`https://api.github.com/repos/${fixed.name}${path}`, {
          redirect: 'error', signal: AbortSignal.any([budget.signal, AbortSignal.timeout(15000)]),
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
        }));
        if (response.status !== 200 || response.redirected) reject('SOURCE_RESPONSE');
        const parsed = runtime.parse(await boundedBody(response, budget)); budget.check(); return parsed;
      } catch { budget.check(); reject('SOURCE_TRANSPORT'); }
    }
    const meta = await get('');
    if (meta.id !== fixed.id || meta.full_name !== fixed.name || meta.default_branch !== 'main' || meta.private !== true) reject('REPOSITORY_IDENTITY');
    const branch = await get('/branches/main'); const tip = branch.commit?.sha;
    if (!revision(tip)) reject('BRANCH_IDENTITY');
    async function ancestor(base, head) {
      if (base === head) return;
      const compare = await get(`/compare/${base}...${head}`);
      if (!['ahead', 'identical'].includes(compare.status) || compare.base_commit?.sha !== base
        || compare.merge_base_commit?.sha !== base) reject('SOURCE_LINEAGE');
    }
    await ancestor(selected.commit, tip);
    await ancestor(selected.sourceRevision, selected.commit);
    if (kind === 'source') for (const prior of selected.admittedRevisions) await ancestor(prior, selected.commit);
    const commit = await get(`/git/commits/${selected.commit}`);
    if (commit.sha !== selected.commit || !revision(commit.tree?.sha)) reject('COMMIT_IDENTITY');
    const trees = new Map();
    async function file(path, expectedHash, expectedBlob) {
      if (typeof path !== 'string' || path.length > 180 || !/^operations\/export\/[A-Za-z0-9_./-]+\.json$/u.test(path)
        || path.split('/').some((part) => !part || part === '.' || part === '..')) reject('SOURCE_PATH');
      let treeSha = commit.tree.sha; const parts = path.split('/');
      for (let i = 0; i < parts.length; i += 1) {
        if (!trees.has(treeSha)) trees.set(treeSha, await get(`/git/trees/${treeSha}`));
        const tree = trees.get(treeSha);
        if (tree.sha !== treeSha || tree.truncated !== false || !Array.isArray(tree.tree)) reject('TREE_IDENTITY');
        const entries = tree.tree.filter((entry) => entry.path === parts[i]);
        if (entries.length !== 1) reject('SOURCE_MISSING');
        const entry = entries[0]; if (!revision(entry.sha)) reject('BLOB_IDENTITY');
        if (i < parts.length - 1) {
          if (entry.type !== 'tree' || entry.mode !== '040000') reject('SOURCE_TYPE');
          treeSha = entry.sha; continue;
        }
        if (entry.type !== 'blob' || entry.mode !== '100644' || !Number.isInteger(entry.size)
          || entry.size < 1 || entry.size > maxBytes || (expectedBlob && entry.sha !== expectedBlob)) reject('SOURCE_TYPE');
        const blob = await get(`/git/blobs/${entry.sha}`);
        if (blob.sha !== entry.sha || blob.encoding !== 'base64' || blob.size !== entry.size || typeof blob.content !== 'string') reject('BLOB_IDENTITY');
        const b64 = blob.content.replace(/\n/gu, '');
        const bytes = Buffer.from(b64, 'base64');
        if (bytes.toString('base64') !== b64 || bytes.length !== entry.size || hash(bytes) !== expectedHash
          || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.sha) reject('BLOB_DIGEST');
        return { value: runtime.parse(bytes), bytes, blob: entry.sha };
      }
      reject('SOURCE_MISSING');
    }
    return { file, selected, fixed };
  }
  // Producer transport cannot provide or override independently held policy.
  const source = await repository('source');
  const manifestFile = await source.file(source.fixed.path, pins.source.sha256);
  const manifest = manifestFile.value;
  fields(manifest, ['schema', 'producer_identity', 'source_revision', 'complete', 'files', 'associations']);
  if (manifest.schema !== 'platform.operations-source-manifest.v1' || manifest.producer_identity !== producer
    || manifest.source_revision !== pins.source.sourceRevision || manifest.complete !== true
    || !Array.isArray(manifest.files) || manifest.files.length > 256 || !Array.isArray(manifest.associations)
    || manifest.associations.length > 256) reject('MANIFEST');
  const paths = new Set(); const events = []; const snapshots = []; let size = 0;
  for (const entry of manifest.files) {
    fields(entry, ['path', 'kind', 'blob', 'sha256', 'digest']);
    if (!/^operations\/export\/(events|snapshots)\/[A-Za-z0-9_-]+\.json$/u.test(entry.path)
      || paths.has(entry.path) || !['event', 'snapshot'].includes(entry.kind) || !revision(entry.blob)
      || !digest(entry.sha256) || !digest(entry.digest)) reject('MANIFEST_FILE');
    paths.add(entry.path);
    const file = await source.file(entry.path, entry.sha256, entry.blob); size += file.bytes.length;
    if (size > 786432) reject('SOURCE_TOTAL_SIZE');
    const envelope = file.value;
    if (envelope.producer_identity !== producer || envelope.source_revision !== pins.source.sourceRevision
      || envelope.mapping_version !== policy.mapping_version) reject('PRODUCER_BINDING');
    const proof = { digest: entry.digest };
    runtime.verify(JSON.stringify(envelope), JSON.stringify(proof));
    if (entry.kind === 'snapshot' ? envelope.schema_identity !== 'socials-os.development-card.v1.schema.json'
      : !/^socials-os\.development-event\.v[12]\.schema\.json$/u.test(envelope.schema_identity)) reject('SOURCE_SCHEMA');
    (entry.kind === 'event' ? events : snapshots).push({ envelope, detached_source_proof: proof, body: file.bytes.toString('utf8') });
  }
  for (const a of manifest.associations) {
    fields(a, ['producer_identity', 'event_id', 'event_digest', 'snapshot_digest']);
    if (a.producer_identity !== producer) reject('PRODUCER_BINDING');
  }
  budget.check(); const observedAt = clock().toISOString();
  const trust = { pins, observed_at: observedAt, manifest_blob: manifestFile.blob,
    policy: { custody: 'host-private-v1', sha256: pins.policy.sha256, approval_receipt_sha256: pins.policy.approvalReceiptSha256,
      registry_revision: policy.registry_revision, redaction_revision: policy.redaction_revision },
    files: manifest.files.map(({ path, blob, sha256 }) => ({ path, blob, sha256 })) };
  return { events, snapshots, associations: manifest.associations, policy, observedAt,
    producer: { producer_identity: producer, source_revision: pins.source.sourceRevision,
      admitted_revisions: [...pins.source.admittedRevisions], observed_at: observedAt,
      max_observation_age_seconds: policy.max_observation_age_seconds, complete: true }, trust, trustDigest: hash(JSON.stringify(trust)) };
}
