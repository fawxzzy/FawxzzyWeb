import assert from "node:assert/strict";
import test from "node:test";

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

test("the existing closed event and route vocabulary remains unchanged", () => {
  assert.deepEqual(analyticsEvents, [
    "page_view", "tiktok_open", "catalog_app_view", "app_launch", "compatibility_visit",
  ]);
  assert.deepEqual(analyticsProducts, ["web", "fitness", "mazer"]);
  assert.equal(isAnalyticsEvent("unique_visitor"), false);
  assert.equal(normalizeAnalyticsRoute("/apps/fitness"), "/apps");
  assert.equal(normalizeAnalyticsRoute("/trove"), "/");
});
