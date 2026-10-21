#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
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

export function verifyProjectsPublicHtml(html) {
  const document = htmlParser.parse(html);
  const robots = document.querySelector('head > meta[name="robots"]')?.getAttribute('content') ?? '';
  const boards = document.querySelectorAll('.project-tab').map((tab) => ({
    name: tab.querySelector('span')?.text.trim(),
    count: tab.querySelector('strong')?.text.trim(),
  }));
  const expected = ['Fawxzzy Fitness', 'Mazer', 'Fawxzzy Web', 'Atlas Stack'];
  if (!robots.split(',').some((part) => part.trim().toLowerCase() === 'noindex')
    || boards.length !== expected.length
    || boards.some((board, index) => board.name !== expected[index] || board.count !== '0')
    || document.querySelectorAll('.project-card').length !== 0
    || html.includes('FW-ANALYTICS-001') || html.includes('FF-WEB-ANALYTICS-001')) {
    throw new Error('Projects public HTML is not the approved noindex four-board empty view.');
  }
  return { noindex: true, boardCount: boards.length, publicCardCount: 0 };
}


function assertObservationUrl(url, route, origins) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid observed response URL.'); }
  const expected = new URL(route === '/trove' ? '/apps' : route, 'https://fawxzzy.com');
  requireCondition(origins.includes(parsed.origin) && parsed.pathname === expected.pathname
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

function assertRouteGroup(observations, expected, kind) {
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
    const origins = account ? ['https://account.fawxzzy.com']
      : (legal || accountRoutes.includes(route)) ? ['https://fawxzzy.com', 'https://account.fawxzzy.com']
        : ['https://fawxzzy.com'];
    assertObservationUrl(observation.url, route, origins);
    if (account || legal) {
      const canonical = `${legal ? 'https://fawxzzy.com' : 'https://account.fawxzzy.com'}${route.split('?')[0]}`;
      requireCondition(hasExactCanonicalLink(observation.html, canonical), `${kind} canonical HTML is invalid.`);
    }
    if (route === '/projects') verifyProjectsPublicHtml(observation.html);
  });
}

export function verifyProductionRelease(input) {
  assertKeys(input, ['identity', 'observations'], 'pure acceptance input');
  const { identity, observations: o } = input;
  assertReleaseIdentity(identity);
  assertKeys(o, ['project', 'deployment', 'rollbackDeployment', 'aliases', 'smoke', 'account', 'legal',
    'privateApi', 'pendingApi', 'www', 'ranges', 'logs', 'finalProject', 'finalAliases'], 'acceptance observations');
  assertProjectObservation(o.project, identity.candidateDeploymentId);
  assertDeploymentObservation(o.deployment, identity);
  assertDeploymentObservation(o.rollbackDeployment, identity, true);
  assertCanonicalAliasBindings(o.aliases, identity.candidateDeploymentId);
  assertRouteGroup(o.smoke, smokeRoutes, 'public');
  assertRouteGroup(o.account, accountRoutes, 'account');
  assertRouteGroup(o.legal, legalRoutes, 'legal');
  assertKeys(o.privateApi, ['status', 'cacheControl', 'body', 'bodyDigest'], 'signed-out private API');
  requireCondition([403, 503].includes(o.privateApi.status) && typeof o.privateApi.cacheControl === 'string'
    && o.privateApi.cacheControl.split(',').some((token) => token.trim().toLowerCase() === 'no-store')
    && typeof o.privateApi.body === 'string' && Buffer.byteLength(o.privateApi.body) <= 256,
  'Signed-out private card observation did not fail closed.');
  assertBodyDigest(o.privateApi.bodyDigest, o.privateApi.body);
  let error;
  try { error = JSON.parse(o.privateApi.body); } catch { throw new Error('Invalid private denial JSON.'); }
  assertKeys(error, ['error'], 'private denial');
  requireCondition(['CARD_ACCESS_DENIED', 'CARD_UNAVAILABLE'].includes(error.error)
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
