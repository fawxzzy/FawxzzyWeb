import pg from 'pg';
import { digest, fields, hash, loadRuntime, reject, revision } from './runtime.mjs';

const login = 'platform_ops_policy_login';
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(v);
const nullable = (validate, v) => v === null || validate(v);

// Provisioning and credential custody belong to the canonical host. This
// connector cannot accept admin credentials, URI overrides or PG* defaults.
export function createPolicyTlsConnector(config) {
  fields(config, ['host', 'port', 'database', 'user', 'password', 'ca']);
  if (typeof config.host !== 'string' || !/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(config.host)
    || ![5432, 6543].includes(config.port) || config.database !== 'postgres'
    || config.user !== `${login}.bxtcuhkotumitoqtrcej` || typeof config.password !== 'string'
    || !config.password || typeof config.ca !== 'string' || !config.ca) reject('CONTROL_CONFIG');
  const fixed = { ...config }; // Caller mutation cannot change an admitted target.
  return async () => {
    const client = new pg.Client({ ...fixed, ssl: { rejectUnauthorized: true, ca: fixed.ca },
      connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 20000,
      application_name: 'platform-operations-policy-control' });
    client.on('error', () => {});
    try { await client.connect(); return client; }
    catch { await client.end().catch(() => {}); reject('CONTROL_CONNECT'); }
  };
}

// This supplies transport, not authority. Only the canonical host's validated
// gate may call admit; no public route, policy setter or grant API is provided.
export function createOperationsControl(connect, clock = () => new Date()) {
  if (typeof connect !== 'function' || typeof clock !== 'function') reject('CONTROL_CONNECTOR');
  async function acquire() {
    let client;
    try {
      client = await connect();
      const result = await client.query(`SELECT current_user='platform_ops_policy_login' AND r.rolcanlogin
        AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
        AND pg_has_role(current_user,'platform_ops_policy_admin','MEMBER')
        AND NOT EXISTS(SELECT FROM pg_roles p WHERE p.rolname NOT IN
          ('platform_ops_policy_login','platform_ops_policy_admin')
          AND pg_has_role(current_user,p.oid,'MEMBER')) AS allowed FROM pg_roles r WHERE r.rolname=current_user`);
      if (result.rows.length !== 1 || result.rows[0].allowed !== true) reject('CONTROL_ROLE');
      return client;
    } catch { await client?.end().catch(() => {}); reject('CONTROL_ROLE'); }
  }
  function expiry(value) {
    const now = clock().getTime(); const until = Date.parse(value);
    if (typeof value !== 'string' || !Number.isFinite(now) || !Number.isFinite(until)
      || new Date(until).toISOString() !== value || until <= now || until > now + 900000) reject('CONTROL_EXPIRY');
    return value;
  }
  return Object.freeze({
    async readState() {
      const client = await acquire();
      try {
        const result = await client.query('SELECT platform_private.operations_control_state() AS value');
        if (result.rows.length !== 1) reject('CONTROL_STATE');
        const state = result.rows[0].value;
        fields(state, ['generation', 'revision', 'correlation', 'health', 'registry_revision', 'redaction_revision']);
        if (!Number.isSafeInteger(state.generation) || state.generation < 0 || !nullable(digest, state.revision)
          || !nullable(uuid, state.correlation) || !nullable(revision, state.registry_revision)
          || !nullable(revision, state.redaction_revision)
          || !['healthy', 'stale', 'reconciling', 'unavailable', 'incompatible'].includes(state.health)) reject('CONTROL_STATE');
        return { ...state };
      } catch { reject('CONTROL_STATE'); } finally { await client.end().catch(() => {}); }
    },
    async admit(prepared, expiresAt) {
      fields(prepared, ['rawRequest', 'requestDigest', 'trustDigest', 'correlation', 'expectedGeneration', 'expectedHead',
        'registryRevision', 'redactionRevision', 'health', 'projectionRevision']);
      if (typeof prepared.rawRequest !== 'string' || !prepared.rawRequest || Buffer.byteLength(prepared.rawRequest) > 1048576
        || !digest(prepared.requestDigest) || hash(prepared.rawRequest) !== prepared.requestDigest
        || !digest(prepared.trustDigest) || !uuid(prepared.correlation)
        || !Number.isSafeInteger(prepared.expectedGeneration) || prepared.expectedGeneration < 0
        || !nullable(digest, prepared.expectedHead) || !revision(prepared.registryRevision)
        || !revision(prepared.redactionRevision)) reject('CONTROL_REQUEST');
      expiry(expiresAt);
      // Snapshot before the first await; external mutation cannot change SQL pins.
      const fixed = { ...prepared };
      const runtime = await loadRuntime(); const request = runtime.parse(fixed.rawRequest);
      if (request.correlation !== fixed.correlation || request.registry_revision !== fixed.registryRevision
        || request.redaction_revision !== fixed.redactionRevision) reject('CONTROL_REQUEST');
      const client = await acquire(); let commitSent = false;
      try {
        expiry(expiresAt);
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query('SELECT platform_private.operations_admit($1::uuid,$2::text,$3::text,$4::bigint,$5::text,$6::text,$7::text,$8::timestamptz)',
          [fixed.correlation, fixed.requestDigest, fixed.expectedHead, fixed.expectedGeneration,
            fixed.registryRevision, fixed.redactionRevision, fixed.trustDigest, expiresAt]);
        commitSent = true; await client.query('COMMIT');
        return { status: 'admitted', correlation: fixed.correlation, requestDigest: fixed.requestDigest };
      } catch {
        if (commitSent) return { status: 'unknown', correlation: fixed.correlation, requestDigest: fixed.requestDigest };
        await client.query('ROLLBACK').catch(() => {}); reject('CONTROL_ADMISSION_ABORTED');
      } finally { await client.end().catch(() => {}); }
    },
  });
}
