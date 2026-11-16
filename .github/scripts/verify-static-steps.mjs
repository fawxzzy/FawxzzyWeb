// Prints the shell command for every `npm run verify` step EXCEPT the final Playwright e2e step.
//
// CI runs the e2e step sharded across a matrix of jobs (see .github/workflows/ci.yml); everything else in
// `npm run verify` runs in the "Static checks" job. Deriving that list from package.json keeps the two halves
// equal to the single `verify` script: a step added to `verify` is picked up here automatically, and the job
// fails loudly if `verify` stops ending in the e2e step this split relies on.
import { readFileSync } from "node:fs";

const verify = JSON.parse(readFileSync("package.json", "utf8")).scripts?.verify;
if (typeof verify !== "string") {
  throw new Error("package.json has no scripts.verify");
}

const steps = verify.split(" && ").map((step) => step.trim());
const e2eStep = "npm run test:e2e";
if (steps.at(-1) !== e2eStep || steps.filter((step) => step === e2eStep).length !== 1) {
  throw new Error(
    `CI shards the e2e step, so scripts.verify must end with exactly one "${e2eStep}" (got: ${steps.at(-1)}). ` +
      "Update .github/workflows/ci.yml and .github/scripts/verify-static-steps.mjs together.",
  );
}

console.log(steps.slice(0, -1).join(" && "));
