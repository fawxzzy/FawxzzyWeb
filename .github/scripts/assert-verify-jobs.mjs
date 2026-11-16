// Aggregator for the required `verify` check: reads the `needs` context (JSON on stdin) and exits non-zero
// unless every needed job finished with result "success". A skipped, cancelled or failed dependency fails it.
import { readFileSync } from "node:fs";

const expectedJobs = ["static-checks", "e2e", "visual-evidence", "lifeline-container"];
const needs = JSON.parse(readFileSync(0, "utf8"));

let ok = true;
for (const job of expectedJobs) {
  const result = needs[job]?.result ?? "missing";
  console.log(`${job}: ${result}`);
  if (result !== "success") ok = false;
}

for (const job of Object.keys(needs)) {
  if (!expectedJobs.includes(job)) {
    console.log(`unexpected needed job: ${job}`);
    ok = false;
  }
}

process.exit(ok ? 0 : 1);
