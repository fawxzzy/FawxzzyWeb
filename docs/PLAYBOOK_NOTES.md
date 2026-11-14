This file is a project-local inbox for repo-specific Playbook notes that may later be promoted upstream.

## 2026-11-14 - Keep the Web board cards current with merged website work

- Type: Board source projection + Governance
- WHAT changed: `planning/project-board-owner-source.v1.json` gains `FW-PLAYBOOK-001` (Playbook verify on every PR, CI-only) and `FW-HANDOFF-001` (portal accepted-release list for the Fitness sign-in handoff), and `FW-PROJECTS-003` and `FW-PRESENCE-001` now describe PRs #148 and #158. The owner export and the generated owner snapshot `src/server/projects/owner-board.generated.mjs` are regenerated from that source; the owner-export tests and doc list the new card ids.
- WHY it changed: The Web board has no event pipeline, so merged website work (#148, #158, #160, #163) never reached its cards after the last board PR (#164).
- Rule: A Web PR that changes owner-facing behavior should update the Web card in the same PR; board-only PRs regenerate the export and snapshot with `npm run data:project-board-owner` and `npm run data:project-board-owner-snapshot`, never by hand.
- Scope: Source and local regression only. The owner snapshot reaches the live Projects page only after the next production build; no deployment, provider, credential or database effect.
