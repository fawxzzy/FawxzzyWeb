"use client";

import type { MouseEvent } from "react";
import { useRef } from "react";
import Image from "next/image";
import { StaticLink } from "@/components/site/static-link";

type AppCatalogEntryProps = {
  iconSrc: string;
  name: string;
  origin: string;
  posterSrc: string;
  slug: string;
};

export function AppCatalogEntry({
  iconSrc,
  name,
  origin,
  posterSrc,
  slug,
}: AppCatalogEntryProps) {
  const previewDialog = useRef<HTMLDialogElement>(null);
  const feedbackDialog = useRef<HTMLDialogElement>(null);

  function closeFromBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      event.currentTarget.close();
    }
  }

  return (
    <article className="app-launcher" data-app-launcher={slug} id={slug}>
      <StaticLink
        aria-label={`Open ${name} app`}
        className="app-launcher__launch"
        data-analytics-app={slug}
        data-analytics-event="app_launch"
        href={origin}
        rel="noreferrer"
        target="_blank"
      >
        <Image
          alt=""
          className="app-launcher__icon"
          height={160}
          src={iconSrc}
          unoptimized
          width={160}
        />
        <strong>{name}</strong>
      </StaticLink>

      <div className="app-launcher__actions">
        <StaticLink
          aria-label={`Open ${name} app from launcher controls`}
          className="app-launcher__action app-launcher__action--open"
          data-analytics-app={slug}
          data-analytics-event="app_launch"
          href={origin}
          rel="noreferrer"
          target="_blank"
        >
          Open
          <span aria-hidden="true">↗</span>
        </StaticLink>
        <button
          aria-haspopup="dialog"
          className="app-launcher__action"
          onClick={() => previewDialog.current?.showModal()}
          type="button"
        >
          Preview
        </button>
        <button
          aria-haspopup="dialog"
          className="app-launcher__action"
          onClick={() => feedbackDialog.current?.showModal()}
          type="button"
        >
          Feedback
        </button>
      </div>

      <dialog
        aria-labelledby={`${slug}-preview-title`}
        className="app-launcher-dialog"
        data-app-preview={slug}
        onClick={closeFromBackdrop}
        ref={previewDialog}
      >
        <div className="app-launcher-dialog__panel">
          <header className="app-launcher-dialog__header">
            <div>
              <p className="eyebrow">Current app</p>
              <h2 id={`${slug}-preview-title`}>{name} preview</h2>
            </div>
            <form method="dialog">
              <button aria-label={`Close ${name} preview`} className="app-launcher-dialog__close">
                ×
              </button>
            </form>
          </header>
          <div className="app-launcher-dialog__media">
            <Image
              alt={`${name} current app preview`}
              height={1920}
              sizes="(max-width: 700px) calc(100vw - 3rem), 24rem"
              src={posterSrc}
              unoptimized
              width={1080}
            />
          </div>
          <StaticLink
            aria-label={`Open ${name} app from preview`}
            className="catalog-button catalog-button--primary"
            data-analytics-app={slug}
            data-analytics-event="app_launch"
            href={origin}
            rel="noreferrer"
            target="_blank"
          >
            Open app
            <span aria-hidden="true">↗</span>
          </StaticLink>
        </div>
      </dialog>

      <dialog
        aria-labelledby={`${slug}-feedback-title`}
        className="app-launcher-dialog app-launcher-dialog--feedback"
        data-app-feedback={slug}
        onClick={closeFromBackdrop}
        ref={feedbackDialog}
      >
        <div className="app-launcher-dialog__panel">
          <header className="app-launcher-dialog__header">
            <div>
              <p className="eyebrow">Verified feedback</p>
              <h2 id={`${slug}-feedback-title`}>{name} feedback</h2>
            </div>
            <form method="dialog">
              <button aria-label={`Close ${name} feedback`} className="app-launcher-dialog__close">
                ×
              </button>
            </form>
          </header>
          <div className="app-launcher-dialog__empty" data-feedback-state="unavailable">
            <strong>No verified public feedback yet.</strong>
            <p>
              Feedback will appear here only after a moderated, source-backed public
              review system is available.
            </p>
          </div>
        </div>
      </dialog>
    </article>
  );
}
