# FawxzzyWeb project-board owner export

`planning/project-board-owner-source.v1.json` is the source-backed current-work registry for the stable ATLAS project ID `trove`, displayed publicly as **FawxzzyWeb**. `scripts/export-project-board-owner.mjs` deterministically produces `exports/trove.project-board.owner-export.v1.json` for the provider-neutral `atlas.project-board.owner-export.v1` contract.

Repository ownership, repository naming, and repository-relative source paths derive from the canonical `src/config/product.ts` identity. That identity file is included in the export source revision, so an identity change makes the tracked export stale until it is deliberately regenerated.

## Current selection

The current source holds the Web board's work cards: `FW-PROJECTS-003` (owner-only Projects; in progress until the owner confirms the tab and boards on a device), `FW-ANALYTICS-001` (historical traffic; planning, needs an approved database read path), `FW-CAPTCHA-001` (bot check on the account forms; blocked on a provider account and keys only the owner can create), and the completed cards `FW-DEVICE-001` (real-phone pass), `FW-PRESENCE-001` (live online-now count) and `FW-APPS-001` (store-style Apps page). `FW-PROJECTS-001` (connect the boards to a live read model) and `FW-PROJECTS-002` (audit the Atlas Stack board) were retired on 2026-11-14: the boards are a milestone snapshot folded from each project's own registry, not a live feed, and the Atlas Stack cards are owned by the Atlas and Playbook registries, not this repository; their text stays in git history. Mazer's export (`planning/board-sources/`) carries the full Mazer board including completed history.

The producer can validate and deterministically export additional `FW-` owner cards while retaining the existing card's stable ID. Every card needs an explicit `public_safe` decision. The decision stays in the owner export for governed intake. Since the owner-only Projects decision (2026-11-13) it no longer gates display: the owner sees every card, and the repository is public, so keep private-only material out of owner exports. Duplicate and cross-owner IDs fail closed. The source scope is `in-progress`, `planning`, `blocked` and `completed`; `ready` and `review` require an explicit source-scope update before use. Priority, lifecycle, source revision and source references stay attached to each exported card.

The producer deliberately excludes:

- GitHub issue #1, an open April Trove deployment incident log superseded by later verified production releases;
- `SOC-024`, which retains its stable Socials OS program identity and stays on the Socials OS board rather than becoming duplicate Website work;
- the unplanned root UI-standards candidate, whose projection is not authorized;
- every Fitness, Mazer, DiscordOS, and Music Sesh card.

Historical Trove names remain provenance. The active owner and board identity stays `trove` because `stack.yaml` defines that stable machine ID and `FawxzzyWeb` as its display name.

## Commands

Generate the tracked export:

```powershell
npm run data:project-board-owner
```

Prove deterministic readback and focused semantics:

```powershell
npm run data:project-board-owner:check
npm run test:project-board-owner-export
```

The normal `npm run verify` includes the focused owner-export test and stale-output check.

## Boundary

This is a repository-local source projection only. It does not write Discord, Supabase, any provider, a deployment, or production. It does not implement or adopt the separate draft Platform private-operations event journal. A source export still needs the existing canonical writer's intake, conflict checks and a real result-return readback. DiscordOS remains retired provenance for the public project board, and the separate master-backed FawxzzyWeb read-model lane remains the only intended presentation path.
