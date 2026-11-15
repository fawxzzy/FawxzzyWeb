## 2026-11-15 - Auth Surface v2 (PR-A): one anatomy, one notice slot, one copy matrix

- Type: Pattern + Rule
- WHAT changed: every account.fawxzzy.com screen (sign in, create account, reset request, new password, account, sign out, callback, confirm, Mazer OAuth fallback, 404, crash) now renders from `src/components/account/auth-surface.tsx` with styles in `src/styles/page-families/auth-surface.css`. Words come only from `src/lib/auth/copy-matrix.ts`; provider outcomes map to matrix ids in `src/lib/auth/auth-outcomes.ts`. Failed links land on sign in or the reset request with `?notice=<allowlisted key>`.
- WHY it changed: owner-approved redesign (2026-11-15): messages used to replace the dock label for five seconds, moved the layout, got clipped, and said "Something went wrong".
- Rule: a portal screen shows ONE notice in a reserved slot under the fields; the dock only says what it does or is doing. `npm run test:account-copy` (`tests/account-copy-matrix.test.mjs`) fails on any visible text outside the matrix and on retired lines.
- Failure Mode: text added straight into a component drifts from the approved copy and reintroduces vague lines; the lint scans JSX text and copy-like string literals in the auth screen files.
- Decision: signed-out reset still takes an email (a username field needs a server-side username-to-email reset path); database/unknown sign-up failures show the generic `page.crash` line (backend returns one code); a failed other-sessions sign-out after a saved password still shows `signin.resetdone` (no matrix line yet).
- Evidence: node tests (`test:account-copy`, `test:password-reset`, `test:account-signout`, `test:username-signin`), e2e on chromium and mobile-webkit, visual baseline, screenshots at 390x844 DPR3 and 320x568.
- Status: in review (PR-A).
