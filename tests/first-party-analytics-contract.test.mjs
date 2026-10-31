import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import {
  analyticsEvents,
  analyticsProducts,
  isAnalyticsEvent,
  normalizeAnalyticsRoute,
  projectAnalyticsSnapshot,
} from "../src/lib/analytics/contract.ts";

const now = "2026-10-25T12:00:00Z";
const options = { now, maxAgeMs: 60_000 };
const snapshot = () => ({
  asOf: "2026-10-25T11:59:30Z",
  windowStart: "2026-10-25T11:00:00Z",
  windowEnd: "2026-10-25T11:59:00Z",
  counts: [
    { event: "page_view", product: "web", count: 12 },
    { event: "page_view", product: "fitness", count: 4 },
    { event: "page_view", product: "mazer", count: 3 },
    { event: "app_launch", product: "fitness", count: 100 },
  ],
});

test("fresh complete aggregate counts navigation page views only", () => {
  const input = snapshot();
  const projection = projectAnalyticsSnapshot(input, options);
  assert.deepEqual(projection.source, {
    status: "fresh",
    asOf: input.asOf,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });
  assert.deepEqual(projection.pageViews, {
    status: "available",
    total: 19,
    byProduct: { web: 12, fitness: 4, mazer: 3 },
  });
  assert.deepEqual(projection.uniqueVisitors, {
    status: "unavailable", reason: "identifier_contract_unavailable",
  });
  assert.deepEqual(projection.sessions, {
    status: "unavailable", reason: "identifier_contract_unavailable",
  });
  assert.deepEqual(projection.activeNow, {
    status: "unavailable", reason: "presence_contract_unavailable",
  });
  assert.equal(input.counts[0].count, 12, "projection does not mutate its source");
});

test("missing and stale sources never fabricate zero counts", () => {
  for (const missing of [null, undefined]) {
    const projection = projectAnalyticsSnapshot(missing, options);
    assert.deepEqual(projection.source, { status: "missing" });
    assert.deepEqual(projection.pageViews, { status: "unavailable", reason: "source_missing" });
    assert.equal(Object.hasOwn(projection.pageViews, "total"), false);
  }
  const stale = projectAnalyticsSnapshot(snapshot(), { now, maxAgeMs: 29_999 });
  assert.equal(stale.source.status, "stale");
  assert.deepEqual(stale.pageViews, { status: "unavailable", reason: "source_stale" });
  assert.equal(Object.hasOwn(stale.pageViews, "byProduct"), false);
  assert.equal(projectAnalyticsSnapshot(snapshot(), { now, maxAgeMs: 30_000 }).source.status, "fresh");
  const empty = projectAnalyticsSnapshot({ ...snapshot(), counts: [] }, options);
  assert.deepEqual(empty.pageViews, {
    status: "available", total: 0, byProduct: { web: 0, fitness: 0, mazer: 0 },
  });
});

test("malformed aggregate labels, counts, rows and freshness reject", () => {
  const changes = [
    (value) => { value.counts[0].event = "visitor"; },
    (value) => { value.counts[0].product = "other"; },
    (value) => { value.counts[0].count = -1; },
    (value) => { value.counts[0].count = 1.5; },
    (value) => { value.counts[0].count = Number.MAX_SAFE_INTEGER + 1; },
    (value) => { value.counts[0].count = "12"; },
    (value) => { value.counts[0].accountId = "private"; },
    (value) => { value.counts.push({ ...value.counts[0] }); },
    (value) => { value.counts = null; },
    (value) => { delete value.asOf; },
    (value) => { value.asOf = "2026-02-30T11:59:30Z"; },
    (value) => { value.asOf = "2026-10-25T12:00:01Z"; },
    (value) => { value.windowEnd = "2026-10-25T12:00:00Z"; },
    (value) => { value.windowStart = "2026-10-25T11:59:59Z"; },
    (value) => { value.visitorId = "private"; },
  ];
  for (const [index, change] of changes.entries()) {
    const value = snapshot();
    change(value);
    assert.throws(() => projectAnalyticsSnapshot(value, options), TypeError, `case ${index}`);
  }
  assert.throws(() => projectAnalyticsSnapshot(snapshot(), { now, maxAgeMs: 0 }), TypeError);
  assert.throws(() => projectAnalyticsSnapshot(snapshot(), { now: "not-a-date", maxAgeMs: 60_000 }), TypeError);
});

test("unsafe totals reject instead of overflowing", () => {
  const value = snapshot();
  value.counts = [
    { event: "page_view", product: "web", count: Number.MAX_SAFE_INTEGER },
    { event: "page_view", product: "fitness", count: 1 },
  ];
  assert.throws(() => projectAnalyticsSnapshot(value, options), /safe integer range/);
});

test("the closed event vocabulary and canonical website routes stay explicit", () => {
  assert.deepEqual(analyticsEvents, [
    "page_view", "tiktok_open", "catalog_app_view", "app_launch", "compatibility_visit",
  ]);
  assert.deepEqual(analyticsProducts, ["web", "fitness", "mazer"]);
  assert.equal(isAnalyticsEvent("unique_visitor"), false);
  assert.equal(normalizeAnalyticsRoute("/projects"), "/projects");
  assert.equal(normalizeAnalyticsRoute("/apps/fitness"), "/apps");
  assert.equal(normalizeAnalyticsRoute("/apps/mazer"), "/apps");
  assert.equal(normalizeAnalyticsRoute("/trove"), "/");
});

const clientSource = await readFile(
  new URL("../src/components/analytics/first-party-analytics.tsx", import.meta.url),
  "utf8",
);

function accountClientHarness(origin, pathname, endpoint = "https://collector.invalid") {
  const compiled = ts.transpileModule(clientSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sent = [];
  const moduleShim = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: moduleShim.exports,
    module: moduleShim,
    require: (name) => {
      if (name === "react") return { useEffect() {} };
      if (name === "@/lib/analytics/contract") return {};
      if (name === "@/config/account") return {
        isLocalAuthTestOrigin: (origin) => ["http://localhost:3210", "http://127.0.0.1:3210"].includes(origin),
      };
      throw new Error(`unreviewed client import: ${name}`);
    },
    process: { env: { NEXT_PUBLIC_FAWXZZY_ANALYTICS_URL: endpoint } },
    window: { location: { origin, pathname, href: `${origin}${pathname}` } },
    fetch: (url, options) => { sent.push({ url, options }); return Promise.resolve({ ok: true }); },
    URL,
  }, { filename: "first-party-analytics.tsx" });
  return { client: moduleShim.exports, sent };
}

test("account client counts only a resolved signed-in Projects view", () => {
  const { client } = accountClientHarness("https://account.fawxzzy.com", "/projects");
  for (const status of ["loading", "unknown", "unavailable", "signed-out"]) {
    assert.equal(client.shouldCountAccountProjectsPageView(true, true, status), false, status);
  }
  assert.equal(client.shouldCountAccountProjectsPageView(false, true, "idle"), false);
  assert.equal(client.shouldCountAccountProjectsPageView(true, false, "idle"), false);
  assert.equal(client.shouldCountAccountProjectsPageView(true, true, "unavailable"), false);
  assert.equal(client.shouldCountAccountProjectsPageView(true, true, "unknown"), false);
  // A late transition from signed-out to the adapter's known session is eligible once.
  assert.equal(client.shouldCountAccountProjectsPageView(true, false, "signed-out"), false);
  assert.equal(client.shouldCountAccountProjectsPageView(true, true, "idle"), true);
});

test("actual account helper sends only the exact configured origin and path tuple", () => {
  for (const [origin, pathname, endpoint, accepted] of [
    ["https://account.fawxzzy.com", "/projects", "https://collector.invalid", true],
    ["http://127.0.0.1:3210", "/projects?auth_test=session", "https://collector.invalid", true],
    ["https://fawxzzy.com", "/projects", "https://collector.invalid", false],
    ["https://account.fawxzzy.com", "/account", "https://collector.invalid", false],
    ["https://account.fawxzzy.com", "/projects/", "https://collector.invalid", false],
    ["http://127.0.0.1:3210", "/projects", "https://collector.invalid", false],
    ["http://127.0.0.1:3210", "/projects?auth_test=success", "https://collector.invalid", false],
    ["http://127.0.0.1:3210", "/account?auth_test=session", "https://collector.invalid", false],
    ["https://account.fawxzzy.com", "/projects", "", false],
  ]) {
    const { client, sent } = accountClientHarness(origin, pathname, endpoint);
    assert.equal(client.emitAccountProjectsPageView(), accepted, `${origin}${pathname}`);
    assert.equal(sent.length, Number(accepted));
    if (accepted) {
      assert.equal(sent[0].url, "https://collector.invalid");
      assert.deepEqual(JSON.parse(sent[0].options.body), {
        event: "page_view", product: "web", route: "/projects",
      });
      assert.equal(sent[0].options.credentials, "omit");
    }
  }
});

const edgeSource = await readFile(
  new URL("../supabase/functions/first-party-analytics/index.ts", import.meta.url),
  "utf8",
);

function edgeHarness() {
  const imports = (edgeSource.match(/^import [^\r\n]*;\r?$/gm) ?? []).map((line) => line.trimEnd());
  assert.deepEqual(imports, [
    'import "jsr:@supabase/functions-js/edge-runtime.d.ts";',
    'import { createClient } from "npm:@supabase/supabase-js@2";',
  ], "the handler has only the two reviewed imports, both replaced with local stubs");
  const executable = stripTypeScriptTypes(edgeSource.replace(/^import [^\r\n]*;\r?\n/gm, ""));
  const inserts = [];
  let handler;
  vm.runInNewContext(executable, {
    Deno: {
      env: { get: (key) => key === "SUPABASE_URL" ? "https://stub.invalid" : "stub-role-key" },
      serve: (callback) => { handler = callback; },
    },
    Response,
    createClient: () => ({
      schema: (schema) => {
        assert.equal(schema, "fawxzzy_analytics");
        return {
          from: (table) => {
            assert.equal(table, "events");
            return { insert: async (row) => { inserts.push(row); return { error: null }; } };
          },
        };
      },
    }),
  }, { filename: "first-party-analytics/index.ts" });
  assert.equal(typeof handler, "function", "test runs the actual Deno.serve handler");
  return { handler, inserts };
}

function edgeRequest(payload, origin = "https://fawxzzy.com") {
  return new Request("https://collector.invalid/", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(payload),
  });
}

test("actual Edge handler accepts one Web projects page view", async () => {
  const { handler, inserts } = edgeHarness();
  const response = await handler(edgeRequest({ event: "page_view", product: "web", route: "/projects" }));
  assert.equal(response.status, 202);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].route, "/projects");
  assert.equal(inserts[0].product, "web");
  assert.equal(inserts[0].event_name, "page_view");
  assert.deepEqual(Object.keys(inserts[0]).sort(), [
    "app", "compatibility_source", "event_name", "product", "route",
  ]);
});

test("actual Edge handler accepts only the identifier-free signed-in Projects tuple", async () => {
  const { handler, inserts } = edgeHarness();
  const response = await handler(edgeRequest(
    { event: "page_view", product: "web", route: "/projects" },
    "https://account.fawxzzy.com",
  ));
  assert.equal(response.status, 202);
  assert.equal(inserts.length, 1);
  assert.deepEqual(Object.keys(inserts[0]).sort(), [
    "app", "compatibility_source", "event_name", "product", "route",
  ]);
  assert.equal(inserts[0].event_name, "page_view");
  assert.equal(inserts[0].product, "web");
  assert.equal(inserts[0].route, "/projects");
  assert.equal(inserts[0].app, null);
  assert.equal(inserts[0].compatibility_source, null);
});

test("actual Edge handler rejects every other account-origin envelope", async () => {
  const origin = "https://account.fawxzzy.com";
  const cases = [
    { event: "page_view", product: "web", route: "/" },
    { event: "page_view", product: "web", route: "/account" },
    { event: "page_view", product: "fitness", route: "/projects" },
    { event: "app_launch", product: "web", route: "/projects" },
    { event: "page_view", product: "web", route: "/projects", app: "fitness" },
    { event: "page_view", product: "web", route: "/projects", compatibility: "fitness" },
    { event: "page_view", product: "web", route: "/projects", accountId: "private" },
  ];
  for (const payload of cases) {
    const { handler, inserts } = edgeHarness();
    const response = await handler(edgeRequest(payload, origin));
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.equal(inserts.length, 0, JSON.stringify(payload));
  }
});

test("actual Edge handler rejects unknown, forged, extra-field and disallowed-origin requests", async () => {
  const cases = [
    [{ event: "page_view", product: "web", route: "/unknown" }, "https://fawxzzy.com", 400],
    [{ event: "page_view", product: "fitness", route: "/projects" }, "https://fawxzzy.com", 400],
    [{ event: "page_view", product: "web", route: "/projects", accountId: "private" }, "https://fawxzzy.com", 400],
    [{ event: "page_view", product: "web", route: "/projects" }, "https://untrusted.invalid", 403],
  ];
  for (const [payload, origin, status] of cases) {
    const { handler, inserts } = edgeHarness();
    const response = await handler(edgeRequest(payload, origin));
    assert.equal(response.status, status, JSON.stringify(payload));
    assert.equal(inserts.length, 0, JSON.stringify(payload));
  }
});
