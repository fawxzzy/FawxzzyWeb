# FawxzzyWeb project-board owner export

`planning/project-board-owner-source.v1.json` is the source-backed current-work registry for the stable ATLAS project ID `trove`, displayed publicly as **FawxzzyWeb**. `scripts/export-project-board-owner.mjs` deterministically produces `exports/trove.project-board.owner-export.v1.json` for the provider-neutral `atlas.project-board.owner-export.v1` contract.

## Current selection

The export contains one current FawxzzyWeb-owned card: the source-proven `/projects` consumer and guarded publication lane. It remains blocked on the canonical Mazer owner export. The already-complete Fitness export is evidence, not duplicated Fitness work.

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

This is a repository-local source projection only. It does not write Discord, Supabase, any provider, a deployment, or production. DiscordOS remains retired provenance for the public project board, and the separate master-backed FawxzzyWeb read-model lane remains the only intended presentation path.
