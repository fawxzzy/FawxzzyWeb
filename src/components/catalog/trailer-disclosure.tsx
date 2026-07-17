"use client";

import { useRef } from "react";
import type { CatalogApp } from "@/data/apps";
import { TrailerPlayer } from "@/components/catalog/trailer-player";

type TrailerDisclosureProps = {
  app: CatalogApp;
};

export function TrailerDisclosure({ app }: TrailerDisclosureProps) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);

  function handleToggle() {
    const disclosure = disclosureRef.current;

    if (!disclosure?.open) {
      disclosure?.querySelector("video")?.pause();
    }
  }

  return (
    <details
      className="trailer-disclosure"
      id={`${app.slug}-trailer`}
      onToggle={handleToggle}
      ref={disclosureRef}
    >
      <summary>
        <span>
          <span className="trailer-disclosure__label">Trailer</span>
          <strong>Watch {app.name} in motion</strong>
        </span>
        <span className="trailer-disclosure__meta">
          {app.trailer.durationLabel}
          <span aria-hidden="true" className="trailer-disclosure__chevron">
            ↓
          </span>
        </span>
      </summary>
      <div className="trailer-disclosure__body">
        <p>{app.trailer.description}</p>
        <TrailerPlayer appName={app.name} appSlug={app.slug} trailer={app.trailer} />
      </div>
    </details>
  );
}
