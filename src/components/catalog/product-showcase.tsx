import type { CSSProperties } from "react";
import Image from "next/image";
import { TrailerDisclosure } from "@/components/catalog/trailer-disclosure";
import { StaticLink } from "@/components/site/static-link";
import type { CatalogApp } from "@/data/apps";
import { getAppDetailPath } from "@/data/apps";

type ProductShowcaseProps = {
  app: CatalogApp;
  headingLevel?: 2 | 3;
  showTrailer?: boolean;
};

type ProductAccentStyle = CSSProperties & {
  "--product-from": string;
  "--product-glow": string;
  "--product-panel": string;
  "--product-to": string;
};

export function ProductShowcase({
  app,
  headingLevel = 2,
  showTrailer = false,
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
      className="product-showcase surface-panel"
      data-product-showcase={app.slug}
      id={app.slug}
      style={accentStyle}
    >
      <div className="product-showcase__media">
        <Image
          alt={`${app.name} interaction walkthrough poster`}
          className="product-showcase__poster"
          fill
          sizes="(min-width: 900px) 600px, 100vw"
          src={app.trailer.poster.src}
          unoptimized
        />
        <span className="product-showcase__availability">{app.status}</span>
      </div>

      <div className="product-showcase__content">
        <header className="product-showcase__identity">
          <Image
            alt={`${app.name} icon`}
            className="product-showcase__icon"
            height={80}
            src={app.icon.src}
            unoptimized
            width={80}
          />
          <div>
            <p className="product-showcase__category">{app.category}</p>
            <Heading>{app.name}</Heading>
          </div>
        </header>

        <p className="product-showcase__promise">{app.tagline}</p>

        <p className="product-showcase__update">
          <span>Latest</span>
          {app.latestUpdate}
        </p>

        <div className="product-showcase__actions">
          <StaticLink
            aria-label={`Explore ${app.name}`}
            className="catalog-button catalog-button--primary"
            href={getAppDetailPath(app)}
          >
            Explore {app.name}
            <span aria-hidden="true">&rarr;</span>
          </StaticLink>
        </div>

        {showTrailer ? (
          <TrailerDisclosure
            appName={app.name}
            appSlug={app.slug}
            trailer={app.trailer}
          />
        ) : null}
      </div>
    </article>
  );
}
