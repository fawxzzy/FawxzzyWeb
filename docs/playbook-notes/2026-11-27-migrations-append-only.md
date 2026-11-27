## 2026-11-27 - Applied migrations are append-only

- Type: Rule
- WHAT changed: `playbook.config.json` switches on the Playbook verify rule `migrationsAppendOnly` for `supabase/migrations/**/*.sql`. A pull request may add a migration file there; modifying, deleting or renaming one that already exists on the base branch fails the `Playbook verify` check. `AGENTS.md` names the rule.
- WHY it changed: files under `supabase/migrations/` describe SQL that is already applied to the shared database, so an in-place edit makes the repository disagree with production without changing production. Two of the seven files there were edited after they were first committed (`20260826163000_account_username_signin_index.sql`, `20261112140000_account_username_signin_throttle_v3.sql`). The rule has been on in the Fitness repository since 2026-11-26 for the same folder layout.
- Rule: to change applied SQL, add a new migration file. A file that is added and revised inside one pull request is fine (only files that exist on the base branch are checked). The rule has no escape hatch.
- Not covered: `supabase/proposed/**`. Proposal, preimage and rollback files are revised during review before they are applied, and the path does not say which ones are applied, so they stay outside the rule.
- Evidence: scratch runs of Playbook verify 0.76.0 on this branch (editing an existing migration fails with `migrationsAppendOnly`, adding a new one passes, this branch passes); this pull request's `Playbook verify` job. Open pull request #133 only adds a migration file, so it is not affected.
- Status: source only; verify configuration and docs. No app behavior change, no database change, no deploy needed.
