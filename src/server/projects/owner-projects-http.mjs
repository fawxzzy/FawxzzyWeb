import { authenticate, fail, MASTER } from '../operations/consumer-auth.mjs';

// Projects is the owner's private view. The static site never contains board
// data: the browser sends its Auth bearer to these two same-origin endpoints and
// only the account owner (server-only OPERATIONS_OWNER_SUBJECT, matched against
// the master-verified Auth subject) receives anything. Every other caller,
// including every other signed-in account, gets the same opaque 403, and any
// configuration or upstream problem fails closed.
const ORIGIN = 'https://account.fawxzzy.com';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const PATHS = Object.freeze({ access: '/api/projects/access', board: '/api/projects/board' });
const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Authorization, Origin, Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest',
};
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: HEADERS });

function guard(request, kind) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' || url.origin !== ORIGIN || url.pathname !== PATHS[kind]
    || url.search || url.hash || url.username || url.password || request.body !== null
    || (origin !== null && origin !== ORIGIN)
    || request.headers.get('sec-fetch-site') !== 'same-origin'
    || !['cors', 'same-origin'].includes(request.headers.get('sec-fetch-mode'))
    || request.headers.get('sec-fetch-dest') !== 'empty'
    || request.headers.get('x-fawxzzy-projects') !== '1') fail('PROJECTS_ACCESS_DENIED');
}

// kind is 'access' ({ owner: true }) or 'board' (the owner's full snapshot).
// Dependency injection is for source tests; request data cannot choose the
// owner, the auth project, or the data served.
export function createOwnerProjectsHandler(kind, dependencies) {
  if (!Object.hasOwn(PATHS, kind)) throw new Error('unknown owner projects endpoint');
  return async (request) => {
    try {
      guard(request, kind);
      const deps = typeof dependencies === 'function' ? dependencies() : dependencies;
      if (!UUID.test(deps.ownerSubject ?? '')) fail('PROJECTS_ACCESS_DENIED');
      const identity = await (deps.authenticate ?? authenticate)(request, deps.auth, deps.authOptions);
      if (identity.subject !== deps.ownerSubject) fail('PROJECTS_ACCESS_DENIED');
      if (!Number.isSafeInteger(identity.expires) || identity.expires <= Math.floor((deps.now ?? Date.now)() / 1000)
        || request.signal.aborted) fail('PROJECTS_ACCESS_DENIED');
      if (kind === 'access') return json(200, { owner: true });
      const board = await deps.loadBoard();
      if (request.signal.aborted) fail('PROJECTS_UNAVAILABLE');
      return json(200, board);
    } catch (error) {
      const denied = error?.code === 'PROJECTS_ACCESS_DENIED' || error?.code === 'OPS_ACCESS_DENIED';
      return json(denied ? 403 : 503, { error: denied ? 'PROJECTS_ACCESS_DENIED' : 'PROJECTS_UNAVAILABLE' });
    }
  };
}

// Server-only configuration. Request data cannot set the owner or the auth project.
export function ownerEnvironmentDependencies(loadBoard) {
  return () => ({
    ownerSubject: process.env.OPERATIONS_OWNER_SUBJECT,
    auth: { url: MASTER, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    loadBoard,
  });
}

export const ownerAccessHandler = createOwnerProjectsHandler('access', ownerEnvironmentDependencies());
