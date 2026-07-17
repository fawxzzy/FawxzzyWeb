import Image from "next/image";
import type { CatalogApp } from "@/data/apps";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
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
        intensity="high"
        particleCount={18}
        pulseEnabled
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
            {app.slug === "fitness" ? (
              <StaticLink
                className="catalog-button catalog-button--secondary"
                href="/apps/fitness/preview"
              >
                View UI preview board
              </StaticLink>
            ) : null}
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

        <section aria-labelledby="screenshots-title" className="app-screenshots-section">
          <div className="section-heading">
            <p className="eyebrow">Inside {app.name}</p>
            <h2 id="screenshots-title">A closer look.</h2>
            <p>Current product captures, shown without mock ratings or invented claims.</p>
          </div>
          <div
            aria-label={`${app.name} screenshots`}
            className="app-screenshot-list"
            role="region"
            tabIndex={0}
          >
            {app.screenshots.map((screenshot) => (
              <figure className="app-screenshot surface-panel" key={screenshot.src}>
                <Image
                  alt={screenshot.alt}
                  height={screenshot.height}
                  sizes="(max-width: 700px) 82vw, 34vw"
                  src={screenshot.src}
                  unoptimized
                  width={screenshot.width}
                />
                <figcaption>{screenshot.alt}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section aria-labelledby="reviews-title" className="app-reviews-preview surface-panel">
          <div>
            <p className="eyebrow">Reviews</p>
            <h2 id="reviews-title">Real feedback, when the governed feed is ready.</h2>
          </div>
          <p>
            No public review data is shown yet. Future reviews will come from a moderated,
            privacy-aware platform read model—not a direct public database write.
          </p>
        </section>
      </div>
    </main>
  );
}
