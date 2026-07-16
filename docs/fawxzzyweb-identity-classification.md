# FawxzzyWeb identity classification

Observed: 2026-07-16

This classification is the precondition for changing any `trove`, `fawxzzy-trove`,
`fawxzzy-web`, or `Fawxzzy Web` identifier. It separates current identity from required
compatibility and immutable provenance.

## Live identity

These surfaces carry current product or provider identity and move to `FawxzzyWeb` or
`fawxzzyweb`:

| Surface | Current contract |
| --- | --- |
| Product and repository documentation | `FawxzzyWeb` |
| Package name and health app id | `fawxzzyweb` |
| Root metadata, Open Graph, manifest, and install title | `FawxzzyWeb` |
| Canonical public root | `/` with intended origin `https://fawxzzy.com` |
| Canonical catalog | `/apps` |
| GitHub repository target | `fawxzzy/FawxzzyWeb` |
| Vercel project target | `fawxzzyweb` on existing project ID |

## Compatibility identity

These identifiers remain intentionally available and must not be deleted during the
non-production migration:

| Surface | Reason |
| --- | --- |
| `/trove` | Reversible static compatibility access to the shared `/apps` catalog |
| `catalogCapability: "trove"` in health output | Downstream readers can distinguish the retained catalog capability from the product identity |
| `TROVE_BASE_URL` fallback | Existing QA callers remain functional while `FAWXZZYWEB_BASE_URL` becomes canonical |
| `https://fawxzzy-trove.vercel.app` | Stable legacy provider alias and rollback entrypoint |
| ATLAS QA names containing `trove` | Owned by ATLAS; change only through the downstream dependency packet |
| `public/brand/trove-*` assets | Catalog-capability assets; filenames are not current repository identity |

## Immutable historical provenance

The following remain unchanged because they describe prior truth or preserve rollback assets:

- `.lifeline/trove.lifeline.yml` and `.lifeline/wave1-deploy.manifest.json` Wave 1 pins;
- `docs/lifeline-wave1-pilot.md` release commands, artifact refs, and release IDs;
- `docs/naming-blocker-conversion-*.md` receipts;
- `docs/naming-blocker-preservation/**` patches and captured files;
- dated screenshot source notes, QA evidence, prior commit messages, Git tags, releases, and PR history;
- the preserved local stash `codex-preserve-before-sync-2026-05-01`;
- existing production deployment metadata, including dirty-source provenance.

Historical identifiers are evidence, not authority for new naming.

## Decision

Rule: classify an identifier before renaming it. Current identity changes, compatibility stays
until its consumers migrate, and provenance never changes merely to make a search result look
clean.
