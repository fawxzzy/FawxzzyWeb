# FawxzzyWeb project-board owner export

`planning/project-board-owner-source.v1.json` is the source-backed current-work registry for the stable ATLAS project ID `trove`, displayed publicly as **FawxzzyWeb**. `scripts/export-project-board-owner.mjs` deterministically produces `exports/trove.project-board.owner-export.v1.json` for the provider-neutral `atlas.project-board.owner-export.v1` contract.

Repository ownership, repository naming, and repository-relative source paths derive from the canonical `src/config/product.ts` identity. That identity file is included in the export source revision, so an identity change makes the tracked export stale until it is deliberately regenerated.

## Current selection

The current source contains the existing `FW-PROJECTS-001` card for the merged `/projects` route and guarded public HTTP reader. Mazer PR #360 is merged and its owner export is available on Mazer main with three public-safe owner cards. The Web card remains blocked because the sole canonical writer has not returned an accepted sanitized public projection, an approved public artifact or endpoint, and a refresh policy. The merged reader has no approved live source or real-card synchronization readback. The source also contains `FW-ANALYTICS-001`, an unadopted planning candidate with `public_safe: false` that is held for governed intake and excluded from public publication. The already-complete Fitness export is evidence, not duplicated Fitness work.

The producer can validate and deterministically export additional `FW-` owner cards while retaining the existing card's stable ID. A new card needs an explicit `public_safe` decision; omission is accepted only for the original `FW-PROJECTS-001` source record. A `false` decision stays in the owner export for governed intake; a `true` decision still needs the public projection owner's approval before website publication. Duplicate and cross-owner IDs fail closed. The existing `in-progress`, `planning`, and `blocked` lifecycle scope is retained; `ready`, `review`, and `completed` require an explicit source-scope update before use. Priority, lifecycle, source revision and source references stay attached to each exported card.

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
