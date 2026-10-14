import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { boardView, initialBoardState } from "../src/data/project-board-adapter.mjs";
import { createPublicBoardReader } from "../src/data/project-board-public-read.mjs";

const preview = JSON.parse(await readFile(new URL("../src/data/project-board-preview.generated.json", import.meta.url), "utf8"));
const publicSnapshot = structuredClone(preview);
publicSnapshot.sourceKind = "synthetic public HTTP reader test";
publicSnapshot.publicationReady = true;
publicSnapshot.boards[0].cards = [{
  id: "SYNTHETIC-READ-001",
  sourceProjectId: "fitness",
  component: null,
  sourceRevision: `sha256:${"a".repeat(64)}`,
  owner: "synthetic-test-owner",
  title: "Synthetic reader card",
  summary: "Test-only public card, never an actual project status.",
  lifecycle: "planning",
  workType: "test",
  priority: null,
  dependencies: [],
  parentId: null,
  duplicateOf: null,
  supersededBy: null,
  updatedAt: "2026-10-14T00:00:00.000Z",
}];
const envelope = (snapshot = publicSnapshot, revision = "rev-1", previousRevision = null) => ({
  schema: "fawxzzyweb.project-board.adapter-envelope.v1",
  health: "healthy",
  projectionRevision: revision,
  previousRevision,
  sourceWatermark: `watermark-${revision}`,
  generatedAt: "2026-10-14T18:00:00.000Z",
  snapshot,
});
const jsonResponse = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});
const start = () => initialBoardState(preview);
const configured = (fetchImpl, extra = {}) => createPublicBoardReader(start(), {
  url: "https://public.example.test/boards",
  fetchImpl,
  ...extra,
});

test("absent or disabled configuration performs zero requests and preserves the preview", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error("global fetch must never run"); };
  try {
    for (const config of [undefined, {
      enabled: false,
      url: "https://public.example.test/boards",
      fetchImpl: () => { calls += 1; },
    }]) {
      const reader = createPublicBoardReader(start(), config);
      const result = await reader.refresh();
      assert.equal(result.health, "stale");
      assert.equal(result.lastSuccessfulAt, null);
      assert.equal(result.lastAccepted.boards.every((board) => board.cards.length === 0), true);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.throws(() => createPublicBoardReader(start(), { url: "https://public.example.test/boards" }), /explicit URL and fetch/);
});

test("one explicit public read delegates acceptance, identity and freshness to the adapter", async () => {
  let calls = 0;
  const reader = configured(async (url, options) => {
    calls += 1;
    assert.equal(url, "https://public.example.test/boards");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Accept, "application/json");
    return jsonResponse(envelope());
  });
  assert.equal(calls, 0);
  const accepted = await reader.refresh();
  assert.equal(calls, 1);
  assert.equal(accepted.health, "healthy");
  assert.equal(accepted.projectionRevision, "rev-1");
  assert.equal(accepted.lastSuccessfulAt, "2026-10-14T18:00:00.000Z");
  assert.equal(boardView(accepted).authoritative, true);
  assert.equal(accepted.lastAccepted.boards[0].cards[0].id, "SYNTHETIC-READ-001");
  accepted.lastAccepted.boards[0].cards[0].title = "caller mutation";
  assert.equal(reader.getState().lastAccepted.boards[0].cards[0].title, "Synthetic reader card");
  assert.equal((await reader.refresh()).lastSuccessfulAt, "2026-10-14T18:00:00.000Z");
});

test("private, unapproved and malformed JSON envelopes stay hidden without response prose", async () => {
  const privateSnapshot = structuredClone(publicSnapshot);
  privateSnapshot.boards[0].cards[0].evidence = "PRIVATE RESPONSE PROSE";
  const unapproved = structuredClone(publicSnapshot);
  unapproved.publicationReady = false;
  for (const [payload, reason] of [
    [envelope(privateSnapshot), "INVALID_OR_EMPTY_SNAPSHOT"],
    [envelope(unapproved), "PUBLICATION_NOT_APPROVED"],
    [{ secret: "PRIVATE RESPONSE PROSE" }, "INVALID_ENVELOPE"],
  ]) {
    const state = await configured(async () => jsonResponse(payload)).refresh();
    assert.equal(state.health, "incompatible");
    assert.equal(state.reason, reason);
    assert.deepEqual(boardView(state).boards, []);
    assert.doesNotMatch(JSON.stringify(state), /PRIVATE RESPONSE PROSE/);
  }
  let calls = 0;
  const reader = configured(async () => jsonResponse(++calls === 1
    ? envelope() : envelope(privateSnapshot, "rev-2", "rev-1")));
  const accepted = await reader.refresh();
  const rejected = await reader.refresh();
  assert.equal(rejected.health, "incompatible");
  assert.equal(rejected.lastSuccessfulAt, accepted.lastSuccessfulAt);
  assert.deepEqual(rejected.lastAccepted, accepted.lastAccepted);
  assert.deepEqual(boardView(rejected).boards, []);
});

test("HTTP, redirect and content errors preserve last accepted data but remove authority", async () => {
  const failures = [
    () => new Response("PRIVATE HTTP PROSE", { status: 503, headers: { "Content-Type": "text/plain" } }),
    () => new Response(null, { status: 302, headers: { Location: "https://other.example.test/private" } }),
    () => new Response("PRIVATE HTTP PROSE", { status: 200, headers: { "Content-Type": "text/html" } }),
    () => new Response('{"secret":"PRIVATE HTTP PROSE"', { status: 200, headers: { "Content-Type": "application/json" } }),
  ];
  for (const failingResponse of failures) {
    let calls = 0;
    const reader = configured(async () => (++calls === 1 ? jsonResponse(envelope()) : failingResponse()));
    const accepted = await reader.refresh();
    const failed = await reader.refresh();
    assert.equal(failed.health, "unavailable");
    assert.equal(failed.reason, "PUBLIC_HTTP_UNAVAILABLE");
    assert.equal(failed.lastSuccessfulAt, accepted.lastSuccessfulAt);
    assert.deepEqual(failed.lastAccepted, accepted.lastAccepted);
    assert.deepEqual(boardView(failed).boards, []);
    assert.doesNotMatch(JSON.stringify(failed), /PRIVATE HTTP PROSE/);
  }
});

test("oversized, truncated and broken response bodies cannot become current truth", async () => {
  const broken = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"secret":"PRIVATE BODY PROSE"'));
      controller.error(new Error("PRIVATE BODY PROSE"));
    },
  });
  for (const response of [
    new Response("x".repeat(1024 * 1024 + 1), { headers: { "Content-Type": "application/json" } }),
    new Response("{\"schema\":", { headers: { "Content-Type": "application/json" } }),
    new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } }),
    new Response(broken, { headers: { "Content-Type": "application/json" } }),
  ]) {
    const state = await configured(async () => response).refresh();
    assert.equal(state.health, "unavailable");
    assert.deepEqual(boardView(state).boards, []);
    assert.doesNotMatch(JSON.stringify(state), /PRIVATE BODY PROSE/);
  }
});

test("stale source revision retains accepted cards without current-truth authority", async () => {
  let calls = 0;
  const reader = configured(async () => jsonResponse(++calls === 1
    ? envelope() : envelope(publicSnapshot, "rev-2", "wrong-parent")));
  const accepted = await reader.refresh();
  const stale = await reader.refresh();
  assert.equal(stale.health, "reconciling");
  assert.equal(stale.projectionRevision, "rev-1");
  assert.equal(stale.lastSuccessfulAt, accepted.lastSuccessfulAt);
  assert.equal(boardView(stale).authoritative, false);
  assert.equal(boardView(stale).boards[0].cards[0].id, "SYNTHETIC-READ-001");
});

test("late older success cannot overwrite a newer accepted refresh", async () => {
  const waiting = [];
  const reader = configured(() => new Promise((resolve) => waiting.push(resolve)));
  const older = reader.refresh();
  const newer = reader.refresh();
  waiting[1](jsonResponse(envelope(publicSnapshot, "rev-2")));
  assert.equal((await newer).projectionRevision, "rev-2");
  waiting[0](jsonResponse(envelope(publicSnapshot, "rev-1")));
  assert.equal((await older).projectionRevision, "rev-2");
  assert.equal(reader.getState().sourceWatermark, "watermark-rev-2");
});

test("abort and timeout fail closed even when injected fetch ignores cancellation", async () => {
  let calls = 0;
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const preAborted = configured(() => { calls += 1; return jsonResponse(envelope()); });
  assert.equal((await preAborted.refresh({ signal: alreadyAborted.signal })).health, "unavailable");
  assert.equal(calls, 0);

  let resolveLate;
  const abortedReader = configured(() => new Promise((resolve) => { resolveLate = resolve; }));
  const controller = new AbortController();
  const pending = abortedReader.refresh({ signal: controller.signal });
  controller.abort();
  assert.equal((await pending).health, "unavailable");
  let lateCancelCalls = 0;
  const lateBody = new ReadableStream({ cancel() { lateCancelCalls += 1; } });
  resolveLate(new Response(lateBody, { headers: { "Content-Type": "application/json" } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(abortedReader.getState().projectionRevision, null);
  assert.equal(lateCancelCalls, 1);
  assert.equal(lateBody.locked, false);

  const timedOut = configured(() => new Promise(() => {}), { timeoutMs: 10 });
  assert.equal((await timedOut.refresh()).health, "unavailable");
  assert.equal(timedOut.getState().lastSuccessfulAt, null);

  let requests = 0;
  const newerWins = configured(() => ++requests === 1
    ? new Promise(() => {}) : Promise.resolve(jsonResponse(envelope())), { timeoutMs: 10 });
  const olderTimedOut = newerWins.refresh();
  assert.equal((await newerWins.refresh()).health, "healthy");
  assert.equal((await olderTimedOut).health, "healthy");
  assert.equal(newerWins.getState().projectionRevision, "rev-1");
});

test("timeout cancels a stalled response body and releases its stream lock", async () => {
  let cancelCalls = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"schema":'));
    },
    cancel() { cancelCalls += 1; },
  });
  const response = new Response(body, { headers: { "Content-Type": "application/json" } });
  const reader = configured(async () => response, { timeoutMs: 10 });
  const state = await reader.refresh();
  assert.equal(state.health, "unavailable");
  assert.deepEqual(boardView(state).boards, []);
  assert.equal(cancelCalls, 1);
  assert.equal(body.locked, false);
});

test("explicit abort cancels an acquired stalled body without accepting late data", async () => {
  let cancelCalls = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"schema":'));
    },
    cancel() { cancelCalls += 1; },
  });
  const response = new Response(body, { headers: { "Content-Type": "application/json" } });
  const reader = configured(async () => response);
  const controller = new AbortController();
  const pending = reader.refresh({ signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(body.locked, true);
  controller.abort();
  const state = await pending;
  assert.equal(state.health, "unavailable");
  assert.deepEqual(boardView(state).boards, []);
  assert.equal(cancelCalls, 1);
  assert.equal(body.locked, false);
  assert.equal(reader.getState().projectionRevision, null);
});

test("rejected and declared-oversized responses discard their bodies", async () => {
  for (const headers of [
    { "Content-Type": "text/html" },
    { "Content-Type": "application/json", "Content-Length": String(1024 * 1024 + 1) },
  ]) {
    let cancelCalls = 0;
    const body = new ReadableStream({ cancel() { cancelCalls += 1; } });
    const state = await configured(async () => new Response(body, { headers })).refresh();
    assert.equal(state.health, "unavailable");
    assert.deepEqual(boardView(state).boards, []);
    assert.equal(cancelCalls, 1);
    assert.equal(body.locked, false);
  }
});
