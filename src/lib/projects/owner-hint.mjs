// A UX-only hint so pages on the main site (fawxzzy.com), which has no Auth session of its
// own, can show the Projects link after the account site verified the owner. The cookie holds
// no identity and grants nothing: the link only opens the account-origin Projects page, where
// the server still verifies the owner and everyone else gets the not-found page. Anyone can set
// the cookie themselves; all that does is show them a link to a page that does not exist for them.
export const OWNER_HINT_COOKIE = 'fawxzzy_owner_hint';
const SHARED_DOMAIN = 'fawxzzy.com';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function readOwnerHint(cookieString) {
  return new RegExp(`(?:^|;\\s*)${OWNER_HINT_COOKIE}=1(?:;|$)`, 'u').test(cookieString ?? '');
}

// Shared across fawxzzy.com and its subdomains in production; host-only on any other host
// (local test origins), where Domain=fawxzzy.com would be rejected by the browser.
export function ownerHintCookie(owner, hostname) {
  const shared = hostname === SHARED_DOMAIN || hostname.endsWith(`.${SHARED_DOMAIN}`);
  const parts = [`${OWNER_HINT_COOKIE}=${owner ? '1' : ''}`, 'Path=/', 'SameSite=Lax'];
  if (shared) parts.push(`Domain=${SHARED_DOMAIN}`, 'Secure');
  parts.push(`Max-Age=${owner ? MAX_AGE_SECONDS : 0}`);
  return parts.join('; ');
}
