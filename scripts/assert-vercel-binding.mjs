#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERCEL_PRODUCTION_CONTRACT,
  assertReleaseSource,
  assertVercelBinding,
  parseNamedArguments,
  readVercelBinding,
} from "./vercel-production-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseNamedArguments(process.argv.slice(2));
const expectedCommit = values.get("--expected-commit");
const binding = assertVercelBinding(readVercelBinding(repoRoot));
const source = assertReleaseSource({ repoRoot, expectedCommit });

console.log(JSON.stringify({
  status: "binding_verified",
  repository: VERCEL_PRODUCTION_CONTRACT.repository,
  source,
  destination: {
    teamId: binding.orgId,
    projectId: binding.projectId,
    projectName: binding.projectName,
  },
  mutation: "none",
}, null, 2));
