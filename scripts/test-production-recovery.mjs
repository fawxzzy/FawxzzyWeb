import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERCEL_PRODUCTION_CONTRACT as contract } from './vercel-production-contract.mjs';
import { assertCanonicalAliasBindings, recoverFailedProductionRelease,
  validateCandidateObservations, validateRollbackObservations } from './recover-production-release.mjs';
import { verifyProductionRelease, smokeRoutes, accountRoutes, legalRoutes } from './verify-production-release.mjs';
import { canonicalJson, parsePhaseFrame, handlePhaseRequest, PHASE_SCHEMA, MAX_FRAME_BYTES } from './deploy-production.mjs';

const identity = {
  repository: 'fawxzzy/fawxzzyweb', packetId: 'PR92-fixture', reservationId: `rsrv_${'a'.repeat(64)}`,
  attemptId: '47d4ed0c-059b-4b80-825c-8f5ca9cb7c63', commit: 'a'.repeat(40), tree: 'b'.repeat(40),
  teamId: contract.teamId, projectId: contract.projectId, productionAliases: [...contract.productionAliases],
  candidateDeploymentId: 'dpl_Candidate123', candidateUrl: 'https://candidate.vercel.app',
  rollbackDeploymentId: 'dpl_Prior123', rollbackCommit: 'c'.repeat(40), rollbackTree: 'd'.repeat(40),
};
const project = (id) => ({ id: contract.projectId, name: contract.projectName,
  accountId: contract.teamId, productionDeploymentId: id });
const aliases = (id) => ({ aliases: contract.productionAliases.map((alias) => ({ alias, deploymentId: id })),
  pagination: { next: null } });
const deployment = (rollback = false) => ({ id: rollback ? identity.rollbackDeploymentId : identity.candidateDeploymentId,
  url: rollback ? 'prior.vercel.app' : 'candidate.vercel.app', projectId: identity.projectId, teamId: identity.teamId,
  target: 'production', readyState: 'READY', commit: rollback ? identity.rollbackCommit : identity.commit,
  tree: rollback ? identity.rollbackTree : identity.tree, attemptId: rollback ? null : identity.attemptId });
const page = (canonical) => `<html><head>${canonical ? `<link rel="canonical" href="${canonical}">` : ''}<meta name="robots" content="noindex, nofollow"></head><body>${['Fawxzzy Fitness', 'Mazer', 'Fawxzzy Web', 'Atlas Stack'].map((name) => `<button class="project-tab"><span>${name}</span><strong>0</strong></button>`).join('')}</body></html>`;
const digest = (body) => createHash('sha256').update(body, 'utf8').digest('hex');
function routes(list, kind, padding = 0) {
  return list.map((route) => {
    const body = page(kind === 'public' ? null : `${kind === 'account' ? 'https://account.fawxzzy.com' : 'https://fawxzzy.com'}${route.split('?')[0]}`)
      + 'x'.repeat(padding);
    return { route, status: 200,
      url: new URL(route === '/trove' ? '/apps' : route,
        kind === 'account' ? 'https://account.fawxzzy.com' : 'https://fawxzzy.com').href,
      bodyDigest: digest(body), ...(kind !== 'public' || route === '/projects' ? { html: body } : {}) };
  });
}
function acceptance(padding = 0) {
  return { project: project(identity.candidateDeploymentId), deployment: deployment(), rollbackDeployment: deployment(true),
    aliases: aliases(identity.candidateDeploymentId), smoke: routes(smokeRoutes, 'public', padding),
    account: routes(accountRoutes, 'account', padding), legal: routes(legalRoutes, 'legal', padding),
    privateApi: { status: 403, cacheControl: 'private, no-store', body: '{"error":"CARD_ACCESS_DENIED"}', bodyDigest: digest('{"error":"CARD_ACCESS_DENIED"}') },
    pendingApi: [{ case: 'missing_host_only_cookie', status: 404, cacheControl: 'no-store', bodyDigest: digest('') },
      { case: 'wrong_origin', status: 403, cacheControl: 'no-store', bodyDigest: digest('') }],
    www: { status: 308, location: 'https://fawxzzy.com/', bodyDigest: digest('') },
    ranges: ['/apps/fitness/trailer.mp4', '/apps/mazer/trailer.mp4'].map((route) => ({ route, status: 206,
      contentType: 'video/mp4', contentLength: '1024', contentRange: 'bytes 0-1023/99999', bodyDigest: digest('x'.repeat(1024)) })),
    logs: { errors: 0, serverErrors: 0 }, finalProject: project(identity.candidateDeploymentId),
    finalAliases: aliases(identity.candidateDeploymentId) };
}
const candidate = () => ({ project: project(identity.candidateDeploymentId), deployment: deployment(),
  aliases: aliases(identity.candidateDeploymentId) });
const request = (phase = 'validate_acceptance', observations = acceptance()) => ({ schema: PHASE_SCHEMA,
  request_id: 'fixture-1', phase, manifest_sha256: 'e'.repeat(64), identity: structuredClone(identity), observations });
const runAcceptance = (o) => verifyProductionRelease({ identity, observations: o });

// Child guards fail if an entrypoint attempts a provider call or receipt write.
const guard = `import cp from 'node:child_process'; import fs from 'node:fs'; import fsp from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const deny=()=>{throw new Error('UNEXPECTED_EFFECT')};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny;
for(const key of ['writeFileSync','appendFileSync','mkdirSync','renameSync'])fs[key]=deny;
for(const key of ['writeFile','appendFile','mkdir','rename'])fsp[key]=deny;
globalThis.fetch=deny;syncBuiltinESMExports();`;
const guardUrl = `data:text/javascript,${encodeURIComponent(guard)}`;
const scriptPath = (name) => fileURLToPath(new URL(name, import.meta.url));
function child(name, args = [], input) {
  return spawnSync(process.execPath, ['--import', guardUrl, scriptPath(name), ...args],
    { input, encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false });
}

test('all three pure phases accept complete observations without performing effects', () => {
  assert.equal(validateCandidateObservations(identity, candidate()).status, 'candidate_observations_valid');
  assert.equal(runAcceptance(acceptance()).status, 'acceptance_observations_valid');
  assert.equal(validateRollbackObservations(identity, { project: project(identity.rollbackDeploymentId),
    rollbackDeployment: deployment(true), aliases: aliases(identity.rollbackDeploymentId) }).status, 'rollback_observations_valid');
  const realistic = canonicalJson(request('validate_acceptance', acceptance(80 * 1024)));
  assert(Buffer.byteLength(realistic) < MAX_FRAME_BYTES);
  const result = child('deploy-production.mjs', ['--phase-bridge-stdio'], realistic + '\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = parsePhaseFrame(Buffer.from(result.stdout));
  assert.equal(output.status, 'VALID');
  assert.equal(output.result.status, 'acceptance_observations_valid');
  assert.equal(output.manifest_sha256, 'e'.repeat(64));
  assert.equal(output.identity.candidateDeploymentId, identity.candidateDeploymentId);
});

test('identity and every candidate correlation reject foreign data', () => {
  for (const field of ['repository', 'packetId', 'reservationId', 'attemptId', 'commit', 'tree', 'teamId', 'projectId',
    'candidateDeploymentId', 'candidateUrl', 'rollbackDeploymentId', 'rollbackCommit', 'rollbackTree']) {
    assert.throws(() => validateCandidateObservations({ ...identity, [field]: null }, candidate()));
  }
  for (const field of ['id', 'url', 'projectId', 'teamId', 'target', 'readyState', 'commit', 'tree', 'attemptId']) {
    const o = candidate(); o.deployment[field] = 'foreign';
    assert.throws(() => validateCandidateObservations(identity, o));
  }
  assert.throws(() => validateCandidateObservations({ ...identity, attemptId: 1 }, candidate()));
  assert.throws(() => validateCandidateObservations({ ...identity, productionAliases: ['fawxzzy.com'] }, candidate()));
});

test('aliases reject missing, duplicated, unexpected, paginated and mixed-target bindings', () => {
  for (const change of [
    (o) => o.aliases.pop(), (o) => o.aliases.push(o.aliases[0]),
    (o) => { o.aliases[0].alias = 'foreign.example'; }, (o) => { o.pagination.next = 'more'; },
    (o) => { o.aliases[0].deploymentId = identity.rollbackDeploymentId; },
    (o) => { o.aliases[1] = o.aliases[0]; },
  ]) { const o = aliases(identity.candidateDeploymentId); change(o);
    assert.throws(() => assertCanonicalAliasBindings(o, identity.candidateDeploymentId)); }
});

test('complete route sets reject omitted, duplicate, reordered, extra and foreign responses', () => {
  assert.deepEqual([smokeRoutes.length, accountRoutes.length, legalRoutes.length], [16, 8, 4]);
  for (const group of ['smoke', 'account', 'legal']) {
    for (const change of [(o) => o.pop(), (o) => o.push(o[0]), (o) => { o[1] = o[0]; },
      (o) => o.reverse(), (o) => { o[0].status = 302; }, (o) => { o[0].url = 'https://hostile.example/'; },
      (o) => { o[0].extra = true; }]) {
      const o = acceptance(); change(o[group]); assert.throws(() => runAcceptance(o));
    }
  }
});

test('canonical and Projects HTML predicates remain enforced', () => {
  for (const [group, index] of [['account', 0], ['legal', 0]]) {
    const o = acceptance(); o[group][index].html = page('https://hostile.example/');
    assert.throws(() => runAcceptance(o));
  }
  for (const group of ['smoke', 'account']) {
    const o = acceptance(); const entry = o[group].find((item) => item.route === '/projects');
    entry.html = entry.html.replace('noindex', 'index'); assert.throws(() => runAcceptance(o));
  }
});

test('private API, pending denial, redirect, range and log failure each deny acceptance', () => {
  for (const change of [
    (o) => { o.privateApi.status = 200; }, (o) => { o.privateApi.cacheControl = 'public'; },
    (o) => { o.privateApi.body = '{"error":"CARD_ACCESS_DENIED","secret":"data"}'; },
    (o) => { o.privateApi.body = '{"error":"CARD_ACCESS_DENIED","error":"CARD_ACCESS_DENIED"}'; },
    (o) => o.pendingApi.reverse(), (o) => { o.pendingApi[1].status = 200; },
    (o) => { o.www.location = 'https://hostile.example/'; },
    (o) => { o.ranges[0].contentRange = 'bytes 1-1024/99999'; },
    (o) => { o.ranges[0].contentLength = '1023'; }, (o) => o.ranges.reverse(),
    (o) => { o.logs.errors = 1; }, (o) => { o.logs.serverErrors = 1; },
    (o) => { o.finalProject.productionDeploymentId = 'dpl_Foreign'; },
    (o) => { o.finalAliases.aliases[0].deploymentId = 'dpl_Foreign'; },
    (o) => { o.rollbackDeployment.readyState = 'ERROR'; }, (o) => { o.unknown = true; },
  ]) { const o = acceptance(); change(o); assert.throws(() => runAcceptance(o)); }
});

test('rollback is observation-only and legacy callbacks never run', async () => {
  let calls = 0;
  await assert.rejects(recoverFailedProductionRelease({ rollback: () => { calls++; },
    readProject: () => { calls++; } }), /HOLD_DIRECT_PRODUCTION_RECOVERY_DISABLED/u);
  assert.equal(calls, 0);
  assert.throws(() => validateRollbackObservations(identity, { project: project(identity.candidateDeploymentId),
    rollbackDeployment: deployment(true), aliases: aliases(identity.rollbackDeploymentId) }), /drifted/u);
});

test('canonical framing rejects duplicate keys, extra frames, invalid Unicode and oversized input', () => {
  const good = canonicalJson(request());
  for (const bad of [good + '\n{}', good.replace('"phase":', '"phase":"validate_acceptance","phase":'),
    ' ' + good, good.replace('"request_id":"fixture-1"', '"request_id":1')]) {
    assert.throws(() => handlePhaseRequest(parsePhaseFrame(Buffer.from(bad))));
  }
  assert.throws(() => parsePhaseFrame(Buffer.from([0xff])));
  assert.throws(() => parsePhaseFrame(Buffer.alloc(MAX_FRAME_BYTES + 1, 32)));
  assert.throws(() => canonicalJson({ x: '\ud800' }));
  assert.throws(() => canonicalJson({ x: 1.5 }));
  assert.throws(() => handlePhaseRequest({ ...request(), phase: 'deploy' }));
  assert.throws(() => handlePhaseRequest({ ...request(), force: true }));
});

test('legacy deploy, dry-run, verification CLI and forged capabilities deny before effects', () => {
  for (const args of [[], ['--dry-run'], ['--confirm-production', 'fawxzzyweb'],
    ['--canonical', 'true'], ['--phase-bridge-stdio', '--force']]) {
    const result = child('deploy-production.mjs', args);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'HOLD_PHASE_VALIDATION_FAILED\n');
    assert.doesNotMatch(result.stderr, /UNEXPECTED_EFFECT/u);
  }
  const verify = child('verify-production-release.mjs', ['--deployment-id', identity.candidateDeploymentId]);
  assert.equal(verify.status, 1); assert.equal(verify.stdout, '');
  assert.match(verify.stderr, /HOLD_DIRECT_PRODUCTION_VERIFICATION_DISABLED/u);
  assert.doesNotMatch(verify.stderr, /UNEXPECTED_EFFECT/u);
  const invalid = child('deploy-production.mjs', ['--phase-bridge-stdio'], '{"force":true}');
  assert.equal(invalid.status, 1); assert.equal(invalid.stdout, '');
});

test('route digests and exact HTML budgets bind a realistic complete capture projection', () => {
  for (const group of ['smoke', 'account', 'legal']) {
    const htmlIndex = group === 'smoke' ? smokeRoutes.indexOf('/projects') : 0;
    for (const change of [(item) => { delete item.bodyDigest; },
      (item) => { item.bodyDigest = 'SHA256:INVALID'; },
      (item) => { item.bodyDigest = '0'.repeat(64); },
      (item) => { delete item.html; },
      (item) => { item.html += 'changed'; }]) {
      const o = acceptance(); change(o[group][htmlIndex]); assert.throws(() => runAcceptance(o));
    }
    const large = acceptance(); large[group][htmlIndex].html += 'x'.repeat(96 * 1024);
    large[group][htmlIndex].bodyDigest = digest(large[group][htmlIndex].html);
    assert.throws(() => runAcceptance(large));
  }
  const extra = acceptance(); extra.smoke[0].html = '';
  assert.throws(() => runAcceptance(extra));
  for (const missing of [undefined, 'BAD', '']) {
    const o = acceptance(); o.smoke[0].bodyDigest = missing; assert.throws(() => runAcceptance(o));
  }
  const escaped = acceptance(); escaped.account[0].html += '\\'.repeat(60 * 1024);
  escaped.account[0].bodyDigest = digest(escaped.account[0].html);
  assert.throws(() => runAcceptance(escaped));
});

test('BOM and malformed private marker frames fail with static diagnostics and zero effects', () => {
  const valid = Buffer.from(canonicalJson(request()));
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]);
  assert.throws(() => parsePhaseFrame(withBom));
  for (const raw of [withBom, Buffer.from('{"private":PRIVATE42}')]) {
    const r = child('deploy-production.mjs', ['--phase-bridge-stdio'], raw);
    assert.equal(r.status, 1); assert.equal(r.stdout, '');
    assert.equal(r.stderr, 'HOLD_PHASE_VALIDATION_FAILED\n');
    assert.doesNotMatch(r.stderr, /PRIVATE42|private|UNEXPECTED_EFFECT/u);
  }
  assert.throws(() => parsePhaseFrame(Buffer.from('{"private":PRIVATE42}')),
    (error) => error.message === 'Invalid phase JSON encoding.');
});
