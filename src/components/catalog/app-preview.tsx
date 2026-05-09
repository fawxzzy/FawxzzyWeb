"use client";

import Image from "next/image";
import { useRef } from "react";
import type { CatalogApp } from "@/data/apps";
import { FitnessPreviewBoard } from "@/components/catalog/fitness-preview-board";

type AppPreviewProps = {
  app: CatalogApp;
};

const PREVIEW_GROUP_SELECTOR = '[data-preview-group="catalog-app-preview"]';

export function AppPreview({ app }: AppPreviewProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const screenshotsRegionId = `${app.slug}-screenshots`;

  function handleToggle() {
    const currentDetails = detailsRef.current;

    if (!currentDetails?.open) {
      return;
    }

    const openSiblings = document.querySelectorAll<HTMLDetailsElement>(
      `${PREVIEW_GROUP_SELECTOR}[open]`,
    );

    for (const sibling of openSiblings) {
      if (sibling !== currentDetails) {
        sibling.open = false;
      }
    }
  }

  return (
    <details
      className="catalog-section__details"
      data-preview-group="catalog-app-preview"
      onToggle={handleToggle}
      ref={detailsRef}
    >
      <summary className="catalog-section__summary" aria-controls={screenshotsRegionId}>
        <div className="catalog-section__summary-footer">
          <span className="catalog-section__preview-trigger">
            <span className="field-label catalog-section__preview-label">Preview</span>
            <span className="catalog-section__toggle" aria-hidden="true" />
          </span>
        </div>
      </summary>

      <div className="catalog-section__panel" id={screenshotsRegionId}>
        {app.slug === "fitness" ? (
          <FitnessPreviewBoard variant="inline" />
        ) : null}

        <div className="catalog-rail">
          <div className="catalog-rail__track">
            {app.screenshots.map((shot) => (
              <figure className="shot-card" key={shot.src}>
                <div className="shot-card__frame">
                  <Image
                    alt={shot.alt}
                    className="shot-card__image"
                    height={1024}
                    priority={app.slug === "fitness"}
                    src={shot.src}
                    width={1440}
                  />
                </div>
                <figcaption>
                  <span>{shot.caption}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}
