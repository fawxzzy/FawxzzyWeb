import { VERCEL_PRODUCTION_CONTRACT } from './vercel-production-contract.mjs';

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/u;

export function assertCanonicalAliasBindings(bindings, deploymentId) {
  if (!DEPLOYMENT_ID.test(deploymentId ?? '')
    || !Array.isArray(bindings?.aliases) || bindings.pagination?.next) {
    throw new Error('Canonical alias readback is incomplete.');
  }
  for (const alias of VERCEL_PRODUCTION_CONTRACT.productionAliases) {
    if (!bindings.aliases.some((binding) => binding.alias === alias
      && binding.deploymentId === deploymentId)) {
      throw new Error(`Canonical alias is not on the exact deployment: ${alias}`);
    }
  }
  return VERCEL_PRODUCTION_CONTRACT.productionAliases;
}

// Recovery is allowed only for the candidate this invocation observed. A
// different production target belongs to another writer and must be held.
export async function recoverFailedProductionRelease({
  candidateDeploymentId,
  rollbackDeploymentId,
  readProject,
  readAliases,
  rollback,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 12,
}) {
  if (!DEPLOYMENT_ID.test(candidateDeploymentId ?? '')
    || !DEPLOYMENT_ID.test(rollbackDeploymentId ?? '')
    || candidateDeploymentId === rollbackDeploymentId
    || !Number.isInteger(attempts) || attempts < 1 || attempts > 12) {
    throw new Error('Exact production recovery identity is unavailable.');
  }
  const current = await readProject();
  if (current.targets?.production?.id !== candidateDeploymentId) {
    throw new Error('Production target drifted before rollback; recovery held.');
  }

  await rollback(rollbackDeploymentId);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await wait(5_000);
    const project = await readProject();
    const target = project.targets?.production?.id;
    if (target !== candidateDeploymentId && target !== rollbackDeploymentId) {
      throw new Error('Production target drifted during rollback; recovery held.');
    }
    if (target !== rollbackDeploymentId) continue;

    assertCanonicalAliasBindings(await readAliases(), rollbackDeploymentId);
    return { status: 'rollback_verified', candidateDeploymentId, rollbackDeploymentId };
  }
  throw new Error('Exact rollback target was not observed before the bounded deadline.');
}
