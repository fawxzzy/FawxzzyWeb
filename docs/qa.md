# Trove QA LLEL

Trove owns its ATLAS QA LLEL intent in this repo. ATLAS root owns the shared runner, schemas, artifact validation, reporting, evidence indexing, and promotion logic.

## Repo-owned files

- `qa/adapters/trove.web.json`
- `qa/scenarios/trove.home-smoke.json`

## Stable smoke scope

The initial Trove adoption stays intentionally small:

- one stable smoke route: `/`
- static-export runtime path: `npm run build` then `npm run start`
- emulated evidence lenses:
  - `desktop.chromium.emulated`
  - `android.chrome.emulated`
  - `iphone.webkit.emulated`

This repo does not require physical-device evidence for the homepage smoke lane in v1. If a release-critical Trove flow needs physical proof later, that should be added as a separate scenario or release-tier expansion rather than folded into this baseline smoke route.

## Command evidence

Trove does not expose a standalone unit-test runner today. The repo-owned QA intent therefore requires stable command evidence from `npm run lint` while keeping the broader repo verification command available through `npm run verify`.

## Root execution examples

From the ATLAS root:

```bash
python ops/atlas/qa/validate_adapter.py --adapter-file repos/fawxzzy-trove/qa/adapters/trove.web.json
python ops/atlas/qa/validate_scenario.py --scenario-file repos/fawxzzy-trove/qa/scenarios/trove.home-smoke.json
python ops/atlas/qa/ci_gate.py --mode dry-run --adapter-file repos/fawxzzy-trove/qa/adapters/trove.web.json --scenario-file repos/fawxzzy-trove/qa/scenarios/trove.home-smoke.json
python ops/atlas/qa/ci_gate.py --mode evidence --adapter-file repos/fawxzzy-trove/qa/adapters/trove.web.json --scenario-file repos/fawxzzy-trove/qa/scenarios/trove.home-smoke.json
```

Repo-local verification remains:

```bash
npm run verify
```
