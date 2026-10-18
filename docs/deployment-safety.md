# FawxzzyWeb production deployment safety

Production releases must use `npm run deploy:production`; raw `vercel deploy
--prod` is not an admitted FawxzzyWeb release path. Merge and deployment remain
separate operator decisions.

## Committed destination contract

- GitHub repository: `fawxzzy/FawxzzyWeb`
- Vercel team: `team_CMJn7MvzFZZBnhNnjVUZF2RD` (`fawxzzy`)
- Vercel project: `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV` (`fawxzzyweb`)
- Required production aliases: `fawxzzy.com`, `www.fawxzzy.com`, and
  `account.fawxzzy.com`

`.vercel/project.json` remains ignored workspace state. Its team, project, and
name must match the committed contract before any build or upload. The wrapper
never links a project. A missing link therefore fails closed instead of letting
the Vercel CLI infer or create a replacement project.

## Dry-run preflight

From a clean checkout of the exact intended main commit:

```text
npm run deploy:production -- --dry-run --expected-commit <40-hex-sha> --ci-run-id <successful-exact-main-run>
```

The dry-run verifies the local binding, clean checkout, exact HEAD, reachability
from `origin/main`, a successful `push` CI run whose branch is exactly `main`
and whose head is the exact release commit, live Vercel team/project identity,
current production deployment, and rollback candidate. A pull-request,
workflow-dispatch, or non-main run for the same SHA is not release evidence. The
dry-run performs no deployment.

On Windows, the wrapper resolves the installed CLI form from `PATH` in fail-closed
order (`.exe`, then `.cmd`, then an exact command match). This supports the native
GitHub CLI executable and the npm-installed Vercel command without assuming that
both tools use the same shim extension. A missing CLI stops before provider access.

## Authorized release

After separate current production authorization:

```text
npm run deploy:production -- --expected-commit <40-hex-sha> --ci-run-id <run-id> --confirm-production fawxzzyweb
```

The wrapper exports the exact Vercel team and project IDs to the CLI, disables
interactive inference, deploys the verified commit, and then requires:

- the expected READY production deployment and source commit;
- the existing project and all required aliases;
- 200 responses for the governed public, account, Auth, compatibility, health,
  manifest, robots, and sitemap routes;
- the exact `www` canonical redirect;
- 206 trailer byte-range delivery;
- zero production error and 5xx logs.

The prior production deployment is recorded as the rollback candidate. Output is
written to the ignored exact-commit visual-evidence folder. The wrapper does not
authorize a deployment; it only enforces and records an already approved one.

The wrapper verifies the retained rollback deployment is READY on the exact
project and all three canonical aliases currently bind to it before invoking
the deploy command. It captures the CLI's deployment
URL, resolves that URL to one provider deployment, and requires the expected
project, production target, source commit, and unique invocation identity. A
missing or mismatched URL, another writer's target, or an unobserved cutover is
an uncertain effect hold
and cannot be retried from this wrapper.

If the command fails or post-deployment acceptance fails after the wrapper
observes its own exact production target, it makes one rollback request to the
captured prior deployment. It first checks that the current target is still its
candidate, then
requires the prior target and all three canonical aliases to read back on the
prior deployment. A different target, incomplete alias read, failed rollback,
or exhausted observation window is an explicit recovery hold; the wrapper must
not roll back another writer's deployment or claim production was restored.
The acceptance verifier repeats target and alias readback just before writing
its terminal success receipt. A collision-free writer reservation must span
both the release and any rollback; target reads alone cannot close the race
between observation and provider effect.
The CLI can fail before it emits a URL even if the provider accepted an effect.
That uncertain outcome still requires exact provider reconciliation before any
retry or release-complete claim. The recovery guard does not replace the
separate production authorization and writer reservation.

## Task-owned workspace teardown

Release workspaces are created only below the governed temporary workspace root.
Do not bypass cleanup guards. Remove task-owned `.vercel` state and the worktree
only through the established path-verified teardown flow; never target the
canonical checkout or its preserved stash.
