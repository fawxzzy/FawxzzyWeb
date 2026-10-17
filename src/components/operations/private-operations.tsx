'use client';

import { useEffect, useRef, useState } from 'react';
import { isLocalAuthTestOrigin } from '@/config/account';
import { resolvePortalAuthAdapter, type PortalAuthAdapter } from '@/lib/auth/browser-adapter';
import { createOperationsReader, type OperationsReader, type ReaderState } from '@/lib/operations/reader-client.mjs';
import styles from './private-operations.module.css';

const initial: ReaderState = { status: 'loading', session: 'unverified', signedIn: false,
  pending: false, uncertain: false, view: null, observedAt: null };
const messages: Record<string, string> = {
  loading: 'Checking private access…',
  idle: 'Check access to refresh your private overview, or open a session.',
  'signed-out': 'Sign in to your Fawxzzy account to continue.',
  unavailable: 'Private operations is unavailable. Try checking access again later.',
  opened: 'Private session opened. Refresh the overview when you are ready.',
  closed: 'Private session closed. The overview has been cleared.',
  denied: 'Private access is not available for this session. No work is displayed.',
  unknown: 'The request outcome could not be confirmed. Check access after the request finishes before changing the session.',
  healthy: 'A recent observation of your work. This page does not update automatically.',
  stale: 'The work overview is out of date. No work is displayed.',
  reconciling: 'The work overview is being reconciled. No work is displayed.',
  incompatible: 'The work overview needs an update before it can be displayed.',
  expired: 'The observation expired and was cleared. Refresh to check again.',
};

export function PrivateOperations({ projectView = false }: { projectView?: boolean } = {}) {
  const [state, setState] = useState<ReaderState>(initial);
  const [resumeEpoch, setResumeEpoch] = useState(0);
  const reader = useRef<OperationsReader | null>(null);
  const adapter = useRef<PortalAuthAdapter | null>(null);
  const attemptedGeneration = useRef<string | null>(null);
  useEffect(() => {
    const resolution = resolvePortalAuthAdapter(window.location);
    if (resolution.status !== 'ready') {
      // Match asynchronous adapter initialization without doing work at render.
      queueMicrotask(() => setState({ ...initial, status: 'unavailable' }));
      return;
    }
    adapter.current = resolution.adapter;
    const controller = createOperationsReader({ adapter: resolution.adapter, origin: window.location.origin,
      localTest: resolution.adapter.kind === 'test' && isLocalAuthTestOrigin(window.location.origin) });
    reader.current = controller;
    const unsubscribe = controller.subscribe(() => setState(controller.getSnapshot()));
    let visible = true;
    let resumeEligible = false;
    const setVisibility = (nextVisible: boolean) => {
      if (nextVisible === visible) return;
      if (!nextVisible) {
        const snapshot = controller.getSnapshot();
        resumeEligible = snapshot.status === 'healthy' || snapshot.status === 'expired'
          || attemptedGeneration.current === null;
      } else if (resumeEligible) {
        // A real return to this tab may reconcile once. A denied or uncertain
        // request stays held for explicit user action in the same Auth generation.
        attemptedGeneration.current = null;
        setResumeEpoch((value) => value + 1);
      }
      visible = nextVisible;
      controller.setVisible(nextVisible);
    };
    const visibility = () => setVisibility(document.visibilityState === 'visible');
    const hide = () => setVisibility(false);
    const show = () => setVisibility(document.visibilityState === 'visible');
    const check = () => controller.checkDisplay();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    window.addEventListener('focus', check); window.addEventListener('storage', check);
    setVisibility(document.visibilityState === 'visible');
    void controller.start();
    return () => {
      unsubscribe(); controller.dispose(); reader.current = null; adapter.current = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show);
      window.removeEventListener('focus', check); window.removeEventListener('storage', check);
    };
  }, []);
  useEffect(() => {
    if (!projectView || !state.signedIn || state.pending || document.visibilityState !== 'visible') return;
    const controller = reader.current;
    const currentAdapter = adapter.current;
    const generation = currentAdapter?.getAuthGeneration();
    if (!controller || !currentAdapter || !generation || attemptedGeneration.current === generation) return;
    attemptedGeneration.current = generation;
    const current = () => reader.current === controller && currentAdapter.getAuthGeneration() === generation;
    // First reconcile an existing cookie. Only a definite denial may try one
    // session open; uncertainty stops, and the server denies a foreign subject.
    void (async () => {
      await controller.refresh();
      if (!current()) return;
      const checked = controller.getSnapshot();
      if (checked.status !== 'denied' || checked.session !== 'closed' || checked.uncertain) return;
      await controller.open();
      if (current() && controller.getSnapshot().status === 'opened') await controller.refresh();
    })().catch(() => undefined);
  }, [projectView, resumeEpoch, state.pending, state.signedIn, state.status]);
  const disabled = !state.signedIn || state.pending;
  if (projectView) {
    // This client-only slot never serializes private data into the public page
    // HTML. The existing account-origin endpoint still verifies Auth, the
    // caller-bound cookie, operator grant, and a no-store private response.
    if (!state.signedIn && state.status !== 'signed-out') return null;
    return (
      <section aria-label="Private projects" className={styles.root}>
        <div className={styles.panel}>
          <h2>Private work</h2>
          {state.signedIn
            ? <p role="status" aria-live="polite">{state.view ? 'Your private cards are available for this verified session.' : messages[state.status] ?? messages.unavailable}</p>
            : <p>Sign in to your Fawxzzy account to check private work. <a href="/login?returnTo=%2Fprojects">Sign in</a></p>}
          {state.signedIn && !state.view
            ? <button type="button" disabled={state.pending} onClick={() => { void reader.current?.refresh(); }}>Refresh private work</button>
            : null}
        </div>
        {state.view ? (
          <section aria-label="Private project cards" className={styles.overview}>
            {state.view.cards.length === 0 ? <p>No private cards in this observation.</p> : (
              <ul className={styles.cards}>{state.view.cards.map((card) => (
                <li className={styles.card} key={card.stable_id}>
                  <p className={styles.lifecycle}>{card.lifecycle.replaceAll('_', ' ')}</p>
                  <h3>{card.title}</h3><p className={styles.owner}>Owner: {card.owner_role}</p>
                </li>
              ))}</ul>
            )}
          </section>
        ) : null}
      </section>
    );
  }
  return (
    <section className={styles.root} aria-label="Private workspace">
      <div className={styles.panel}>
        <p role="status" aria-live="polite">{messages[state.status] ?? messages.unavailable}</p>
        {!state.signedIn && state.status === 'signed-out' ? <a href="/login">Sign in</a> : null}
        <div className={styles.controls}>
          <button type="button" disabled={disabled || state.uncertain || state.session === 'open'} onClick={() => { void reader.current?.open(); }}>Open private session</button>
          <button type="button" disabled={disabled} onClick={() => { void reader.current?.refresh(); }}>{state.session === 'open' ? 'Refresh overview' : 'Check access'}</button>
          <button type="button" disabled={disabled || state.uncertain || state.session !== 'open'} onClick={() => { void reader.current?.close(); }}>Close private session</button>
        </div>
        {state.pending ? <p className={styles.note}>Waiting for the current request to finish.</p> : null}
        {state.view && state.observedAt !== null ? (
          <p className={styles.note}>Observed at <time dateTime={new Date(state.observedAt).toISOString()}>{new Date(state.observedAt).toLocaleTimeString()}</time>. Clears after one minute or when you leave this page.</p>
        ) : null}
      </div>
      {state.view ? (
        <section aria-label="Work overview" className={styles.overview}>
          <h2>Work overview</h2>
          {state.view.cards.length === 0 ? <p>No work items in this observation.</p> : (
            <ul className={styles.cards}>
              {state.view.cards.map((card) => (
                <li key={card.stable_id} className={styles.card}>
                  <p className={styles.lifecycle}>{card.lifecycle.replaceAll('_', ' ')}</p>
                  <h3>{card.title}</h3><p className={styles.owner}>Owner: {card.owner_role}</p>
                  {card.blocker_codes.length ? <p>Blockers: {card.blocker_codes.join(', ')}</p> : null}
                  {card.evidence_handles.length ? <details><summary>Evidence references</summary><ul>{card.evidence_handles.map((handle) => <li key={handle}><code>{handle}</code></li>)}</ul></details> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}
