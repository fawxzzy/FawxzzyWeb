# FawxzzyWeb downstream dependency packet

Observed: 2026-07-16

This is owner-repository evidence for downstream owners. It does not authorize edits outside
this repository.

| Owner | Exact dependency | Required downstream action | Gate |
| --- | --- | --- | --- |
| ATLAS Main | GitHub `fawxzzy/FawxzzyWeb`; Vercel `fawxzzyweb`; package key `fawxzzyweb`; local path still `repos/trove` | Update registry identity first; admit the local path move to `repos/fawxzzyweb` separately after all path consumers are enumerated | Owner receipt, clean parity, provider readback |
| DiscordOS | Human board label `FawxzzyWeb` | Reconcile and rename through the serialized DiscordOS writer; preserve stable card history | Exact live readback before write |
| Foundation | Existing GitHub/Vercel capabilities and project ID | Update capability labels without copying tokens or changing secret handling | Foundation-owned secret and audit policy |
| Lifeline / `_stack` | Frozen Trove Wave 1 pins plus new package/repo identity | Preserve old release IDs and artifacts; add a successor manifest for `fawxzzyweb` only after the ATLAS path cutover | Manifest validation and rollback rehearsal |
| Fitness | Catalog origin `https://fawxzzy-fitness-local.vercel.app` | No production-origin change; verify the catalog link and future domain packet independently | Fitness owner proof |
| Mazer | Catalog origin `https://fawxzzy-mazer.vercel.app` | No production-origin change; verify the catalog link and future domain packet independently | Mazer owner proof |
| Playbook | Identity classification and same-object provider rename pattern | Capture Rule, Pattern, Failure Mode, and rollback runbook candidates | Proof-backed owner receipt |
| Socials OS | Naming decision and distribution roadmap `SOC-024` | Replace planning assumptions with exact owner receipt identities and preview proof; do not edit application code | Socials OS owner review |

## Reusable discoveries

Rule: provider display names, provider slugs, package keys, local paths, and human product names
are separate contracts. Record the mapping before mutation.

Pattern: preserve object identity by renaming the existing GitHub repository and Vercel project,
then verify immutable IDs, history, redirects, rollback assets, and local remotes.

Failure Mode: global search-and-replace destroys historical evidence and can turn release or
rollback identifiers into fiction. Classify each legacy identifier first.

Decision: static exports use a real compatibility page backed by the canonical component because
Next.js config redirects are unsupported under `output: "export"`.

## Next production-cutover packet

After explicit approval, the production packet must:

1. re-read exact GitHub/Vercel identities, clean parity, CI, review, preview, and rollback state;
2. capture the current production alias and rollback candidate again;
3. deploy the exact reviewed commit to Vercel production;
4. attach `fawxzzy.com` without touching Fitness or Mazer domains;
5. perform route-aware, mobile, accessibility, metadata, TLS, DNS, and rollback proof;
6. update ATLAS and downstream owners only through their admitted writer lanes.

Approval is absent. The only accepted future approval text is:

`Deploy FawxzzyWeb to Vercel production and connect fawxzzy.com.`
