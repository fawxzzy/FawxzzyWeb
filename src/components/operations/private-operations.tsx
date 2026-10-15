'use client';

import { useEffect, useRef, useState } from 'react';
import { isLocalAuthTestOrigin } from '@/config/account';
import { resolvePortalAuthAdapter } from '@/lib/auth/browser-adapter';
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

export function PrivateOperations() {
  const [state, setState] = useState<ReaderState>(initial);
  const reader = useRef<OperationsReader | null>(null);
  useEffect(() => {
    const resolution = resolvePortalAuthAdapter(window.location);
    if (resolution.status !== 'ready') {
      // Match asynchronous adapter initialization without doing work at render.
      queueMicrotask(() => setState({ ...initial, status: 'unavailable' }));
      return;
    }
    const controller = createOperationsReader({ adapter: resolution.adapter, origin: window.location.origin,
      localTest: resolution.adapter.kind === 'test' && isLocalAuthTestOrigin(window.location.origin) });
    reader.current = controller;
    const unsubscribe = controller.subscribe(() => setState(controller.getSnapshot()));
    const visibility = () => controller.setVisible(document.visibilityState === 'visible');
    const hide = () => controller.setVisible(false);
    const show = () => controller.setVisible(document.visibilityState === 'visible');
    const check = () => controller.checkDisplay();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    window.addEventListener('focus', check); window.addEventListener('storage', check);
    controller.setVisible(document.visibilityState === 'visible');
    void controller.start();
    return () => {
      unsubscribe(); controller.dispose(); reader.current = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show);
      window.removeEventListener('focus', check); window.removeEventListener('storage', check);
    };
  }, []);
  const disabled = !state.signedIn || state.pending;
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
