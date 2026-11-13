#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readOwnerBoardSnapshot } from '../src/server/projects/owner-board-file.mjs';
import htmlParser from 'next/dist/compiled/node-html-parser/index.js';
import { assertKeys, assertReleaseIdentity, assertProjectObservation, assertDeploymentObservation,
  assertCanonicalAliasBindings, requireCondition } from './recover-production-release.mjs';

export const smokeRoutes = Object.freeze([
  "/",
  "/apps",
  "/apps/fitness",
  "/apps/mazer",
  "/discover",
  "/login",
  "/projects",
  "/account",
  "/auth/callback",
  "/auth/confirm",
  "/reset-password?recovery=1",
  "/trove",
  "/healthz.json",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
]);
export const accountRoutes = Object.freeze([
  "/login",
  "/login?returnTo=%2Fprojects",
  "/projects",
  "/account",
  "/auth/callback",
  "/auth/confirm",
  "/reset-password?recovery=1",
  "/oauth/authorize",
]);
export const legalRoutes = Object.freeze([
  "/privacy",
  "/terms",
  "/legal/mazer/privacy",
  "/legal/mazer/terms",
]);

function hasDuplicateCanonicalAttribute(rawAttributes) {
  const counts = new Map([["href", 0], ["rel", 0]]);
  let cursor = 0;

  while (cursor < rawAttributes.length) {
    while (/\s/.test(rawAttributes[cursor] ?? "")) cursor += 1;
    if (cursor >= rawAttributes.length || rawAttributes[cursor] === "/") break;

    const nameStart = cursor;
    while (cursor < rawAttributes.length && !/[\s=/>]/.test(rawAttributes[cursor])) cursor += 1;
    const name = rawAttributes.slice(nameStart, cursor).toLowerCase();
    if (!name) {
      cursor += 1;
      continue;
    }
    if (counts.has(name)) counts.set(name, counts.get(name) + 1);

    while (/\s/.test(rawAttributes[cursor] ?? "")) cursor += 1;
    if (rawAttributes[cursor] !== "=") continue;
    cursor += 1;
    while (/\s/.test(rawAttributes[cursor] ?? "")) cursor += 1;
    const quote = rawAttributes[cursor];
    if (quote === '"' || quote === "'") {
      cursor += 1;
      while (cursor < rawAttributes.length && rawAttributes[cursor] !== quote) cursor += 1;
      if (rawAttributes[cursor] === quote) cursor += 1;
    } else {
      while (cursor < rawAttributes.length && !/\s/.test(rawAttributes[cursor])) cursor += 1;
    }
  }

  return [...counts.values()].some((count) => count > 1);
}

export function hasExactCanonicalLink(html, expectedCanonical) {
  const document = htmlParser.parse(html);
  const links = document.querySelectorAll("head > link");
  if (links.some((element) => hasDuplicateCanonicalAttribute(element.rawAttrs))) return false;

  const canonicalLinks = links.filter((element) => {
    const rel = element.getAttribute("rel");
    return rel?.split(/[\t\n\f\r ]+/).some((token) => token.toLowerCase() === "canonical");
  });
  return canonicalLinks.length === 1
    && canonicalLinks[0].getAttribute("href") === expectedCanonical;
}

// Projects is the owner's private view: the static /projects page must contain no board data at all.
// The board lives only in the owner-verified /api/projects/board function bundle, built from the
// committed owner snapshot below. The verifier runs from the candidate checkout, so this is the
// candidate tree's snapshot. The `snapshot` option of verifyProductionRelease exists for tests
// only: whatever is used must hash to identity.projectSnapshotDigest or acceptance fails.
export function loadCandidateProjectSnapshot() {
  return readOwnerBoardSnapshot();
}

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// sha256 of the key-sorted JSON of the generated owner snapshot. The release identity carries this
// digest, so the board the function serves is bound to the release rather than to whatever tree
// verifies it.
export function projectSnapshotDigest(snapshot) {
  return createHash('sha256').update(sortedJson(snapshot), 'utf8').digest('hex');
}

// The static Projects HTML is a noindex shell. It must not render any board structure and must not
// contain any card id or title from the snapshot, so a build that leaks the owner board into the
// static site fails acceptance.
export function verifyProjectsPublicHtml(html, expectedDigest, snapshot = loadCandidateProjectSnapshot()) {
  requireCondition(/^[0-9a-f]{64}$/u.test(expectedDigest ?? '') && projectSnapshotDigest(snapshot) === expectedDigest,
    'Project board snapshot does not match the release identity digest.');
  const document = htmlParser.parse(html);
  const robots = document.querySelector('head > meta[name="robots"]')?.getAttribute('content') ?? '';
  const structure = document.querySelectorAll('.project-tab').length + document.querySelectorAll('.project-card').length;
  const leaked = snapshot.boards.flatMap((board) => board.cards)
    .some((card) => html.includes(card.id) || html.includes(card.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;')));
  if (structure !== 0 || leaked || !robots.split(',').some((part) => part.trim().toLowerCase() === 'noindex')) {
    throw new Error('Projects public HTML is not the noindex shell with no board data.');
  }
  return { noindex: true, boardCount: 0, publicCardCount: 0 };
}


// Final response URLs after following the exact committed public redirects.
const publicRedirectResponses = Object.freeze({
  '/': 'https://fawxzzy.com/apps',
  '/apps/fitness': 'https://fitness.fawxzzy.com/',
  '/apps/mazer': 'https://mazer.fawxzzy.com/',
  '/discover': 'https://fawxzzy.com/apps?compatibility=discover',
  '/trove': 'https://fawxzzy.com/apps?compatibility=trove',
});

function assertObservationUrl(url, route, origins, kind) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid observed response URL.'); }
  const redirect = kind === 'public' ? publicRedirectResponses[route] : undefined;
  const expected = new URL(redirect ?? route, 'https://fawxzzy.com');
  requireCondition((redirect ? url === expected.href : origins.includes(parsed.origin))
    && parsed.pathname === expected.pathname
    && parsed.search === expected.search && !parsed.hash && !parsed.username && !parsed.password,
  'Observed response URL is not an admitted route.');
}

export const MAX_HTML_BYTES = 96 * 1024;
export const MAX_HTML_JSON_BYTES = 112 * 1024;

function assertBodyDigest(digest, body) {
  requireCondition(typeof digest === 'string' && /^[0-9a-f]{64}$/u.test(digest),
    'Missing or malformed captured body digest.');
  if (body !== undefined) requireCondition(createHash('sha256').update(body, 'utf8').digest('hex') === digest,
    'Supplied body does not match its captured digest.');
}

function assertRouteGroup(observations, expected, kind, snapshot, snapshotDigest) {
  requireCondition(Array.isArray(observations) && observations.length === expected.length,
    `Incomplete ${kind} route observations.`);
  observations.forEach((observation, index) => {
    const route = expected[index];
    const needsHtml = kind !== 'public' || route === '/projects';
    assertKeys(observation, ['route', 'status', 'url', 'bodyDigest', ...(needsHtml ? ['html'] : [])],
      `${kind} route observation`);
    requireCondition(observation.route === route && observation.status === 200,
      `Invalid or reordered ${kind} route observation.`);
    if (needsHtml) requireCondition(typeof observation.html === 'string'
      && Buffer.byteLength(observation.html) <= MAX_HTML_BYTES
      && Buffer.byteLength(JSON.stringify(observation.html)) <= MAX_HTML_JSON_BYTES,
    'HTML observation exceeds its text or encoded byte budget.');
    assertBodyDigest(observation.bodyDigest, needsHtml ? observation.html : undefined);
    const account = kind === 'account';
    const legal = kind === 'legal';
    // Public Projects is a main-site page: only the apex may serve the public observation.
    const apexProjects = kind === 'public' && route === '/projects';
    const origins = account ? ['https://account.fawxzzy.com']
      : apexProjects ? ['https://fawxzzy.com']
      : (legal || accountRoutes.includes(route)) ? ['https://fawxzzy.com', 'https://account.fawxzzy.com']
        : ['https://fawxzzy.com'];
    assertObservationUrl(observation.url, route, origins, kind);
    if (apexProjects) {
      requireCondition(hasExactCanonicalLink(observation.html, 'https://fawxzzy.com/projects'),
        'Apex Projects canonical HTML is invalid.');
    }
    if (account || legal) {
      // Projects is a main-site page: the account host serves the same page but canonicalizes to the apex.
      const mainSite = legal || route === '/projects';
      const canonical = `${mainSite ? 'https://fawxzzy.com' : 'https://account.fawxzzy.com'}${route.split('?')[0]}`;
      requireCondition(hasExactCanonicalLink(observation.html, canonical), `${kind} canonical HTML is invalid.`);
    }
    if (route === '/projects') verifyProjectsPublicHtml(observation.html, snapshotDigest, snapshot);
  });
}

export function verifyProductionRelease(input, { snapshot = loadCandidateProjectSnapshot() } = {}) {
  assertKeys(input, ['identity', 'observations'], 'pure acceptance input');
  const { identity, observations: o } = input;
  assertReleaseIdentity(identity);
  assertKeys(o, ['project', 'deployment', 'rollbackDeployment', 'aliases', 'smoke', 'account', 'legal',
    'privateApi', 'pendingApi', 'www', 'ranges', 'logs', 'finalProject', 'finalAliases'], 'acceptance observations');
  assertProjectObservation(o.project, identity.candidateDeploymentId);
  assertDeploymentObservation(o.deployment, identity);
  assertDeploymentObservation(o.rollbackDeployment, identity, true);
  assertCanonicalAliasBindings(o.aliases, identity.candidateDeploymentId);
  assertRouteGroup(o.smoke, smokeRoutes, 'public', snapshot, identity.projectSnapshotDigest);
  assertRouteGroup(o.account, accountRoutes, 'account', snapshot, identity.projectSnapshotDigest);
  assertRouteGroup(o.legal, legalRoutes, 'legal', snapshot, identity.projectSnapshotDigest);
  assertKeys(o.privateApi, ['status', 'cacheControl', 'body', 'bodyDigest'], 'signed-out private API');
  requireCondition([403, 503].includes(o.privateApi.status) && typeof o.privateApi.cacheControl === 'string'
    && o.privateApi.cacheControl.split(',').some((token) => token.trim().toLowerCase() === 'no-store')
    && typeof o.privateApi.body === 'string' && Buffer.byteLength(o.privateApi.body) <= 256,
  'Signed-out owner Projects endpoint observation did not fail closed.');
  assertBodyDigest(o.privateApi.bodyDigest, o.privateApi.body);
  let error;
  try { error = JSON.parse(o.privateApi.body); } catch { throw new Error('Invalid private denial JSON.'); }
  assertKeys(error, ['error'], 'private denial');
  requireCondition(['PROJECTS_ACCESS_DENIED', 'PROJECTS_UNAVAILABLE'].includes(error.error)
    && o.privateApi.body === JSON.stringify(error), 'Private denial must be minimal canonical JSON.');
  requireCondition(Array.isArray(o.pendingApi) && o.pendingApi.length === 2, 'Incomplete pending API observations.');
  o.pendingApi.forEach((item, index) => {
    assertKeys(item, ['case', 'status', 'cacheControl', 'bodyDigest'], 'pending API observation');
    assertBodyDigest(item.bodyDigest);
    requireCondition(item.case === ['missing_host_only_cookie', 'wrong_origin'][index]
      && item.status === [404, 403][index] && typeof item.cacheControl === 'string'
      && item.cacheControl.split(',').some((token) => token.trim().toLowerCase() === 'no-store'),
    'Pending API observation is not the exact denied case.');
  });
  assertKeys(o.www, ['status', 'location', 'bodyDigest'], 'www redirect');
  assertBodyDigest(o.www.bodyDigest);
  requireCondition(o.www.status === 308 && o.www.location === 'https://fawxzzy.com/', 'Invalid www redirect.');
  const trailers = ['/apps/fitness/trailer.mp4', '/apps/mazer/trailer.mp4'];
  requireCondition(Array.isArray(o.ranges) && o.ranges.length === trailers.length, 'Incomplete range observations.');
  o.ranges.forEach((item, index) => {
    assertKeys(item, ['route', 'status', 'contentType', 'contentRange', 'contentLength', 'bodyDigest'], 'range observation');
    assertBodyDigest(item.bodyDigest);
    const range = /^bytes 0-1023\/([0-9]+)$/u.exec(item.contentRange ?? '');
    requireCondition(item.route === trailers[index] && item.status === 206 && item.contentType === 'video/mp4'
      && item.contentLength === '1024' && range !== null && Number.isSafeInteger(Number(range[1]))
      && Number(range[1]) >= 1024, 'Invalid or reordered trailer byte range.');
  });
  assertKeys(o.logs, ['errors', 'serverErrors'], 'runtime log counts');
  requireCondition(o.logs.errors === 0 && o.logs.serverErrors === 0, 'Runtime error observations are not empty.');
  assertProjectObservation(o.finalProject, identity.candidateDeploymentId);
  assertCanonicalAliasBindings(o.finalAliases, identity.candidateDeploymentId);
  return { status: 'acceptance_observations_valid', candidateDeploymentId: identity.candidateDeploymentId,
    rollbackDeploymentId: identity.rollbackDeploymentId, publicRoutes: smokeRoutes.length,
    accountRoutes: accountRoutes.length, legalRoutes: legalRoutes.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write('HOLD_DIRECT_PRODUCTION_VERIFICATION_DISABLED\n');
  process.exitCode = 1;
}
