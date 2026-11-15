## 2026-11-15 - Playbook notes become one file per change

- Type: Rule
- WHAT changed: added `playbook.config.json` (explicit `requireNotesOnChanges` with the same trigger globs as the Playbook default) whose `mustTouch` accepts `docs/PLAYBOOK_NOTES.md` or any file under `docs/playbook-notes/**`; added `docs/playbook-notes/README.md`; marked the legacy notes file `merge=union` in `.gitattributes`. This also clears the `config-missing` doctor warning.
- WHY it changed: Playbook's own gate was the main new source of first-push CI reds after wiring (Web: 2 of 16 PRs), and every code PR appending to one file makes parallel PRs conflict on it.
- Rule: new notes go in `docs/playbook-notes/YYYY-MM-DD-<slug>.md`; do not append to `docs/PLAYBOOK_NOTES.md`.
- Evidence: Playbook impact retro and impact meter (private reports, 2026-11-15); same change merged in Fitness #258 and Mazer #585.
- Status: Applied
