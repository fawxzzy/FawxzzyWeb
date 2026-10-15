import pg from 'pg';
import { createRequire } from 'node:module';
import { fail } from './consumer-auth.mjs';

const require = createRequire(import.meta.url);
export const INPUT_LIMIT = 2 * 1024 * 1024;
const roles = {
  reader: { login: 'platform_ops_reader_login', capability: 'platform_ops_reader', functions: ['platform_private.operations_read(text)'] },
  session: { login: 'platform_ops_session_login', capability: 'platform_ops_session_issuer',
    functions: ['platform_private.operations_open_session(text,uuid,uuid,timestamp with time zone)', 'platform_private.operations_close_session(text)'] },
};
const keys = (x, names) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).length === names.length && names.every((k) => Object.hasOwn(x, k));

// An instance-only hook on pinned pg. Installed synchronously before connect's
// startup callback; every data event is bounded before pg-protocol receives it.
export function installProtocolCap(client, limit = INPUT_LIMIT) {
  const connection = client.connection; let installed = false;
  if (!connection || typeof connection.once !== 'function' || typeof connection.stream?.destroy !== 'function') fail('OPS_DATABASE_HOOK');
  connection.once('sslconnect', () => {
    const stream = connection.stream;
    if (installed || !stream || stream.encrypted !== true || typeof stream.emit !== 'function'
      || typeof stream.destroy !== 'function' || stream.listenerCount('data') < 1) {
      connection.stream?.destroy(new Error('OPS_DATABASE_HOOK')); return;
    }
    installed = true; const emit = stream.emit; let total = 0;
    stream.emit = function (event, ...args) {
      if (event === 'data') {
        const bytes = args[0];
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > limit - total) {
          stream.destroy(new Error('OPS_DATABASE_LIMIT')); return false;
        }
        total += bytes.byteLength;
      }
      return Reflect.apply(emit, this, [event, ...args]);
    };
  });
  return () => { if (!installed) fail('OPS_DATABASE_HOOK'); };
}

export function createConsumerConnector(kind, config, Client = pg.Client) {
  const role = roles[kind];
  if (!role || require('pg/package.json').version !== '8.23.1'
    || !keys(config, ['host', 'port', 'database', 'user', 'password', 'ca'])
    || typeof config.host !== 'string' || !/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(config.host)
    || ![5432, 6543].includes(config.port) || config.database !== 'postgres'
    || config.user !== `${role.login}.bxtcuhkotumitoqtrcej`
    || typeof config.password !== 'string' || !config.password || config.password.length > 4096
    || typeof config.ca !== 'string' || !config.ca.includes('-----BEGIN CERTIFICATE-----') || config.ca.length > 32768) fail('OPS_DATABASE_CONFIG');
  return async () => {
    const client = new Client({ host: config.host, port: config.port, database: config.database, user: config.user,
      password: config.password, ssl: { rejectUnauthorized: true, ca: config.ca },
      connectionTimeoutMillis: 3000, statement_timeout: 3000, query_timeout: 4000,
      application_name: `platform-operations-${kind}`, options: '', keepAlive: false });
    client.on('error', () => {});
    try { const check = installProtocolCap(client); await client.connect(); check(); return client; }
    catch { client.connection?.stream?.destroy(); fail('OPS_DATABASE_UNAVAILABLE'); }
  };
}

export const AUDIT_SQL = `SELECT current_user=$1 AND session_user=$1
 AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
 AND pg_has_role(current_user,$2,'MEMBER')
 AND NOT EXISTS (SELECT FROM pg_roles other WHERE other.rolname NOT IN ($1,$2) AND pg_has_role(current_user,other.oid,'MEMBER'))
 AND NOT EXISTS (SELECT FROM unnest($3::text[]) f WHERE to_regprocedure(f) IS NULL OR NOT has_function_privilege(current_user,to_regprocedure(f),'EXECUTE'))
 AND NOT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_'
   AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT p.oid=ANY(ARRAY(SELECT to_regprocedure(f)::oid FROM unnest($3::text[]) f)))
 AND NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_'
   AND ((c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
     OR (c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE'))))
 AS allowed FROM pg_roles r WHERE r.rolname=current_user`;
export const READ_SQL = `WITH result AS MATERIALIZED (SELECT platform_private.operations_read($1::text) AS value)
 SELECT CASE WHEN octet_length(value::text)<=1048576 THEN value ELSE jsonb_build_object('error','OPS_UNAVAILABLE') END AS value FROM result`;
export function createConsumerStore(connectors) {
  async function call(kind, sql, params) {
    const role = roles[kind]; let client;
    try {
      client = await connectors[kind]();
      const audit = await client.query(AUDIT_SQL, [role.login, role.capability, role.functions]);
      if (audit.rows?.length !== 1 || audit.rows[0].allowed !== true) fail('OPS_DATABASE_ROLE');
      const result = await client.query(sql, params);
      if (result.rows?.length !== 1 || !Object.hasOwn(result.rows[0], 'value')) fail('OPS_DATABASE_RESULT');
      return result.rows[0].value;
    } catch { fail('OPS_UNAVAILABLE'); }
    finally { if (client) { client.connection?.stream?.destroy(); await client.end().catch(() => {}); } }
  }
  return Object.freeze({
    read: (digest) => call('reader', READ_SQL, [digest]),
    open: (digest, identity) => call('session', 'SELECT platform_private.operations_open_session($1::text,$2::uuid,$3::uuid,$4::timestamptz) AS value',
      [digest, identity.subject, identity.session, new Date(identity.expires * 1000).toISOString()]),
    close: (digest) => call('session', 'SELECT platform_private.operations_close_session($1::text) AS value', [digest]),
  });
}
