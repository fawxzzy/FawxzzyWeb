import pg from 'pg';
import { digest, fields, hash, reject } from './runtime.mjs';

// This connector accepts structured settings only, avoiding connection-string
// SSL overrides and fallback PG* environment defaults. Provisioning is external.
export function createTlsConnector(config) {
  fields(config, ['host', 'port', 'database', 'user', 'password', 'ca']);
  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(config.host) || ![5432, 6543].includes(config.port)
    || config.database !== 'postgres' || config.user !== 'platform_ops_ingest_login.bxtcuhkotumitoqtrcej'
    || typeof config.password !== 'string' || !config.password || typeof config.ca !== 'string' || !config.ca) reject('DATABASE_CONFIG');
  return async () => {
    const client = new pg.Client({ host: config.host, port: config.port, database: config.database, user: config.user,
      password: config.password, ssl: { rejectUnauthorized: true, ca: config.ca }, connectionTimeoutMillis: 10000,
      statement_timeout: 15000, query_timeout: 20000, application_name: 'platform-operations-ingestor' });
    // Never surface the original connection error (may contain infrastructure).
    client.on('error', () => {});
    try { await client.connect(); return client; } catch { await client.end().catch(() => {}); reject('DATABASE_CONNECT'); }
  };
}

// Injectable client acquisition is for the trusted host and disposable fixtures;
// it is never derived from an HTTP request or source manifest.
export function createOperationsStore(connect) {
  async function client() {
    const c = await connect();
    try {
      const { rows } = await c.query(`SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
        AND pg_has_role(current_user,'platform_ops_ingestor','MEMBER')
        AND NOT EXISTS(SELECT FROM pg_roles p WHERE p.rolname IN
          ('platform_ops_owner','platform_ops_reader','platform_ops_policy_admin','platform_ops_grant_admin','platform_ops_session_issuer')
          AND pg_has_role(current_user,p.oid,'MEMBER')) AS allowed FROM pg_roles r WHERE r.rolname=current_user`);
      if (rows.length !== 1 || rows[0].allowed !== true) reject('DATABASE_ROLE');
      return c;
    } catch { await c.end().catch(() => {}); reject('DATABASE_ROLE'); }
  }
  async function read(sql, params = []) {
    const c = await client();
    try {
      const result = await c.query(sql, params);
      if (result.rows.length !== 1 || !result.rows[0].value) reject('DATABASE_READ');
      return result.rows[0].value;
    } catch { reject('DATABASE_READ'); } finally { await c.end().catch(() => {}); }
  }
  const settle = (correlation, requestDigest) => read('SELECT platform_private.operations_settlement($1::uuid,$2::text) AS value', [correlation, requestDigest]);
  return Object.freeze({
    reconstruction: (generation) => {
      if (!Number.isSafeInteger(generation) || generation < 0) reject('CONTROL_STATE');
      return read('SELECT platform_private.operations_reconstruction($1::bigint) AS value', [generation]);
    },
    settle,
    async execute(prepared) {
      if (hash(prepared.rawRequest) !== prepared.requestDigest || !digest(prepared.requestDigest)) reject('REQUEST_DIGEST');
      const c = await client(); let commitSent = false; let result;
      try {
        await c.query('BEGIN');
        await c.query("SET LOCAL lock_timeout='5s'");
        const response = await c.query('SELECT platform_private.operations_ingest($1::text) AS value', [prepared.rawRequest]);
        result = response.rows[0]?.value;
        if (!result || result.correlation !== prepared.correlation || !['committed', 'quarantined', 'duplicate'].includes(result.outcome)) reject('DATABASE_RESULT');
        commitSent = true; await c.query('COMMIT');
      } catch {
        if (!commitSent) { await c.query('ROLLBACK').catch(() => {}); reject('TRANSACTION_ABORTED'); }
        result = null;
      } finally { await c.end().catch(() => {}); }
      if (result) return { status: 'settled', ...result };
      // COMMIT acknowledgement is uncertain. One exact read; never replay SQL.
      try {
        const found = await settle(prepared.correlation, prepared.requestDigest);
        if (found.correlation === prepared.correlation && ['committed', 'quarantined'].includes(found.outcome)) return { status: 'settled', ...found };
      } catch { /* Unknown remains a first-class terminal state. */ }
      return { status: 'unknown', correlation: prepared.correlation, requestDigest: prepared.requestDigest };
    },
  });
}
