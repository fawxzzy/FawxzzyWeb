# Fawxzzy Auth Surface Family

Status: source contract for the shared Website, Fitness, and Mazer authentication family.

## Decision

The three products use one rigid authentication anatomy. Product theme may change; screen structure may not.

- Fitness is the canonical structural reference: centered fields, no subtitle, a compact secondary-action row, one strong bottom-dock action, safe-area-aware spacing, and minimal visual noise.
- The account host owns one declarative screen template and a closed presentation registry rather than three copied screen implementations.
- Each product context may replace only its background/accent token, product wordmark, destination-specific wording, allowlisted return destination, and legal-link row.
- Context selection is presentation-only. It never selects an Auth provider, callback, session, credential boundary, or arbitrary return URL.
- Capability truth wins over visual consistency. A product must never show an enabled action when its account adapter or service registration is unavailable.

## Required anatomy (Auth Surface v2, owner-approved 2026-11-15)

Every account screen (sign in, create account, reset request, new password, account, sign out, callback, confirm, OAuth fallback, 404 and crash) uses the same anatomy, in this order. Components: `src/components/account/auth-surface.tsx` (the stateless icon, head, notice slot, dock and status screen live in `auth-status.tsx`, so the 404 and crash screens on every route carry neither the client module nor the full copy matrix; they take their words from `STATUS_COPY` in `src/lib/auth/status-copy.ts`, part of the copy matrix); styles: `src/styles/page-families/auth-surface.css`.

1. The product's app icon, from the branding files already in `public/` (never a drawn shape).
2. The product name as a small kicker, then the title. No username or other identity under any title.
3. An optional centred lead sentence (only where the mock has one; a screen showing a notice drops its lead).
4. Labelled fields with sentence-case labels. A value the person does not type (a remembered identity, the signed-in email, a value already sent) is a locked field with a lock icon. Password fields get the shared show/hide toggle.
5. ONE notice box in a fixed, reserved slot directly under the fields. The slot always takes its height, so a message appearing or clearing never moves anything and is never clipped; it can carry one inline action (Retry, Sign in).
6. A compact text-link row with short accent bars between links, then the legal row (`Privacy` | `Terms`) where the context has one.
7. One full-width dock button that only ever says what it does or what it is doing (spinner plus a working label). It never carries an error.

Status screens (callback, confirm, sign out, account check, OAuth fallback, 404, crash) show the app icon inside a ring (spinning while it moves on by itself), a title, an optional lead or notice, and a dock only when the person has to act. They have no links or legal row. A failed or expired link never dead-ends: the person lands on the sign-in or reset request screen with the reason in the notice slot (`/login?notice=<key>`, allowlisted in `src/lib/auth/auth-outcomes.ts`).

Words: every line a person can read comes from the copy matrix `src/lib/auth/copy-matrix.ts`. `npm run test:account-copy` fails on any other visible text in the auth screen components and on any retired line ("Something went wrong", "Working…", "Wrong details", ...). Field errors outline the field in red and point it at the notice with `aria-describedby`; there is no floating error paragraph.

Every editable credential field preserves native mobile caret placement, long-press selection, and text-callout behavior. The product-owned password reveal is the only visible reveal control; browser-native duplicate reveal and clear controls are suppressed without changing password-manager or autofill semantics.

The utility document never scrolls on ordinary supported mobile viewports, down to 320x568 (a compact size set applies at heights of 760px and below, and a tighter one at 600px and below; when a keyboard leaves less room, only the form body scrolls, downward, so every field stays reachable). Interactive targets stay touch-safe and keyboard focus stays visible.

The Fitness presentation derives its public Privacy Policy and Terms of Service from the catalog's current Fitness origin; the account host renders those live destinations without copying the legal documents, switching early to a planned origin, or changing product ownership.

The authenticated account surface shows the product marker, `Account` title, the lead "Your account works in Fitness and Mazer.", locked username and email fields, one `Reset password` link, and a full-width `Sign out` dock action. The locked username and email rows carry a pencil button (in place of the lock) that opens Change username / Change email on the same anatomy: step 1 is a locked current value plus the password (dock `Continue`), step 2 the new value (dock `Save username` or `Send link`); an email link already sent stays locked with the resend countdown in the dock, like sign-up. `Cancel` (or `Back to account`) returns to the account screen. It does not repeat the public app catalog, connection placeholders, or unfinished service-registration copy.

The forced first-run auth surface does not include a home/back action, subtitle, guest-play action, or separate display-name field. Username is the public display name.

The family requires 44px minimum interactive targets, visible keyboard focus, no horizontal overflow at 320px, reduced-motion support, and safe-area-aware vertical spacing.

## Product variants

### FawxzzyWeb

- Product marker: `Fawxzzy`.
- Background: Fawxzzy wolf-brand charcoal, sage, and soft neutral light fields.
- Desktop and mobile: the same bounded one-column Fitness-shaped frame.
- The remembered username is stored as optional local presentation state after a successful session and never becomes authentication authority.
- Current service boundary: account actions remain visibly unavailable unless the approved adapter resolves at runtime.
- Current implementation status: the account host renders Website, Fitness, and Mazer presentation contexts from one registry. Fitness consumer integration is active through an exact source-bound readiness contract; Mazer remains pending until its owner repository adopts the broker contract from a reviewed exact head.

### Fitness

- Preserve the existing Fitness auth shell, field treatment, bottom action rhythm, and green fitness background.
- Copy may name Fitness-specific account outcomes.
- Do not restyle the active login route while another exact writer owns it. Reconcile that work first, then change only proven contract gaps.

### Mazer

- Implement the same anatomy inside the Phaser runtime rather than importing Website or Fitness components.
- Background: Mazer's own static auth background; gameplay, simulation, announcements, and ambient motion are halted while auth is visible.
- Preserve one overlay and recoverable input behavior without guest-play access.
- The account host owns the `/oauth/authorize` OAuth 2.1 consent surface. It accepts one bounded provider authorization identifier, immediately removes it from the address bar, and retains it for at most 15 minutes in a Secure, HttpOnly, SameSite=Lax, host-only cookie. Page script and local storage never receive the retained identifier.
- `/oauth/authorize` accepts only the registered Mazer client, exact `https://mazer.fawxzzy.com/` redirect URI, and `email` scope. The Supabase OAuth server requires an explicit `approveAuthorization` call, so the first-party Mazer client (exact client-id and exact redirect-URI allowlist in `shouldAutoApproveMazerOAuth`, plus a matching session user) is approved by the account host without showing a consent card: the player sees Mazer's own loader (opaque #02080f, the Mazer icon with its ring after 150 ms, no text, no scroll) while the sign-in is checked, and is redirected to the exact Mazer origin. A portal session that already exists on the device (from signing in to any Fawxzzy app there) is used as is, so a second app needs no extra sign-in (device-level auto sign-in); without one the player signs in once first. There is no third-party consent path.
- Stopped requests go back to Mazer's own sign-in, never to a portal dead end: an invalid, expired or other-account request lands on the constant `https://mazer.fawxzzy.com/?notice=expired`, and an account-service or approval failure on `?notice=unavailable` (a service failure never reads as an expired link). Nothing from the request is followed, the pending carrier is cleared first, and there is no automatic retry. Only an unsafe request (a client, redirect URI or scope that is not Mazer's exact registration, or a provider redirect that fails the exact code/state check) keeps the portal fallback screen "Sign-in link expired" with an `Open Mazer` dock to the constant Mazer origin. The retained consent card ("Continue to Mazer?" with Cancel) is reachable only in local tests via `oauth_consent=1`. Every decision revalidates the current account session and accepts only a bounded code-or-error redirect back to that exact origin. Threat model and what is verified: `docs/mazer-oauth-threat-model.md`.
- iOS limit: each home-screen web app has its own storage, so the portal session from Safari or another installed app is not shared with it; each installed app needs one first sign-in on that device, after which it stays signed in.
- Do not change the auth/menu surface while another exact writer owns it. Reconcile that work first, then implement from a fresh exact parent.

## Mazer pattern intake

| Pattern | Decision | Application |
| --- | --- | --- |
| Safe-area and dynamic viewport ownership | ADAPT | Keep the auth task and primary action clear of browser and device insets. |
| Persistent bottom controls | ADAPT | Use the Fitness rhythm for the primary auth action without copying React layout code. |
| Safe-default responsive layouts | ADOPT | Keep labels, fields, and actions usable across the supported viewport matrix. |
| Install capability | NOT_APPLICABLE | Auth layout work does not change install behavior. |
| Served-build provenance | ADOPT | Verify the final Mazer implementation against its served exact build. |
| One overlay and recoverable interaction | ADOPT | Keep one bounded auth overlay and preserve escape/recovery behavior. |
| Accessible motion preferences | ADAPT | Reduce or stop background motion without removing product identity. |
| Versioned persistent state | ADOPT | Preserve current state contracts; this family introduces no schema change. |

## Sequencing and ownership

1. Fitness remains the locked structural reference.
2. FawxzzyWeb proves the declarative template, presentation registry, field feedback, the reserved notice slot, reset flow, and optional legal row first.
3. Fitness and Mazer remain unchanged while the Website host proves every registered presentation. Consumer navigation, broker exchange, and app-owned session adoption remain separately gated.
4. Each owner repository then adapts its rendering primitive to the same contract; it does not copy a second state machine.
5. Each product requires focused tests, responsive screenshots, exact-head review, and a separately authorized release.

Failure mode: visual mimicry without a shared structural contract drifts into absolute positioning, extra copy, inconsistent actions, and moving controls. Tests must assert the anatomy and layout behavior, not only the presence of labels.

## Installed-app navigation boundary

Manifest scope is same-origin. Therefore an installed Fitness or Mazer app cannot make the cross-origin account website behave like an in-scope top-level PWA document. The shared contract centralizes Auth semantics, validation, copy, presentation tokens, and verified return targets, while each installed product owns a same-origin account shell in its own visual language. That shell may broker to the canonical account service, but it must not duplicate Auth authority, iframe the account host, depend on experimental scope extensions, spoof browser chrome, or rely only on browser history for return navigation.

A back or return action is rendered only from a closed product registry entry. Arbitrary query-string return URLs are never accepted. Website and active Fitness contexts have verified destinations; Mazer gains an installed-app return control only after its owner-side consumer is released and observed.

This contract grants no commit, push, pull-request, merge, provider, deployment, or production authority.
