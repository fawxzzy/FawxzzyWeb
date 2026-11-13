import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const functionDirectory = resolve("supabase/functions/username-password-signin");
let counter = 0;

/**
 * Loads the REAL supabase/functions/username-password-signin/index.ts and returns the handler it registers with
 * Deno.serve. The Deno runtime, the global fetch and the supabase-js client are replaced by the supplied fakes, so the
 * production request flow (header parsing, key derivation, throttle check, password check, failure/success notes) is
 * executed unchanged. Nothing is rewritten except the three runtime bindings and the relative import specifiers.
 */
export async function loadSigninHandler({ createClient, env, fetchImpl }) {
  const source = readFileSync(join(functionDirectory, "index.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "index.ts",
  });
  const id = `signin-${process.pid}-${counter += 1}`;
  let handler = null;
  globalThis.__signinTestContexts ??= new Map();
  globalThis.__signinTestContexts.set(id, {
    Deno: { env: { get: (name) => env[name] }, serve: (registered) => { handler = registered; } },
    createClient,
    fetch: fetchImpl,
  });
  const supabaseImport = 'import { createClient } from "npm:@supabase/supabase-js@2.109.0";';
  if (!outputText.includes(supabaseImport)) throw new Error("index.ts supabase-js import changed; update the helper");
  const rewritten = outputText
    .replace(supabaseImport, "")
    .replace(/from "\.\/([a-z-]+\.mjs)"/g, (_match, file) => `from "${pathToFileURL(join(functionDirectory, file)).href}"`);
  const prelude = [
    `const __ctx = globalThis.__signinTestContexts.get(${JSON.stringify(id)});`,
    "const Deno = __ctx.Deno;",
    "const createClient = (...args) => __ctx.createClient(...args);",
    "const fetch = (...args) => __ctx.fetch(...args);",
  ].join("\n");
  const directory = mkdtempSync(join(tmpdir(), "signin-handler-"));
  const file = join(directory, "index.mjs");
  writeFileSync(file, `${prelude}\n${rewritten}`);
  try {
    await import(pathToFileURL(file).href);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  if (typeof handler !== "function") throw new Error("index.ts did not register a handler with Deno.serve");
  return handler;
}
