import pg from 'pg';

// Server-only source contract. These logins are NOT provisioned by this module.
// Host credential custody, catalog/grant attestation and runtime admission are
// separate prerequisites. Never import this module from client code.
const PROJECT = 'bxtcuhkotumitoqtrcej';
const ROLES = Object.freeze({ sealer: 'platform_card_sealer', writer: 'platform_card_writer', reader: 'platform_card_reader' });
export const CARD_SQL = Object.freeze({
  seal: 'SELECT platform_private.private_card_seal($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::timestamptz) AS value',
  apply: 'SELECT platform_private.private_card_apply($1::jsonb) AS value',
  readBatch: 'SELECT platform_private.private_card_read_batch($1::text) AS value',
  readGraph: `SELECT jsonb_build_object('graph_digest','sha256:'||encode(sha256(convert_to(g::text,'UTF8')),'hex'),
    'cards',COALESCE((SELECT jsonb_agg(jsonb_build_object('body',b,'body_digest',
      'sha256:'||encode(sha256(convert_to(b::text,'UTF8')),'hex'))) FROM jsonb_array_elements(g) b),'[]'::jsonb)) AS value
    FROM (SELECT platform_private.private_card_read_graph() AS g) card_graph`,
});
const SESSION_SQL = `SELECT session_user AS session_user,current_user AS current_user,
  NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
  AND r.rolcanlogin AND pg_has_role(current_user,$1,'MEMBER')
  AND NOT EXISTS(SELECT FROM pg_roles p WHERE p.rolname NOT IN (current_user,$1)
    AND pg_has_role(current_user,p.oid,'MEMBER')) AS allowed
  FROM pg_roles r WHERE r.rolname=current_user`;
const denied = () => { throw new Error('CARD_TRANSPORT_UNAVAILABLE'); };
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every((n) => Object.hasOwn(v, n));
const bounded = (v) => { if (Buffer.byteLength(JSON.stringify(v) ?? '') > 2 * 1024 * 1024) denied(); return v; };

export function createPrivateCardTlsConnector(kind, config) {
  if (!Object.hasOwn(ROLES, kind) || !keys(config, ['host', 'port', 'database', 'user', 'password', 'ca'])
    || typeof config.host !== 'string' || !/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(config.host)
    || ![5432, 6543].includes(config.port) || config.database !== 'postgres'
    || config.user !== `${ROLES[kind]}_login.${PROJECT}`
    || typeof config.password !== 'string' || !config.password || typeof config.ca !== 'string' || !config.ca) denied();
  const fixed = { ...config };
  return async () => {
    const client = new pg.Client({ host: fixed.host, port: fixed.port, database: fixed.database,
      user: fixed.user, password: fixed.password, ssl: { rejectUnauthorized: true, ca: fixed.ca },
      options: '-c search_path=pg_catalog',
      connectionTimeoutMillis: 3000, statement_timeout: 3000, query_timeout: 4000,
      application_name: `private-card-${kind}` });
    client.on('error', () => {});
    try { await client.connect(); return client; }
    catch { await client.end().catch(() => {}); denied(); }
  };
}

export function createPrivateCardRoleStore(connectors) {
  if (!keys(connectors, ['sealer', 'writer', 'reader'])
    || Object.values(connectors).some((c) => typeof c !== 'function')) denied();
  const fixed = { ...connectors };
  async function run(kind, sql, values, write) {
    let client; let began = false; let sent = false; let committing = false;
    try {
      client = await fixed[kind]();
      const check = await client.query(SESSION_SQL, [ROLES[kind]]);
      const login = `${ROLES[kind]}_login`;
      if (check.rows?.length !== 1 || check.rows[0].session_user !== login
        || check.rows[0].current_user !== login || check.rows[0].allowed !== true) denied();
      await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY'); began = true;
      sent = true;
      const result = await client.query(sql, values);
      if (result.rows?.length !== 1 || !Object.hasOwn(result.rows[0], 'value')) denied();
      const value = bounded(result.rows[0].value);
      committing = true; await client.query('COMMIT'); began = false;
      return { state: 'committed', value };
    } catch {
      let rolledBack = false;
      if (began && !committing) {
        try { await client.query('ROLLBACK'); rolledBack = true; } catch { /* unknown stays occupied */ }
      }
      return { state: write && (committing || (sent && !rolledBack)) ? 'unknown' : 'rejected' };
    } finally { await client?.end().catch(() => {}); }
  }
  return Object.freeze({
    seal: (p) => run('sealer', CARD_SQL.seal,
      [p.payload, p.baselineDigest, p.postGraphDigest, p.sourceRevision, p.trustReceipt, p.expiresAt], true),
    apply: (payload) => run('writer', CARD_SQL.apply, [payload], true),
    readBatch: (batch) => run('writer', CARD_SQL.readBatch, [batch], false),
    readGraph: () => run('reader', CARD_SQL.readGraph, [], false),
  });
}
