import type { CSSProperties } from "react";
import Image from "next/image";
import type { CatalogApp, CatalogProductStory } from "@/data/apps";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { TrailerPlayer } from "@/components/catalog/trailer-player";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";

type AppDetailExperienceProps = { app: CatalogApp };

type ProductAccentStyle = CSSProperties & {
  "--product-from": string;
  "--product-glow": string;
  "--product-panel": string;
  "--product-to": string;
};

function ProductStory({
  planned = false,
  statusLabel,
  story,
}: {
  planned?: boolean;
  statusLabel?: string;
  story: CatalogProductStory;
}) {
  return (
    <article
      className={`app-detail-story${planned ? " app-detail-story--planned" : ""}`}
      data-product-story={story.id}
    >
      <div className="app-detail-story__copy">
        <div className="app-detail-story__label-row">
          <p className="eyebrow">{story.eyebrow}</p>
          {statusLabel ? <span className="app-detail-story__status">{statusLabel}</span> : null}
        </div>
        <h2>{story.title}</h2>
        <p>{story.description}</p>
        {story.points ? (
          <ul className="app-detail-story__points">
            {story.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div
        aria-label={story.media.length > 1 ? `${story.title} media gallery` : undefined}
        className="app-detail-story__media"
        data-media-count={story.media.length}
        role={story.media.length > 1 ? "region" : undefined}
        tabIndex={story.media.length > 1 ? 0 : undefined}
      >
        {story.media.map((media) => (
          <figure key={media.src}>
            <Image
              alt={media.alt}
              height={media.height}
              loading="lazy"
              sizes={
                story.media.length > 1
                  ? "(max-width: 720px) 82vw, (max-width: 1100px) 38vw, 24rem"
                  : "(max-width: 720px) 92vw, (max-width: 1100px) 52vw, 39rem"
              }
              src={media.src}
              unoptimized
              width={media.width}
            />
            <figcaption>
              {planned ? <span aria-hidden="true">Preview</span> : null}
              {media.caption}
            </figcaption>
          </figure>
        ))}
      </div>
    </article>
  );
}

export function AppDetailExperience({ app }: AppDetailExperienceProps) {
  const accentStyle: ProductAccentStyle = {
    "--product-from": app.accent.from,
    "--product-glow": app.accent.glow,
    "--product-panel": app.accent.panel,
    "--product-to": app.accent.to,
  };

  return (
    <main
      className="app-detail-page app-theme-fawxzzy"
      data-app-detail={app.slug}
      id="main-content"
      style={accentStyle}
    >
      <AmbientBrandBackground
        intensity="soft"
        particleCount={6}
        palette={{
          base: "#070b09",
          glow: app.accent.from,
          glowStrong: app.accent.to,
          wisp: "#4f6253",
          particle: "#dce3dc",
          warm: "#202a24",
        }}
      />

      <div className="shell-container app-detail-shell">
        <SiteNav current="apps" />
        <StaticLink className="app-detail-back" href="/">
          <span aria-hidden="true">←</span> Back home
        </StaticLink>

        <section aria-labelledby="app-detail-title" className="app-detail-hero app-detail-hero--store">
          <div className="app-detail-hero__copy">
            <header className="app-detail-identity">
              <Image
                alt={`${app.name} icon`}
                className="app-detail-icon"
                height={128}
                priority
                src={app.icon.src}
                unoptimized
                width={128}
              />
              <div>
                <p className="eyebrow">{app.category}</p>
                <h1 id="app-detail-title">{app.name}</h1>
                <p className="app-detail-status">{app.status}</p>
              </div>
            </header>
            <p className="app-detail-headline">{app.detail.headline}</p>
            <p className="app-detail-description">{app.description}</p>

            <div className="app-detail-actions">
              <a
                className="catalog-button catalog-button--primary"
                data-analytics-app={app.slug}
                data-analytics-event="app_launch"
                href={app.origin.current}
                rel="noreferrer"
                target="_blank"
              >
                Open {app.name} <span aria-hidden="true">↗</span>
              </a>
              <StaticLink
                className="catalog-button catalog-button--secondary"
                href={`#${app.slug}-trailer`}
              >
                Watch preview <span aria-hidden="true">↓</span>
              </StaticLink>
            </div>
          </div>

          <figure className="app-detail-hero__media" id={`${app.slug}-trailer`}>
            <TrailerPlayer appName={app.name} appSlug={app.slug} trailer={app.trailer} />
          </figure>
        </section>

        <section aria-label={`${app.name} product experience`} className="app-detail-stories">
          {app.detail.stories.map((story) => (
            <ProductStory key={story.id} story={story} />
          ))}
        </section>

        {app.detail.plannedDirection ? (
          <section aria-label="Planned product direction" className="app-detail-planned">
            <ProductStory
              planned
              statusLabel={app.detail.plannedDirection.statusLabel}
              story={app.detail.plannedDirection}
            />
          </section>
        ) : null}

        <SiteFooter />
      </div>
    </main>
  );
}
