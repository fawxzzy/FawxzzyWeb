import type { Metadata } from "next";
import Link from "next/link";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { productIdentity } from "@/config/product";
import { apps } from "@/data/apps";

export const metadata: Metadata = {
  title: "FawxzzyWeb",
  description: productIdentity.description,
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return (
    <main className="home-page app-theme-sage" id="main-content">
      <AmbientFitnessBackground
        intensity="high"
        particleCount={18}
        pulseEnabled
        palette={{
          base: "#070C0A",
          glow: "#7F977C",
          glowStrong: "#A4B5A3",
          wisp: "#5C725D",
          particle: "#CFD8D0",
          warm: "#1C2420",
        }}
      />

      <div className="shell-container home-shell">
        <nav aria-label="Primary" className="site-nav surface-panel">
          <Link aria-current="page" className="site-nav__brand" href="/">
            {productIdentity.name}
          </Link>
          <div className="site-nav__links">
            <Link aria-current="page" href="/">
              Home
            </Link>
            <Link href={productIdentity.appsPath}>Apps</Link>
          </div>
        </nav>

        <section aria-labelledby="home-title" className="home-hero surface-panel">
          <div className="home-hero__copy">
            <p className="eyebrow">Built by Fawxzzy</p>
            <h1 id="home-title">One home for the work, apps, and experiments.</h1>
            <p>
              {productIdentity.name} is the public starting point for the Fawxzzy ecosystem.
              Each app keeps its own product identity and production origin.
            </p>
            <div className="hero__actions">
              <Link className="catalog-button catalog-button--primary" href={productIdentity.appsPath}>
                Explore apps
              </Link>
              <a className="catalog-button catalog-button--secondary" href="#featured-apps">
                See what is here
              </a>
            </div>
          </div>

          <div aria-label="FawxzzyWeb identity" className="home-hero__mark">
            <span>FW</span>
            <small>{productIdentity.slug}</small>
          </div>
        </section>

        <section aria-labelledby="featured-apps-title" className="home-apps" id="featured-apps">
          <div className="section-heading">
            <p className="eyebrow">Independent products</p>
            <h2 id="featured-apps-title">Featured apps</h2>
            <p>Grounded links only. Each destination remains owned by its application.</p>
          </div>

          <div className="home-app-grid">
            {apps.map((app) => (
              <article className="home-app-card surface-panel" key={app.slug}>
                <div>
                  <p className="field-label">{app.tags.join(" / ")}</p>
                  <h3>{app.name}</h3>
                  <p>{app.tagline}</p>
                </div>
                <div className="home-app-card__actions">
                  <a
                    className="catalog-button catalog-button--primary"
                    href={app.liveUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open {app.name}
                  </a>
                  <Link
                    className="catalog-button catalog-button--secondary"
                    href={`${productIdentity.appsPath}#${app.slug}`}
                  >
                    View in catalog
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
