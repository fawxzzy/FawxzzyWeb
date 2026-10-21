import { VERCEL_PRODUCTION_CONTRACT as contract } from './vercel-production-contract.mjs';

export function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertKeys(value, keys, label) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key)), `Invalid closed ${label}.`);
}

export function assertReleaseIdentity(identity) {
  assertKeys(identity, ['repository', 'packetId', 'reservationId', 'attemptId', 'commit', 'tree',
    'teamId', 'projectId', 'productionAliases', 'candidateDeploymentId', 'candidateUrl',
    'rollbackDeploymentId', 'rollbackCommit', 'rollbackTree'], 'release identity');
  requireCondition(Object.entries(identity).every(([key, value]) => key === 'productionAliases' || typeof value === 'string'),
    'Release identity fields must be strings.');
  requireCondition(identity.repository === contract.repository.toLowerCase()
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(identity.packetId)
    && /^rsrv_[0-9a-f]{64}$/u.test(identity.reservationId)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(identity.attemptId)
    && ['commit', 'tree', 'rollbackCommit', 'rollbackTree'].every((key) => /^[0-9a-f]{40}$/u.test(identity[key]))
    && identity.teamId === contract.teamId && identity.projectId === contract.projectId,
  'Release identity does not match the committed destination.');
  requireCondition(Array.isArray(identity.productionAliases)
    && JSON.stringify([...identity.productionAliases].sort()) === JSON.stringify([...contract.productionAliases].sort()),
  'Release aliases do not match the complete committed set.');
  requireCondition([identity.candidateDeploymentId, identity.rollbackDeploymentId]
    .every((id) => /^dpl_[A-Za-z0-9]+$/u.test(id))
    && identity.candidateDeploymentId !== identity.rollbackDeploymentId
    && /^https:\/\/[a-z0-9-]+\.vercel\.app$/u.test(identity.candidateUrl),
  'Exact candidate and rollback identities are required.');
  return identity;
}

export function assertCanonicalAliasBindings(bindings, deploymentId) {
  assertKeys(bindings, ['aliases', 'pagination'], 'alias readback');
  assertKeys(bindings.pagination, ['next'], 'alias pagination');
  requireCondition(/^dpl_[A-Za-z0-9]+$/u.test(deploymentId ?? '')
    && bindings.pagination.next === null && Array.isArray(bindings.aliases)
    && bindings.aliases.length === contract.productionAliases.length, 'Canonical alias readback is incomplete.');
  for (const binding of bindings.aliases) assertKeys(binding, ['alias', 'deploymentId'], 'alias binding');
  requireCondition(JSON.stringify(bindings.aliases.map((binding) => binding.alias).sort())
    === JSON.stringify([...contract.productionAliases].sort())
    && bindings.aliases.every((binding) => binding.deploymentId === deploymentId),
  'Canonical aliases do not identify the exact deployment.');
  return contract.productionAliases;
}

export function assertProjectObservation(project, deploymentId) {
  assertKeys(project, ['id', 'name', 'accountId', 'productionDeploymentId'], 'project observation');
  requireCondition(project.id === contract.projectId && project.name === contract.projectName
    && project.accountId === contract.teamId && project.productionDeploymentId === deploymentId,
  'Project identity or production target drifted.');
}

export function assertDeploymentObservation(deployment, identity, rollback = false) {
  assertKeys(deployment, ['id', 'url', 'projectId', 'teamId', 'target', 'readyState', 'commit', 'tree', 'attemptId'],
    'deployment observation');
  requireCondition(deployment.id === (rollback ? identity.rollbackDeploymentId : identity.candidateDeploymentId)
    && deployment.projectId === identity.projectId && deployment.teamId === identity.teamId
    && deployment.target === 'production' && deployment.readyState === 'READY'
    && deployment.commit === (rollback ? identity.rollbackCommit : identity.commit)
    && deployment.tree === (rollback ? identity.rollbackTree : identity.tree)
    && (rollback ? deployment.attemptId === null : deployment.attemptId === identity.attemptId)
    && /^[a-z0-9-]+\.vercel\.app$/u.test(deployment.url)
    && (rollback || `https://${deployment.url}` === identity.candidateUrl),
  'Deployment observation does not match the exact release identity.');
}

export function validateCandidateObservations(identity, observations) {
  assertReleaseIdentity(identity);
  assertKeys(observations, ['project', 'deployment', 'aliases'], 'candidate observations');
  assertProjectObservation(observations.project, identity.candidateDeploymentId);
  assertDeploymentObservation(observations.deployment, identity);
  assertCanonicalAliasBindings(observations.aliases, identity.candidateDeploymentId);
  return { status: 'candidate_observations_valid', candidateDeploymentId: identity.candidateDeploymentId };
}

export function validateRollbackObservations(identity, observations) {
  assertReleaseIdentity(identity);
  assertKeys(observations, ['project', 'rollbackDeployment', 'aliases'], 'rollback observations');
  assertProjectObservation(observations.project, identity.rollbackDeploymentId);
  assertDeploymentObservation(observations.rollbackDeployment, identity, true);
  assertCanonicalAliasBindings(observations.aliases, identity.rollbackDeploymentId);
  return { status: 'rollback_observations_valid', rollbackDeploymentId: identity.rollbackDeploymentId };
}

// A callback, last target read, flag or JSON value cannot grant a provider capability.
export async function recoverFailedProductionRelease() {
  throw new Error('HOLD_DIRECT_PRODUCTION_RECOVERY_DISABLED: canonical Ops owns every effect.');
}
