'use client';

import { useEffect, useRef, useState } from 'react';
import type { PortalAuthAdapter } from '@/lib/auth/browser-adapter';
import { readPrivateProjectCard } from '@/lib/projects/private-card-reader.mjs';
import styles from '../operations/private-operations.module.css';

type DisplayCard = {
  stable_id: string; version: number; body_digest: string; board: string;
  board_revision: string; source_revision: string; title: string; summary: string; lifecycle: string;
};

// Mounted only after the existing Operations session is verified. The server
// still independently authenticates the caller and owner for every read.
export function PrivateProjectCard({ adapter, enabled }: { adapter: PortalAuthAdapter | null; enabled: boolean }) {
  const [card, setCard] = useState<DisplayCard | null>(null);
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'ready'>('loading');
  const [refresh, setRefresh] = useState(0);
  const activeRead = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled || !adapter) return;
    const check = () => {
      if (document.visibilityState === 'visible') setRefresh((value) => value + 1);
      else { activeRead.current?.abort(); setCard(null); setStatus('unavailable'); }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('focus', check);
    return () => {
      activeRead.current?.abort();
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', check); window.removeEventListener('focus', check);
    };
  }, [adapter, enabled]);
  useEffect(() => {
    if (!enabled || !adapter || document.visibilityState !== 'visible') return;
    const controller = new AbortController();
    activeRead.current = controller;
    let current = true;
    queueMicrotask(() => { if (current) { setCard(null); setStatus('loading'); } });
    void readPrivateProjectCard({ adapter, origin: window.location.origin, signal: controller.signal })
      .then((value: DisplayCard) => { if (current) { setCard(value); setStatus('ready'); } })
      .catch(() => { if (current) { setCard(null); setStatus('unavailable'); } });
    return () => { current = false; controller.abort(); if (activeRead.current === controller) activeRead.current = null; };
  }, [adapter, enabled, refresh]);
  if (!enabled) return null;
  return (
    <section aria-label="Canonical private project card" className={styles.overview}>
      <h3>Private project card</h3>
      {card && status === 'ready' ? (
        <article className={styles.card}>
          <p className={styles.owner}>Fawxzzy Web · Private</p>
          <p className={styles.lifecycle}>{card.lifecycle}</p>
          <h4>{card.title}</h4><p>{card.summary}</p>
          <p className={styles.note}>Card {card.stable_id} | Revision {card.version}</p>
        </article>
      ) : <p role="status">{status === 'loading' ? 'Checking the current private card.' : 'Private card unavailable for this session.'}</p>}
      <button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh private card</button>
    </section>
  );
}
