import type { CSSProperties } from "react";
import Image from "next/image";
import { StaticLink } from "@/components/site/static-link";
import type { CatalogApp } from "@/data/apps";
import { getAppDetailPath } from "@/data/apps";

type ProductShowcaseProps = {
  app: CatalogApp;
  compact?: boolean;
  headingLevel?: 2 | 3;
  priority?: boolean;
};

type ProductAccentStyle = CSSProperties & {
  "--product-from": string;
  "--product-glow": string;
  "--product-panel": string;
  "--product-to": string;
};

export function ProductShowcase({
  app,
  compact = false,
  headingLevel = 2,
  priority = false,
}: ProductShowcaseProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const accentStyle: ProductAccentStyle = {
    "--product-from": app.accent.from,
    "--product-glow": app.accent.glow,
    "--product-panel": app.accent.panel,
    "--product-to": app.accent.to,
  };

  return (
    <article
      className={`product-showcase surface-panel${compact ? " product-showcase--compact" : ""}`}
      data-app-card={compact ? app.slug : undefined}
      data-product-showcase={compact ? undefined : app.slug}
      id={app.slug}
      style={accentStyle}
    >
      <StaticLink
        aria-label={`Open ${app.name} details`}
        className="product-showcase__media"
        data-analytics-app={app.slug}
        data-analytics-event="catalog_app_view"
        href={getAppDetailPath(app)}
      >
        <Image
          alt={`${app.name} app preview`}
          fill
          priority={priority}
          sizes={compact ? "(max-width: 780px) 100vw, 50vw" : "(max-width: 780px) 100vw, 62vw"}
          src={app.display.poster.src}
          unoptimized
        />
        <span className="product-showcase__status">{app.status}</span>
      </StaticLink>

      <div className="product-showcase__content">
        <header className="product-showcase__identity">
          <Image
            alt={`${app.name} icon`}
            className="product-showcase__icon"
            height={80}
            src={app.display.icon.src}
            unoptimized
            width={80}
          />
          <div>
            <p className="product-showcase__category">{app.category}</p>
            <Heading>{app.name}</Heading>
          </div>
        </header>

        <p className="product-showcase__promise">
          {compact ? app.tagline : app.description}
        </p>

        <div className="product-showcase__actions">
          <StaticLink
            aria-label={`View ${app.name}`}
            className="catalog-button catalog-button--primary"
            data-analytics-app={app.slug}
            data-analytics-event="catalog_app_view"
            href={getAppDetailPath(app)}
          >
            {compact ? "View app" : `View ${app.name}`}
            <span aria-hidden="true">&rarr;</span>
          </StaticLink>
        </div>

      </div>
    </article>
  );
}
