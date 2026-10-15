import { validateView } from './display-contract.mjs';

export const OBSERVATION_MS = 60_000;
const REQUEST_MS = 10_000;
const BYTE_LIMIT = 1_048_576;
const reject = () => { throw new Error('OPS_UNAVAILABLE'); };

// Shared across component remounts and identities. Reads also occupy the gate:
// a denied read can clear the HttpOnly cookie, just as a session write can set it.
// The gate is not an authorization boundary; the server binds every cookie digest
// to the currently authenticated subject and Auth session.
export function createTransportGate() {
  return { pending: null, uncertain: false, listeners: new Set() };
}
const browserGate = createTransportGate();
function notify(gate) { for (const listener of gate.listeners) listener(); }

async function readEmptyAcknowledgment(response, current) {
  const length = response.headers.get('content-length');
  if (length !== null && length !== '0') reject();
  // Actual browser Fetch can expose a nonnull stream for 204; Node's Response
  // constructor does not. Verify zero bytes, not JavaScript body identity.
  if (response.body === null) return;
  const reader = response.body.getReader();
  try {
    for (let i = 0; i < 16; i++) {
      const part = await reader.read();
      if (!current()) reject();
      if (part.done) return;
      if (part.value.byteLength !== 0) reject();
    }
    reject();
  } finally {
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

export async function readResponseJson(response, current = () => true) {
  if (response.redirected || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(response.headers.get('content-type') ?? '')) reject();
  const length = response.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/u.test(length) || Number(length) > BYTE_LIMIT)) reject();
  if (!response.body) reject();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0; let text = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (!current()) reject();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > BYTE_LIMIT) reject();
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    if (!current()) reject();
    return JSON.parse(text);
  } finally {
    // Never await a peer-controlled stream's cancellation.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Trusted dependency injection is for local tests, never URL/config input. */
export function createOperationsReader({ adapter, origin, localTest = false,
  fetchImpl = globalThis.fetch, gate = browserGate, now = Date.now,
  monotonic = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  requestMs = REQUEST_MS }) {
  const localOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000',
    'http://localhost:3210', 'http://127.0.0.1:3210', 'http://localhost:4312',
    'http://127.0.0.1:4312', 'http://localhost:4313', 'http://127.0.0.1:4313']);
  const enabled = adapter && (adapter.kind === 'supabase' && origin === 'https://account.fawxzzy.com'
    || adapter.kind === 'test' && localTest === true && localOrigins.has(origin));
  let state = { status: 'loading', session: 'unverified', signedIn: false,
    pending: false, uncertain: false, view: null, observedAt: null };
  let userId = null; let epoch = 0; let visible = true; let disposed = false;
  let started = false; let unsubscribeAuth = () => {}; let expiryTimer = null; let startTimer = null;
  let displayDeadline = 0; let displayedGeneration = null;
  const listeners = new Set();
  const emit = (patch) => {
    if (disposed) return;
    state = { ...state, ...patch, pending: gate.pending !== null, uncertain: gate.uncertain };
    for (const listener of listeners) listener();
  };
  const erase = (patch = {}) => {
    if (expiryTimer !== null) clearTimer(expiryTimer);
    expiryTimer = null; displayDeadline = 0; displayedGeneration = null;
    emit({ view: null, observedAt: null, ...patch });
  };
  const gateChanged = () => {
    if (gate.pending && state.status !== 'unknown') erase({ status: 'loading' });
    else emit({});
  };
  gate.listeners.add(gateChanged);
  function authChanged(session) {
    if (startTimer !== null) clearTimer(startTimer);
    epoch++;
    userId = session?.userId ?? null;
    gate.uncertain = true;
    erase({ signedIn: Boolean(userId), session: 'unverified', status: userId ? 'idle' : 'signed-out' });
    notify(gate);
  }
  function checkDisplay() {
    if (state.view && (!visible || monotonic() >= displayDeadline
      || !displayedGeneration || adapter.getAuthGeneration() !== displayedGeneration)) {
      erase({ status: 'expired' });
    }
  }
  async function start() {
    if (started || disposed) return;
    started = true;
    if (!enabled) { erase({ status: 'unavailable' }); return; }
    unsubscribeAuth = adapter.onSessionChange(authChanged);
    const currentEpoch = epoch; const generation = adapter.getAuthGeneration();
    startTimer = setTimer(() => {
      if (!disposed && epoch === currentEpoch) { epoch++; erase({ status: 'unavailable' }); }
    }, requestMs);
    try {
      const session = await adapter.getSession();
      if (disposed || currentEpoch !== epoch) return;
      if (!generation || generation !== adapter.getAuthGeneration()) {
        erase({ status: 'unavailable' }); return;
      }
      userId = session?.userId ?? null;
      erase({ signedIn: Boolean(userId), status: userId ? 'idle' : 'signed-out' });
    } catch { if (!disposed && currentEpoch === epoch) erase({ status: 'unavailable' }); }
    finally { clearTimer(startTimer); startTimer = null; }
  }
  async function run(action) {
    checkDisplay();
    if (disposed || !enabled || !visible || !userId || gate.pending) return;
    if (action !== 'read' && gate.uncertain) return;
    if (action === 'close' && state.session !== 'open') return;
    if (action === 'open' && state.session === 'open') return;
    const generation = adapter.getAuthGeneration();
    if (!generation) { erase({ status: 'unavailable', session: 'unverified' }); return; }
    const capturedUser = userId; const capturedEpoch = epoch; const attempt = {};
    let timedOut = false; let sent = false;
    const current = () => !disposed && visible && !timedOut && epoch === capturedEpoch
      && userId === capturedUser && generation === adapter.getAuthGeneration();
    const assertCurrent = () => { if (!current()) reject(); };
    gate.pending = attempt;
    erase({ status: 'loading' }); notify(gate);
    let finishTimeout;
    const timeout = new Promise((resolve) => { finishTimeout = resolve; });
    const timer = setTimer(() => {
      timedOut = true;
      // No abort/retry assumption. Keep the transport gate until the actual
      // request settles; an old response can still write the browser cookie.
      gate.uncertain = true;
      erase({ status: 'unknown', session: 'unverified' }); notify(gate);
      finishTimeout();
    }, requestMs);
    const work = (async () => {
      try {
        const session = await adapter.getSession(); assertCurrent();
        if (session?.userId !== capturedUser) reject();
        const bearer = await adapter.getOAuthAccessToken(capturedUser); assertCurrent();
        if (typeof bearer !== 'string' || bearer.length < 16 || bearer.length > 16_384 || /[^\x21-\x7e]/u.test(bearer)) reject();
        const checked = await adapter.getSession(); assertCurrent();
        if (checked?.userId !== capturedUser) reject();
        const method = action === 'read' ? 'GET' : action === 'open' ? 'POST' : 'DELETE';
        sent = true;
        const response = await fetchImpl(`${origin}/api/operations/${action === 'read' ? 'read' : 'session'}`, {
          method, credentials: 'include', cache: 'no-store', redirect: 'error', mode: 'same-origin',
          headers: { Authorization: `Bearer ${bearer}`, 'X-Fawxzzy-Operations': '1' },
        });
        assertCurrent();
        if (response.redirected) reject();
        if (action !== 'read' && response.status === 204) {
          await readEmptyAcknowledgment(response, current); assertCurrent();
          const acknowledgedSession = await adapter.getSession(); assertCurrent();
          if (acknowledgedSession?.userId !== capturedUser) reject();
          gate.uncertain = false;
          erase({ status: action === 'open' ? 'opened' : 'closed', session: action === 'open' ? 'open' : 'closed' });
          return;
        }
        const value = await readResponseJson(response, current); assertCurrent();
        const finalSession = await adapter.getSession(); assertCurrent();
        if (finalSession?.userId !== capturedUser) reject();
        if (response.status === 403 && value && Object.keys(value).length === 1 && value.error === 'OPS_ACCESS_DENIED') {
          // This exact server response clears the cookie. It never auto-opens.
          gate.uncertain = false;
          erase({ status: 'denied', session: 'closed' }); return;
        }
        if (action !== 'read' || response.status !== 200) reject();
        const view = validateView(value); assertCurrent();
        gate.uncertain = false;
        erase({ status: view.health, session: 'open' });
        if (view.health === 'healthy') {
          displayedGeneration = generation;
          displayDeadline = monotonic() + OBSERVATION_MS;
          emit({ view, observedAt: now() });
          expiryTimer = setTimer(() => erase({ status: 'expired' }), OBSERVATION_MS);
        }
      } catch {
        if (sent || timedOut) gate.uncertain = true;
        if (current()) erase({ status: sent ? 'unknown' : 'unavailable', session: 'unverified' });
      } finally {
        clearTimer(timer);
        if (sent && !current()) gate.uncertain = true;
        if (gate.pending === attempt) gate.pending = null;
        notify(gate);
      }
    })();
    await Promise.race([work, timeout]);
  }
  return {
    start,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return state; },
    open: () => run('open'), close: () => run('close'), refresh: () => run('read'),
    setVisible(value) {
      visible = value; epoch++;
      erase({ status: state.signedIn ? 'idle' : 'signed-out' });
    },
    checkDisplay,
    dispose() {
      if (startTimer !== null) clearTimer(startTimer);
      epoch++; erase(); disposed = true;
      unsubscribeAuth(); gate.listeners.delete(gateChanged); listeners.clear();
    },
  };
}
