import type { CSSProperties } from "react";
import Image from "next/image";
import type { CatalogApp } from "@/data/apps";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
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
        <StaticLink className="app-detail-back" href="/apps">
          <span aria-hidden="true">←</span> All apps
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

        <section aria-labelledby={`${app.slug}-capabilities-title`} className="app-detail-capabilities">
          <header className="app-detail-section-copy">
            <p className="eyebrow">What you can do</p>
            <h2 id={`${app.slug}-capabilities-title`}>{app.detail.capabilitiesHeading}</h2>
          </header>
          <ul className="app-detail-capability-list">
            {app.detail.capabilities.map((capability) => (
              <li key={capability.title}>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
