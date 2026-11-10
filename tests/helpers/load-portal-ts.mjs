import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

/**
 * Evaluates the portal's real TypeScript/ESM source (src/config/account.ts,
 * src/lib/auth/callback-contract.ts, ...) in a CommonJS sandbox with the "@/"
 * alias, so contract tests run the actual route logic instead of a copy.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".json"];
const cache = new Map();

function resolveFile(specifier, fromFile) {
  const base = specifier.startsWith("@/")
    ? resolve(root, "src", specifier.slice(2))
    : resolve(dirname(fromFile), specifier);
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && !candidate.endsWith(".")) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        // directory; try the next extension
      }
    }
  }
  throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
}

function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const source = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    mod.exports = JSON.parse(source);
    return mod.exports;
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file.replace(/\.mjs$/, ".ts"),
  });
  const localRequire = (specifier) => {
    if (specifier.startsWith("@/") || specifier.startsWith(".")) return load(resolveFile(specifier, file));
    throw new Error(`Unexpected bare import ${specifier} in ${file}`);
  };
  vm.runInThisContext(`(function (exports, require, module) {${outputText}\n})`, { filename: file })(
    mod.exports,
    localRequire,
    mod,
  );
  return mod.exports;
}

export function loadPortalModule(relativeFromRoot) {
  return load(resolve(root, relativeFromRoot));
}
