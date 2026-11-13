import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_HINT_COOKIE, ownerHintCookie, readOwnerHint } from '../src/lib/projects/owner-hint.mjs';

test('the hint reads only the exact cookie value 1, anywhere in the cookie string', () => {
  assert.equal(readOwnerHint(`${OWNER_HINT_COOKIE}=1`), true);
  assert.equal(readOwnerHint(`a=b; ${OWNER_HINT_COOKIE}=1; c=d`), true);
  for (const value of [undefined, null, '', `${OWNER_HINT_COOKIE}=`, `${OWNER_HINT_COOKIE}=0`, `${OWNER_HINT_COOKIE}=11`, `x${OWNER_HINT_COOKIE}=1`, `a=${OWNER_HINT_COOKIE}=1`]) {
    assert.equal(readOwnerHint(value), false, String(value));
  }
});

test('the hint cookie is shared across fawxzzy.com in production and host-only elsewhere, and carries no identity', () => {
  for (const host of ['account.fawxzzy.com', 'fawxzzy.com', 'www.fawxzzy.com']) {
    const set = ownerHintCookie(true, host);
    assert.match(set, /Domain=fawxzzy\.com/u);
    assert.match(set, /Secure/u);
    assert.match(set, /SameSite=Lax/u);
    assert.match(set, /Max-Age=2592000/u);
    assert.equal(set.startsWith(`${OWNER_HINT_COOKIE}=1;`), true);
    const cleared = ownerHintCookie(false, host);
    assert.match(cleared, /Max-Age=0/u);
    assert.equal(cleared.startsWith(`${OWNER_HINT_COOKIE}=;`), true);
  }
  for (const host of ['127.0.0.1', 'localhost', 'evilfawxzzy.com', 'fawxzzy.com.evil.example']) {
    assert.doesNotMatch(ownerHintCookie(true, host), /Domain=|Secure/u, host);
  }
  assert.doesNotMatch(ownerHintCookie(true, 'account.fawxzzy.com'), /HttpOnly/u, 'readable by the main-site script on purpose');
});
