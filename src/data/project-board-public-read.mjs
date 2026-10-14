import { applyBoardEnvelope } from "./project-board-adapter.mjs";

// Inactive, one-shot transport seam. A caller must provide both a public URL
// and a fetch implementation; this module has no endpoint or request on import.
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

function publicJson(contentType) {
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return mime === "application/json" || /^application\/[a-z0-9.+_-]+\+json$/.test(mime ?? "");
}

async function readJsonBody(response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > MAX_RESPONSE_BYTES) throw new Error("oversized");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing body");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("invalid body chunk");
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("oversized");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new Error("empty body");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function fetchPublicEnvelope(config, signal) {
  const response = await config.fetchImpl(config.url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
    redirect: "manual",
    cache: "no-store",
    signal,
  });
  if (!response || response.redirected || response.status !== 200
    || !publicJson(response.headers?.get("content-type"))) {
    throw new Error("invalid public response");
  }
  return readJsonBody(response);
}

export function createPublicBoardReader(initialState, config = null) {
  const disabled = config === null || config === undefined || config.enabled === false;
  if (!disabled && (typeof config.url !== "string" || !config.url.trim()
    || typeof config.fetchImpl !== "function")) {
    throw new TypeError("Public board reader requires an explicit URL and fetch implementation");
  }
  const timeoutMs = disabled ? DEFAULT_TIMEOUT_MS : (config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError("Invalid public board read timeout");
  }

  let state = structuredClone(initialState);
  let latestRequest = 0;
  const getState = () => structuredClone(state);

  async function refresh({ signal: externalSignal } = {}) {
    if (disabled) return getState();
    const requestId = ++latestRequest;
    if (externalSignal?.aborted) {
      state = { ...state, health: "unavailable", reason: "PUBLIC_HTTP_UNAVAILABLE" };
      return getState();
    }
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const aborted = new Promise((_, reject) => {
      if (controller.signal.aborted) reject(new Error("aborted"));
      else controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const envelope = await Promise.race([fetchPublicEnvelope(config, controller.signal), aborted]);
      if (requestId === latestRequest && !controller.signal.aborted) {
        state = applyBoardEnvelope(state, envelope);
      }
    } catch {
      // No raw URL, HTTP body, provider error, or parse exception reaches state.
      if (requestId === latestRequest) {
        state = { ...state, health: "unavailable", reason: "PUBLIC_HTTP_UNAVAILABLE" };
      }
      controller.abort();
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
    return getState();
  }

  return { getState, refresh };
}
