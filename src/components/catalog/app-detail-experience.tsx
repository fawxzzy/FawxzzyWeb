import type { CSSProperties } from "react";
import Image from "next/image";
import type { CatalogApp } from "@/data/apps";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { ReviewPlaceholder } from "@/components/catalog/review-placeholder";
import { TrailerDisclosure } from "@/components/catalog/trailer-disclosure";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";

type AppDetailExperienceProps = {
  app: CatalogApp;
};

type ProductAccentStyle = CSSProperties & {
  "--product-from": string;
  "--product-glow": string;
  "--product-panel": string;
  "--product-to": string;
};

export function AppDetailExperience({ app }: AppDetailExperienceProps) {
  const accentStyle: ProductAccentStyle = {
    "--product-from": app.accent.from,
    "--product-glow": app.accent.glow,
    "--product-panel": app.accent.panel,
    "--product-to": app.accent.to,
  };

  return (
    <main
      className="app-detail-page app-theme-sage"
      data-app-detail={app.slug}
      id="main-content"
      style={accentStyle}
    >
      <AmbientFitnessBackground
        intensity="soft"
        particleCount={10}
        palette={{
          base: "#070C0A",
          glow: app.accent.from,
          glowStrong: app.accent.to,
          wisp: "#5C725D",
          particle: "#CFD8D0",
          warm: "#1C2420",
        }}
      />

      <div className="shell-container app-detail-shell">
        <SiteNav current="apps" />

        <nav aria-label="Breadcrumb" className="app-detail-breadcrumb">
          <StaticLink href="/apps">Apps</StaticLink>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{app.name}</span>
        </nav>

        <section aria-labelledby="app-detail-title" className="app-detail-hero">
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
                <p className="app-detail-status">{app.status}</p>
              </div>
            </header>

            <h1 id="app-detail-title">{app.name}</h1>
            <p className="app-detail-headline">{app.detail.headline}</p>
            <p className="app-detail-tagline">{app.tagline}</p>

            <div className="app-detail-actions">
              <a
                className="catalog-button catalog-button--primary"
                href={app.origin.current}
                rel="noreferrer"
                target="_blank"
              >
                Open {app.name}
                <span aria-hidden="true">↗</span>
              </a>
              <StaticLink
                className="catalog-button catalog-button--secondary"
                href={`#${app.slug}-walkthrough`}
              >
                Watch the walkthrough
                <span aria-hidden="true">&darr;</span>
              </StaticLink>
            </div>
          </div>

          <figure className="app-detail-hero__media">
            <Image
              alt={`${app.name} interaction walkthrough poster`}
              className="app-detail-hero__poster"
              fill
              priority
              sizes="(min-width: 1000px) 480px, (min-width: 700px) 42vw, calc(100vw - 2rem)"
              src={app.trailer.poster.src}
              unoptimized
            />
            <figcaption>
              <span>Live product walkthrough</span>
              <strong>{app.trailer.durationLabel}</strong>
            </figcaption>
          </figure>
        </section>

        <section
          aria-labelledby={`${app.slug}-proof-title`}
          className="app-detail-proof"
          id={`${app.slug}-walkthrough`}
        >
          <header className="app-detail-section-copy">
            <p className="eyebrow">{app.detail.proofLabel}</p>
            <h2 id={`${app.slug}-proof-title`}>{app.detail.headline}</h2>
            <p>{app.description}</p>
          </header>

          <TrailerDisclosure appName={app.name} appSlug={app.slug} trailer={app.trailer} />
        </section>

        <section
          aria-labelledby={`${app.slug}-capabilities-title`}
          className="app-detail-capabilities"
        >
          <header className="app-detail-section-copy">
            <p className="eyebrow">What it does</p>
            <h2 id={`${app.slug}-capabilities-title`}>{app.detail.capabilitiesHeading}</h2>
          </header>

          <ol className="app-detail-capability-list">
            {app.detail.capabilities.map((capability, index) => (
              <li key={capability.title}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby={`${app.slug}-status-title`} className="app-detail-build surface-panel">
          <div>
            <p className="eyebrow">Current build</p>
            <h2 id={`${app.slug}-status-title`}>{app.latestUpdate}</h2>
          </div>
          <p>{app.detail.statusSummary}</p>
          <span>{app.status}</span>
        </section>

        <ReviewPlaceholder appName={app.name} appSlug={app.slug} compact />

        <section aria-labelledby={`${app.slug}-cta-title`} className="app-detail-cta surface-panel">
          <div>
            <p className="eyebrow">Ready when you are</p>
            <h2 id={`${app.slug}-cta-title`}>Start with {app.name}.</h2>
            <p>Open the live product at its current, independently owned home.</p>
          </div>
          <div className="app-detail-actions">
            <a
              className="catalog-button catalog-button--primary"
              href={app.origin.current}
              rel="noreferrer"
              target="_blank"
            >
              Launch {app.name}
              <span aria-hidden="true">↗</span>
            </a>
            <StaticLink className="catalog-button catalog-button--secondary" href="/apps">
              All apps
              <span aria-hidden="true">&rarr;</span>
            </StaticLink>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
