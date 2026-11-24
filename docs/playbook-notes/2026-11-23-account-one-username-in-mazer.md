## 2026-11-23 - Account page shows one username in Mazer

- Type: UI display change
- WHAT changed: in the Mazer context (`app=mazer`) `/account` shows one row, the Mazer name labelled "Username" (pencil, change panel title and field labels follow); the sign-in username row is hidden there. The website and Fitness contexts keep both rows. New pure helper `mazerNameIsSoleUsername` in `src/lib/auth/mazer-name.ts`.
- WHY it changed: Mazer players saw "Username" and "Mazer name" as two names; they are two stores (auth identity vs `mazer.mazer_profiles.username`), so only the display collapses.
- Rule: display only; `mazer_set_username` wiring, rename throttle, password re-check and the sign-in username change flow are untouched. A single shared identity would be a separate data decision.
- Evidence: `tests/account-mazer-name.test.mjs`, `tests/e2e/account-mazer-name.spec.ts`, phone-shot captures.
- Status: PR open, not merged or deployed.
