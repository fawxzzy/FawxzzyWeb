import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

export const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export function reject(code) { throw Object.assign(new Error(`OPS_${code}`), { code: `OPS_${code}` }); }
export function fields(value, names) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== names.length || !names.every((n) => Object.hasOwn(value, n))) reject('FIELDS');
}
export const revision = (v) => typeof v === 'string' && v.length === 40 && /^[a-f0-9]+$/u.test(v);
export const digest = (v) => typeof v === 'string' && v.length === 71 && /^sha256:[a-f0-9]+$/u.test(v);
const root = new URL('./platform-runtime/', import.meta.url);
const expectedCommit = 'c60bb451eba9c08f0b3435faadb93ef5da5e0d36';

// The executable and manifest are sealed together by the host's exact-source gate.
// Neither an upstream hash nor this function is execution authority.
export async function loadRuntime() {
  const bytes = await readFile(new URL('provenance.json', root));
  if (hash(bytes) !== 'sha256:31ac781affe279cb64e1e0b880741c0e7ffdc3e2e5adc6e68743e460c18504cb') reject('RUNTIME_PIN');
  const manifest = JSON.parse(bytes);
  if (manifest.commit !== expectedCommit || manifest.numeric_id !== 1304203342) reject('RUNTIME_PIN');
  for (const [path, sha] of Object.entries(manifest.files)) {
    if (!/^(scripts\/lib\/[a-z-]+\.mjs|contracts\/v1\/operations\/source-schemas\/[a-z0-9.-]+\.json)$/u.test(path)
      || hash(await readFile(new URL(path, root))) !== `sha256:${sha}`) reject('RUNTIME_PIN');
  }
  if (Object.keys(manifest.files).length !== 11
    || hash(await readFile(new URL('upstream-package-lock.json', root))) !== `sha256:${manifest.package_lock_sha256}`) reject('RUNTIME_PIN');
  const require = createRequire(import.meta.url);
  for (const [name, version] of Object.entries({ ajv: '8.17.1', 'ajv-formats': '3.0.1', pg: '8.23.1' })) {
    if (require(`${name}/package.json`).version !== version) reject('DEPENDENCY_PIN');
  }
  const [json, contribution, journal, projection] = await Promise.all([
    import('./platform-runtime/scripts/lib/development-operations-json.mjs'),
    import('./platform-runtime/scripts/lib/development-operations-contribution.mjs'),
    import('./platform-runtime/scripts/lib/development-operations-journal.mjs'),
    import('./platform-runtime/scripts/lib/development-operations-projection.mjs'),
  ]);
  return { parse: json.parseCandidateOperationsJson, verify: contribution.verifyCandidateOperationsContribution,
    journal: journal.appendCandidateOperationsJournal, project: projection.rehearseCandidateOperationsProjection };
}
