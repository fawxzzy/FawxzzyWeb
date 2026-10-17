// Local, source-only handoff for a future approved public projection. This is
// not the private operations-board contract or a browser database client.
const BOARD_IDS = ["fitness", "mazer", "trove", "atlas-stack"];
const ATLAS_COMPONENTS = {
  _stack: "Stack", atlas: "Atlas", cortex: "Cortex", foundation: "Foundation",
  lifeline: "Lifeline", playbook: "Playbook", "socials-os": "Socials OS",
};
const CARD_FIELDS = [
  "component", "dependencies", "duplicateOf", "id", "lifecycle", "owner",
  "parentId", "priority", "sourceProjectId", "sourceRevision", "summary",
  "supersededBy", "title", "updatedAt", "workType",
];
const LIFECYCLES = new Set([
  "intake", "planning", "ready", "opened", "in_progress", "active", "running",
  "review", "accepted", "blocked", "held", "completed", "complete", "closed",
  "archived", "retired",
]);
const HEALTH = new Set(["healthy", "stale", "reconciling", "unavailable", "incompatible"]);
const HASH = /^sha256:[a-f0-9]{64}$/;

function sameFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function nonempty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function instant(value) {
  const date = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value)
    : null;
  if (!date || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function canonicalContent(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalContent).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalContent(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cardIdentity(card) {
  return `${card.sourceProjectId}:${card.id}`;
}

export function resolveVisibleSelection(cards, identity) {
  return identity === null ? null : cards.find((card) => cardIdentity(card) === identity) ?? null;
}

// Owner exports may use bare IDs. Resolve those in the referring project first;
// a cross-project bare ID is linkable only when unique in this projection.
export function resolveCardReference(cards, sourceProjectId, reference) {
  const qualified = cards.find((card) => cardIdentity(card) === reference);
  if (qualified) return qualified;
  const local = cards.find((card) => card.sourceProjectId === sourceProjectId && card.id === reference);
  if (local) return local;
  const matches = cards.filter((card) => card.id === reference);
  return matches.length === 1 ? matches[0] : null;
}

// Detail rows retain the source reference when this limited projection has no
// unambiguous target. Their keys never depend on a possibly absent card.
export function resolveDetailDependency(cards, sourceProjectId, reference, index) {
  return {
    key: `${index}:${reference}`,
    target: resolveCardReference(cards, sourceProjectId, reference),
  };
}

export function validateFourBoardSnapshot(snapshot, { allowEmptyPreview = false } = {}) {
  if (!sameFields(snapshot, ["boards", "preparedAt", "publicationReady", "schema", "sourceKind"])
    || snapshot.schema !== "fawxzzy.project-board.public-preview.v1"
    || typeof snapshot.preparedAt !== "string"
    || !instant(`${snapshot.preparedAt}T00:00:00Z`)
    || typeof snapshot.publicationReady !== "boolean"
    || !nonempty(snapshot.sourceKind)
    || !Array.isArray(snapshot.boards)
    || JSON.stringify(snapshot.boards.map((board) => board.id)) !== JSON.stringify(BOARD_IDS)) {
    throw new Error("Invalid four-board public snapshot");
  }
  const identities = new Set();
  const sourceRevisions = new Map();
  for (const board of snapshot.boards) {
    if (!sameFields(board, ["id", "name", "cards"]) || !nonempty(board.name) || !Array.isArray(board.cards)) {
      throw new Error("Invalid public board");
    }
    for (const card of board.cards) {
      if (!sameFields(card, CARD_FIELDS) || !nonempty(card.id) || !nonempty(card.sourceProjectId)
        || !nonempty(card.owner) || !nonempty(card.title) || !nonempty(card.summary)
        || !nonempty(card.workType) || !LIFECYCLES.has(card.lifecycle)
        || typeof card.sourceRevision !== "string" || !HASH.test(card.sourceRevision) || !instant(card.updatedAt)
        || !Array.isArray(card.dependencies) || card.dependencies.some((id) => !nonempty(id))
        || ["priority", "parentId", "duplicateOf", "supersededBy"].some((key) => card[key] !== null && !nonempty(card[key]))
        || (board.id === "atlas-stack" ? ATLAS_COMPONENTS[card.sourceProjectId] !== card.component : card.component !== null)
        || (board.id !== "atlas-stack" && card.sourceProjectId !== board.id)) {
        throw new Error("Invalid public card shape or source identity");
      }
      const identity = cardIdentity(card);
      if (identities.has(identity)) throw new Error("Duplicate public card identity");
      if (sourceRevisions.has(card.sourceProjectId)
        && sourceRevisions.get(card.sourceProjectId) !== card.sourceRevision) {
        throw new Error("Mixed revisions for one source project");
      }
      identities.add(identity);
      sourceRevisions.set(card.sourceProjectId, card.sourceRevision);
    }
  }
  // Public snapshots may link only to cards present in the same sanitized
  // snapshot. A missing target could reveal a private or unapproved card ID
  // through the payload even when the renderer hides its label.
  const cards = snapshot.boards.flatMap((board) => board.cards);
  for (const card of cards) {
    for (const reference of [
      ...card.dependencies, card.parentId, card.duplicateOf, card.supersededBy,
    ]) {
      if (reference !== null && !resolveCardReference(cards, card.sourceProjectId, reference)) {
        throw new Error("Public card relationship target is not visible");
      }
    }
  }
  if (identities.size === 0 && !(allowEmptyPreview && !snapshot.publicationReady)) {
    throw new Error("Empty public projection");
  }
  return snapshot;
}

export function initialBoardState(snapshot) {
  validateFourBoardSnapshot(snapshot, { allowEmptyPreview: true });
  if (!snapshot.publicationReady && snapshot.boards.some((board) => board.cards.length > 0)) {
    throw new Error("Unapproved preview contains cards");
  }
  return {
    health: "stale",
    lastAccepted: structuredClone(snapshot),
    lastSuccessfulAt: null,
    projectionRevision: null,
    sourceWatermark: null,
    reason: "STATIC_PREVIEW_NOT_CURRENT_TRUTH",
  };
}

export function boardView(state) {
  const visible = state.health === "healthy" || state.health === "stale" || state.health === "reconciling";
  return {
    health: state.health,
    authoritative: state.health === "healthy",
    boards: visible ? state.lastAccepted.boards : [],
    lastSuccessfulAt: state.lastSuccessfulAt,
    sourceWatermark: state.sourceWatermark,
    reason: state.reason,
  };
}

// The envelope is an adapter seam only. Its exact transport and public schema
// still require the protected data-contract owner's acceptance.
export function applyBoardEnvelope(state, envelope) {
  const hold = (health, reason) => ({ ...state, health, reason });
  if (!sameFields(envelope, ["schema", "health", "projectionRevision", "previousRevision", "sourceWatermark", "generatedAt", "snapshot"])
    || envelope.schema !== "fawxzzyweb.project-board.adapter-envelope.v1"
    || !HEALTH.has(envelope.health) || !nonempty(envelope.projectionRevision)
    || (envelope.previousRevision !== null && !nonempty(envelope.previousRevision))
    || !nonempty(envelope.sourceWatermark) || !instant(envelope.generatedAt)) {
    return hold("incompatible", "INVALID_ENVELOPE");
  }
  if (envelope.health !== "healthy") return hold(envelope.health, `SOURCE_${envelope.health.toUpperCase()}`);
  try {
    validateFourBoardSnapshot(envelope.snapshot, { allowEmptyPreview: true });
  } catch {
    return hold("incompatible", "INVALID_OR_EMPTY_SNAPSHOT");
  }
  if (!envelope.snapshot.publicationReady) return hold("incompatible", "PUBLICATION_NOT_APPROVED");
  if (envelope.projectionRevision === state.projectionRevision) {
    if (canonicalContent(envelope.snapshot) !== canonicalContent(state.lastAccepted)
      || envelope.sourceWatermark !== state.sourceWatermark) {
      return hold("incompatible", "REVISION_CONTENT_CONFLICT");
    }
    if (state.lastSuccessfulAt && Date.parse(envelope.generatedAt) < Date.parse(state.lastSuccessfulAt)) {
      return hold("reconciling", "BACKDATED_GENERATION");
    }
    return state.health === "healthy" ? state : { ...state, health: "healthy", reason: null };
  }
  if (envelope.previousRevision !== state.projectionRevision) return hold("reconciling", "STALE_OR_FORKED_REVISION");
  if (state.lastSuccessfulAt && Date.parse(envelope.generatedAt) < Date.parse(state.lastSuccessfulAt)) {
    return hold("reconciling", "BACKDATED_GENERATION");
  }
  return {
    health: "healthy",
    lastAccepted: structuredClone(envelope.snapshot),
    lastSuccessfulAt: envelope.generatedAt,
    projectionRevision: envelope.projectionRevision,
    sourceWatermark: envelope.sourceWatermark,
    reason: null,
  };
}
