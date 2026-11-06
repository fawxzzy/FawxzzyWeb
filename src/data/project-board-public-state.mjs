import { applyBoardEnvelope, initialBoardState } from "./project-board-adapter.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Small deterministic content fingerprint (cyrb53). This module also runs in the
// browser bundle, so it avoids node:crypto. The value is an opaque revision
// label for the adapter's idempotency checks, not a security digest.
function fingerprint(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

// Applies the committed, owner-approved snapshot through the existing adapter
// exactly like a first healthy transport envelope would. Deterministic: the
// revision is a content fingerprint and generatedAt is the approval date, so the
// static export is reproducible. Throws (failing the build) if the adapter does
// not accept the snapshot as healthy.
export function buildPublicBoardState(emptyPreview, snapshot) {
  const watermark = [...new Map(snapshot.boards.flatMap((board) => board.cards)
    .map((card) => [card.sourceProjectId, card.sourceRevision])).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([project, revision]) => `${project}@${revision.slice(0, 19)}`).join(",");
  const state = applyBoardEnvelope(initialBoardState(emptyPreview), {
    schema: "fawxzzyweb.project-board.adapter-envelope.v1",
    health: "healthy",
    projectionRevision: `public-snapshot:${snapshot.preparedAt}:${fingerprint(canonical(snapshot))}`,
    previousRevision: null,
    sourceWatermark: watermark,
    generatedAt: `${snapshot.preparedAt}T00:00:00.000Z`,
    snapshot,
  });
  if (state.health !== "healthy") throw new Error(`Public board snapshot rejected: ${state.reason}`);
  return state;
}
