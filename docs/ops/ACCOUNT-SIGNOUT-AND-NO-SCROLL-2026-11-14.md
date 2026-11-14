# Account pages: no page scroll, and the host sign-out endpoint (MAZER-ACCT-041)

Date: 2026-11-14. Status: headless-only, not device-checked (no real phone, no real provider call).

## 1. "Too much room to scroll" on the account pages

Owner report: the reset-password screen could be scrolled up and down with a lot of room, and no account page should scroll.

### Root cause (from code, and reproduced by simulation)

- The base reset gave `body` `min-height: 100vh` (and Tailwind `min-h-full` on a `h-full` html). The focused account screen is sized with `100dvh - safe-area insets`.
- On iOS Safari `100vh` is the viewport with the toolbars retracted, so it is taller than the visible area while the toolbars are showing. The document is therefore taller than the screen by about the toolbar height (around 80 to 110 px), scrolls by that much, and rubber-bands (`body` also computes `overflow-y: auto` because of `overflow-x: hidden`). The `.system-page` error pages had the same `min-height: 100vh` plus padding.
- Headless Chromium and WebKit have no dynamic toolbar, so `vh == dvh` and the live site measured clean at 390x844, 360x740, 412x915, 1280x720 and 320x568 (document `scrollHeight == innerHeight` on every account route; the only overflow was the 404 page at 320x568, 589 vs 568 px). The bug does not appear in plain headless runs.
- Reproduction by simulation: rewrite every stylesheet so `100vh` becomes `calc(100dvh + 90px)` (what iOS reports with toolbars showing). On the live site that made `/reset-password` and the 404 page overflow by exactly 90 px at every viewport (`scrollHeight 934` vs `innerHeight 844` at 390x844). The same simulation after the fix stays at `scrollHeight == innerHeight` on every route.
- Ruled out: the ambient background layer (the account screen does not render it; the 404 page renders it inside the shell and it does not add height), the sticky footer (hidden on the account screen), margins and padding stacks (the account screen is a fixed-height flex column with its own inner overflow handling).

### Fix (CSS only, `src/styles/page-families/account-forms.css`)

For every page containing `.account-page--utility` (login, sign up, reset request, new password, auth confirm, auth callback, account home, Mazer consent, sign out) and every page containing `.system-page--locked` (404, route error, global error):

- `html`: `height: 100%`, `overflow: hidden`, `overscroll-behavior: none`.
- `body`: `position: fixed; inset: 0`, `min-height: 0`, `overflow: hidden`, `overscroll-behavior: none`. A fixed body tracks the visible layout viewport, so no vh unit decides its height.
- `.safe-area-main` and the account screen take `height: 100%` of that (the safe-area padding stays).
- Error pages scroll inside their own `main` (`overflow-y: auto; overscroll-behavior: contain`) only when their content does not fit (320x568 and shorter), never the document.
- The sign-up form with a problem list keeps its existing inner scroll (`.account-auth-body`), unchanged.
- Status cards (link check, sign-out, Mazer consent) used to be stretched over the whole screen, which also stretched the action button into a giant pill (live today at 390x844). They now size to their content and center.

### Test

`tests/e2e/account-no-scroll.spec.ts` (runs in `npm run verify` through `test:e2e`, Chromium and iPhone-14 WebKit): 11 routes at 390x844 (DPR 3, touch, mobile), 360x740, 412x915, 320x568 and 1280x720, each as served and with the iOS toolbar simulated. It asserts `scrollHeight <= innerHeight + 1`, no horizontal overflow, `window.scrollTo(0, 10000)` leaves `scrollY` at 0, and `html`/`body` compute `overflow-y: hidden`. Extra cases: sign-up with a problem list at 360x640 (action stays on screen, the fields area scrolls) and the 404 page at 320x400 (scrolls inside `main`). Screenshots are attached to each test result; a selection is committed under `docs/ops/evidence-account-no-scroll-2026-11-14/`.

### Not verified

A real iPhone (Safari with toolbars, installed home-screen app, keyboard open). The keyboard case in particular: iOS pans the visual viewport above the keyboard; with the body fixed the document cannot scroll, so a focused field relies on that pan and on the inner scroll region. Check on a phone.

## 2. Host sign-out endpoint

`GET https://account.fawxzzy.com/signout?returnTo=<url>` (static page `src/app/signout/page.tsx`, logic in `SignOutPanel` in `account-portal.tsx`, allowlist in `src/config/account-signout.ts`).

- It is a page, not a data endpoint: the session lives in this browser's storage, so only code running in the page can clear it. The page ends THIS browser's account session with the local scope (`POST /auth/v1/logout?scope=local`, which revokes that one session at the provider and removes the stored copy), clears the shared owner-hint cookie exactly like the account page's Sign out, then calls `location.replace(destination)`.
- Decision: local scope, not the account page's "everywhere" (global). Mazer's Sign out should end the account session in this browser, not sign the person out of Fitness and other devices. The account page's own Sign out button is unchanged (global).
- Destination: `returnTo` is followed only if its origin is exactly `https://mazer.fawxzzy.com` or the account host itself (`https://account.fawxzzy.com`; on an approved local test origin, that origin). Path and query are kept, fragment and credentials are dropped. The hub (`fawxzzy.com`), Fitness and the `*.vercel.app` compatibility origins are NOT allowed. Anything else, empty, malformed, `//host`, backslash or control characters, `javascript:`, `blob:`, `data:`, other schemes or ports, lookalike hosts, `@` tricks, percent-encoded URLs, over 2048 characters, or a target that is `/signout` itself (loop), goes to `/login` on the account host.
- Failure: if the sign-out call fails the page does NOT redirect. It says "Still signed in." with "Sign out failed. Try again.", a Try again button and a Log in link.
- Tests: `tests/account-signout-contract.test.mjs` (52 hostile targets plus a 4000-case seeded fuzz that every result stays on an allowlisted origin, and source-order checks), `tests/e2e/account-signout.spec.ts` (the page applies it; owner-hint cookie cleared; failure path; noindex).
- Bug found by the contract test while writing it: `blob:https://mazer.fawxzzy.com/x` reports the wrapped origin, so the scheme is checked as well as the origin.

### CSRF consideration

A third-party page can send a visitor to `/signout` and end their session in that browser (logout CSRF). The effect is a forced sign-in, no data exposure, and the destination cannot be steered off the allowlist. It is accepted as low risk and no confirm interstitial is added, because: it only ends the session (the user can sign in again), the site sends `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin`, and the page needs JavaScript, so an `<img>`, `<script>` or iframe cannot trigger it silently; only a top-level navigation (visible to the person) can. If this is ever judged too loose, a confirm button is a small change in `SignOutPanel` (render the button and call the same function on click).

### Installed home-screen app

The endpoint is an ordinary top-level navigation to the account host. The portal session lives in the storage of whichever browser context the person signed in with on the account host. A standalone (home-screen) Mazer app that opens the account host in the system sheet or in Safari can only clear the session stored in THAT context; if the person signed in to the account host through a different context, that session is not reachable from here. Not verifiable headless; check on the phone.

### Capability ping (for Mazer's feature check)

`GET`, `HEAD` or `OPTIONS` `https://account.fawxzzy.com/signout/ping` answers **204**, no body, no cookie, `Access-Control-Allow-Origin: https://mazer.fawxzzy.com` (fixed, never `*`, never the caller's Origin, no `Access-Control-Allow-Credentials`), `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, `Vary: Origin`, `Cache-Control: no-store`. Any other method answers 405. Implementation: `api/account/signout-ping.ts` (a Vercel function), reached through the `vercel.json` rewrite `/signout/ping` -> `/api/account/signout-ping`. A 404 (or a network failure) on the ping means the sign-out endpoint is not deployed. Mazer should call it with `fetch(url, { method: "HEAD", mode: "cors", credentials: "omit" })`. This cannot be exercised on the local static server (no functions); the contract test calls the handler directly and checks the rewrite, so the real route is only provable after deploy: `curl -si https://account.fawxzzy.com/signout/ping`.

### Mazer authorization loading state

The gray "PENDING / One moment. / Checking your sign-in..." card on `/oauth/authorize` (account host: right after a signed-out Mazer launch redirects there, and again between host sign-in and the return to Mazer) is replaced by Mazer's own loader so the person sees one continuous loading look:

- Opaque `#02080f` full-screen layer from the first paint (it is in the prerendered HTML), no card, no text (screen-reader text only), no scroll, covers the safe areas.
- Mazer app icon centred, 30% of the short side clamped to 88 to 150 px (Mazer's sizing; the 72 px suggested in the request was not used so the two loaders match), soft ring, static halo, breathing icon, reduced-motion variant: copied from Mazer's boot splash (`index.html`) and `src/render/appLoader.ts`. The icon is Mazer's own inline 256x256 WebP data URI (`src/components/account/mazer-loader-icon.ts`, about 15 KB, no request, no pop-in; `public/apps/mazer/icon.png` is 934 KB, too heavy to inline).
- Timeline: only the stage fades in, 200 ms after a 150 ms delay (CSS). If the authorization finishes before 150 ms from first paint the page leaves at once, so a quick sign-in shows only the bare dark page. Once the icon shows, the page holds until 500 ms from first paint (150 ms delay + 350 ms minimum hold) before navigating (`src/lib/auth/mazer-loader-timing.ts`, `holdLoader`). The 300 ms fade-out is not copied: the page unloads on navigation, so there is nothing to fade; Mazer's splash then fades its own stage in after its own 150 ms delay, which can read as icon, dark, icon. If that gap is noticed, the fix is on Mazer's side (start its stage instantly when the referrer is the account host).
- Error and consent states are unchanged. The host login page is untouched.
- Evidence: `docs/ops/evidence-account-no-scroll-2026-11-14/oauth-loader-first-paint-bare.png` (first paint) and `oauth-loader-icon-after-150ms.png` (390x844 DPR 2 iPhone UA).

### Mazer side

Mazer must link its Sign out to `https://account.fawxzzy.com/signout?returnTo=https%3A%2F%2Fmazer.fawxzzy.com%2F`. That change is in the Mazer repo and is not part of this PR.
