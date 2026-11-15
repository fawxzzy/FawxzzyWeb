# Mazer OAuth: first-party approval threat model

Scope: `/oauth/authorize` on the account host approving the Mazer client without a consent card,
and device-level auto sign-in (an existing portal session authorizes silently). Contract wording
lives in `docs/auth-surface-family.md`; provider failure logging in
`docs/mazer-oauth-provider-diagnostics.md`.

## What changed

- The registered first-party client (Mazer) is approved with no consent card. There is no
  third-party consent path: a client, redirect URI or scope that is not Mazer's exact registration
  is rejected on the portal fallback screen, with no approval call and no redirect.
- An invalid, expired or other-account request goes back to Mazer's sign-in at the constant
  `https://mazer.fawxzzy.com/?notice=expired`; an account-service failure goes to
  `?notice=unavailable`. The fallback screen is kept only for unsafe requests.
- A portal session already on the device is reused, so a second app needs no extra sign-in.

## Threats and controls

| Threat | Control | Where |
| --- | --- | --- |
| Another client gets silent approval | Exact client id (configured `NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID`; the local id only on local test origins), exact redirect URI `https://mazer.fawxzzy.com/`, scope `email`, name empty or `Mazer`; no name, prefix or pattern matching | `shouldAutoApproveMazerOAuth`, `isExpectedMazerOAuthAuthorization` (`src/lib/auth/mazer-oauth.ts`) |
| Code delivered to an attacker origin | Every provider redirect must be the exact Mazer origin, path `/`, no userinfo or fragment, exactly `code`+`state` (or the fixed denial keys), one 43-char URL-safe state, bounded size. Checked by the gateway (502 and carrier cleared) and again in the browser | `sanitizeMazerOAuthApprovalRedirect` / `...DenialRedirect`; `api/account/mazer-oauth-pending.ts` |
| Open redirect through the authorize URL | The page reads only `authorization_id`; `redirect_uri`, `returnTo`, `next`, `client_id` and other parameters are never used. Stopped requests go to a constant URL with a closed notice key | `mazerSignInNoticeUrl`; `mazer-oauth-authorization.tsx` |
| Login CSRF / forced silent authorization (any site can navigate a signed-in victim to the authorize URL) | The code can only land on Mazer's exact origin in the victim's own browser. Mazer rejects a callback whose `state` does not match its own pending sign-in in `sessionStorage`, and the code is useless without the PKCE verifier held by the client that started the flow | Redirect allowlist above; Mazer `legacyAccountPortal.ts` state check; Supabase PKCE |
| PKCE downgrade or missing PKCE | The portal never sees the code challenge: Supabase's authorization server stores it and checks the verifier at the token endpoint. Mazer sends `code_challenge_method=S256` with a 32-byte random verifier | Mazer `buildMazerOAuthAuthorizationUrl`; Supabase Auth OAuth server |
| Silent authorize in a hidden frame / clickjacking | `X-Frame-Options: DENY` on every route | `vercel.json` |
| Handle leakage | The authorization id leaves the address bar at once and is kept only in a `__Host-` Secure, HttpOnly, SameSite=Lax cookie for at most 15 minutes; page script and storage never receive it | `api/account/mazer-oauth-pending.ts` |
| Cross-site writes to the gateway | POST/PATCH/PUT/DELETE require an exact same-origin `Origin`; reads and decisions also need the bearer token and the device auth generation | `api/account/mazer-oauth-pending.ts` |
| Session swap mid-flight | Auth generation and session user are re-read before reading and before deciding; a change sends the player back to Mazer's sign-in | `mazer-oauth-authorization.tsx` |
| Redirect loop | No automatic retry on the portal; Mazer's own auto-handoff guard keeps the player on Mazer's screen for an attempt started within 15 minutes | portal component; Mazer client |

The gateway answers every provider or redirect-contract failure with the same empty `502`, so in
production a hostile provider redirect reaches the browser as a service failure and the player goes
back with `notice=unavailable`. The browser's own redirect check (fallback screen) is the second
layer, exercised in tests with a mocked gateway.

## Verified (this change)

- Unit (Playwright, no browser): the allowlist is exact and lookalikes fail
  (`tests/e2e/mazer-oauth-first-party-auto-approve.spec.ts`); the notice URL is the constant
  origin with one closed key and can never pass as a callback; state handling rejects a missing,
  empty, short, long, non-URL-safe or duplicated state, duplicate codes, extra keys, fragments,
  userinfo, other schemes, ports and hosts (`tests/e2e/mazer-oauth-first-party-security.spec.ts`).
- Page (chromium and mobile-webkit, local test adapter, mocked gateway): silent authorize with an
  existing session never visits sign-in or shows a card; unregistered client, third-party client
  named Mazer, redirect URI mismatch (path, lookalike host, scheme, missing slash) and wider scope
  are rejected with no approval call and no redirect; expired (404) and other-account requests go
  back with `notice=expired`; service failure with `notice=unavailable`; raw OAuth parameters
  (client, redirect, `code_challenge_method=plain`, state) without a provider request store nothing
  and approve nothing; open-redirect parameters next to a valid request are ignored; an approval or
  already-approved redirect to another origin, or with missing, duplicated or extra state keys, is
  not followed.
- Live response headers of `https://account.fawxzzy.com/oauth/authorize` (read on 2026-11-15):
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.

## Not verified

- Supabase's server-side PKCE enforcement (rejecting a missing or `plain` challenge, or a wrong
  verifier) and its own redirect-URI matching: no live provider calls were made. Source evidence
  only: Mazer sends S256.
- Mazer stripping `code` and `state` from its address bar after the callback, and Mazer reading
  `notice` (it ignores the key today and shows its sign-in with no reason line).
- The gateway does not repeat the first-party client check; the browser does. An attacker able to
  call PUT already holds the user's session token and generation.
- Real devices. iOS home-screen web apps each have their own storage, so a portal session from
  Safari or another installed app is not shared: each installed app needs one first sign-in on that
  device. Device-level auto sign-in therefore holds in a browser, not across installed iOS apps.
