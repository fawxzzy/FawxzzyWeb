// Pure gate for mounting the private project card. The card does its own
// server-side checks (Auth, owner grant, caller-bound cookie, no-store), so it
// does not depend on the legacy work overview being healthy. It is mounted only
// while the owner is signed in and the caller-bound private session is verified
// open; every closed, denied, missing, expired, unknown, loading or signed-out
// state renders no card. The overview's `view` stays null unless healthy.
const OPEN_SESSION_STATUSES = new Set(['healthy', 'stale', 'reconciling', 'incompatible', 'unavailable']);

export function privateCardEligible(state) {
  return Boolean(state) && state.signedIn === true && state.session === 'open'
    && state.pending !== true && state.uncertain !== true && OPEN_SESSION_STATUSES.has(state.status);
}
