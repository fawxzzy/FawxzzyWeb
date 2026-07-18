"use client";

import { useRef } from "react";
import type { CatalogTrailer } from "@/data/apps";
import {
  TrailerPlayer,
  type TrailerPlayerHandle,
} from "@/components/catalog/trailer-player";

type TrailerDisclosureProps = {
  appName: string;
  appSlug: string;
  trailer: CatalogTrailer;
};

export function TrailerDisclosure({ appName, appSlug, trailer }: TrailerDisclosureProps) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const playerRef = useRef<TrailerPlayerHandle>(null);

  function handleToggle() {
    const disclosure = disclosureRef.current;

    if (!disclosure?.open) {
      playerRef.current?.pauseForDisclosure();
    }
  }

  return (
    <details
      className="trailer-disclosure"
      id={`${appSlug}-trailer`}
      onToggle={handleToggle}
      ref={disclosureRef}
    >
      <summary>
        <span>
          <span className="trailer-disclosure__label">Trailer</span>
          <strong>Watch {appName} in motion</strong>
        </span>
        <span className="trailer-disclosure__meta">
          {trailer.durationLabel}
          <span aria-hidden="true" className="trailer-disclosure__chevron">
            ↓
          </span>
        </span>
      </summary>
      <div className="trailer-disclosure__body">
        <p>{trailer.description}</p>
        <TrailerPlayer appName={appName} appSlug={appSlug} ref={playerRef} trailer={trailer} />
      </div>
    </details>
  );
}
