import Image from "next/image";
import type { CatalogApp } from "@/data/apps";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { ReviewPlaceholder } from "@/components/catalog/review-placeholder";
import { TrailerDisclosure } from "@/components/catalog/trailer-disclosure";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";

type AppDetailExperienceProps = {
  app: CatalogApp;
};

export function AppDetailExperience({ app }: AppDetailExperienceProps) {
  return (
    <main className="app-detail-page app-theme-sage" id="main-content">
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

        <section aria-labelledby="app-detail-title" className="app-detail-hero surface-panel">
          <div className="app-detail-identity">
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
              <p className="app-detail-tagline">{app.tagline}</p>
              <p className="app-detail-status">{app.status}</p>
            </div>
          </div>

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
          </div>
        </section>

        <div className="app-detail-grid">
          <section aria-labelledby="about-title" className="app-detail-copy surface-panel">
            <p className="eyebrow">About the app</p>
            <h2 id="about-title">Built around the experience.</h2>
            <p>{app.description}</p>
            <ul className="app-feature-list">
              {app.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>

          <TrailerDisclosure appName={app.name} appSlug={app.slug} trailer={app.trailer} />
        </div>

        <ReviewPlaceholder appName={app.name} appSlug={app.slug} />
      </div>
    </main>
  );
}
