# Playbook notes (one file per change)

Playbook's `requireNotesOnChanges` rule requires a notes update whenever `src/**`, `app/**`, `server/**` or `supabase/**` changes. `playbook.config.json` accepts either `docs/PLAYBOOK_NOTES.md` or any file under `docs/playbook-notes/**`.

## How to add a note

- Create one new file per change: `docs/playbook-notes/YYYY-MM-DD-<slug>.md`.
- Use the same fields as the legacy file: `Type`, `WHAT changed`, `WHY it changed`, `Rule`, `Evidence`, `Status` (plus `Failure Mode` / `Decision` when they apply).
- Start the file with `## YYYY-MM-DD - <title>`.

## Why

Appending every note to the single `docs/PLAYBOOK_NOTES.md` made parallel pull requests conflict on that one file. New files do not conflict.

## Legacy file

`docs/PLAYBOOK_NOTES.md` stays as history. Do not append to it any more. `.gitattributes` marks it `merge=union` so a stray append from an older branch merges without a conflict.
