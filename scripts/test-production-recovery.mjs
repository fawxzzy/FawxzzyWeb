import assert from 'node:assert/strict';
import test from 'node:test';
import { VERCEL_PRODUCTION_CONTRACT } from './vercel-production-contract.mjs';
import { assertCanonicalAliasBindings, recoverFailedProductionRelease } from './recover-production-release.mjs';

const candidate = 'dpl_Candidate123';
const prior = 'dpl_Prior123';
const project = (id) => ({ targets: { production: { id } } });
const aliases = (id) => ({ aliases: VERCEL_PRODUCTION_CONTRACT.productionAliases.map((alias) => ({
  alias, deploymentId: id,
})), pagination: { next: null } });

test('exact alias preimage rejects missing, paginated, or foreign bindings', () => {
  assert.equal(assertCanonicalAliasBindings(aliases(prior), prior).length, 3);
  assert.throws(() => assertCanonicalAliasBindings(aliases(candidate), prior), /Canonical alias/u);
  assert.throws(() => assertCanonicalAliasBindings({ ...aliases(prior), pagination: { next: 'more' } }, prior), /incomplete/u);
  assert.throws(() => assertCanonicalAliasBindings({ aliases: aliases(prior).aliases.slice(1) }, prior), /Canonical alias/u);
});

test('failed acceptance restores only the captured candidate and verifies every canonical alias', async () => {
  const observations = [candidate, candidate, prior];
  const rolledBack = [];
  const result = await recoverFailedProductionRelease({
    candidateDeploymentId: candidate, rollbackDeploymentId: prior,
    readProject: () => project(observations.shift()),
    readAliases: () => aliases(prior),
    rollback: (id) => { rolledBack.push(id); },
    wait: async () => {},
  });
  assert.deepEqual(rolledBack, [prior]);
  assert.deepEqual(result, { status: 'rollback_verified', candidateDeploymentId: candidate,
    rollbackDeploymentId: prior });
});

test('another production writer prevents rollback', async () => {
  let rollbackCalls = 0;
  await assert.rejects(recoverFailedProductionRelease({
    candidateDeploymentId: candidate, rollbackDeploymentId: prior,
    readProject: () => project('dpl_AnotherWriter'),
    readAliases: () => aliases(prior),
    rollback: () => { rollbackCalls++; },
  }), /drifted before rollback/u);
  assert.equal(rollbackCalls, 0);
});

test('a target change during recovery fails closed', async () => {
  const observations = [candidate, 'dpl_AnotherWriter'];
  await assert.rejects(recoverFailedProductionRelease({
    candidateDeploymentId: candidate, rollbackDeploymentId: prior,
    readProject: () => project(observations.shift()),
    readAliases: () => aliases(prior), rollback: () => {},
  }), /drifted during rollback/u);
});

test('rollback requires complete alias readback and all aliases restored', async () => {
  for (const readAliases of [
    () => ({ ...aliases(prior), pagination: { next: 'more' } }),
    () => ({ aliases: aliases(prior).aliases.slice(1), pagination: { next: null } }),
    () => aliases(candidate),
  ]) {
    await assert.rejects(recoverFailedProductionRelease({
      candidateDeploymentId: candidate, rollbackDeploymentId: prior,
      readProject: (() => { const observations = [candidate, prior];
        return () => project(observations.shift()); })(),
      readAliases, rollback: () => {},
    }), /alias/u);
  }
});

test('bounded rollback observation never retries the effect', async () => {
  let rollbackCalls = 0;
  await assert.rejects(recoverFailedProductionRelease({
    candidateDeploymentId: candidate, rollbackDeploymentId: prior,
    readProject: () => project(candidate), readAliases: () => aliases(prior),
    rollback: () => { rollbackCalls++; }, wait: async () => {}, attempts: 2,
  }), /bounded deadline/u);
  assert.equal(rollbackCalls, 1);
});
