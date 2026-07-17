import type { Metadata } from "next";
import Image from "next/image";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { AppStoreCard } from "@/components/catalog/app-store-card";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";
import { apps } from "@/data/apps";

export const metadata: Metadata = {
  title: productIdentity.publicName,
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
        <SiteNav current="home" />

        <section aria-labelledby="home-title" className="home-hero surface-panel">
          <div className="home-hero__copy">
            <p className="eyebrow">Built by Fawxzzy</p>
            <h1 id="home-title">One home for the work, apps, and experiments.</h1>
            <p>
              {productIdentity.publicName} is the public starting point for the ecosystem.
              Each app keeps its own product identity and production origin.
            </p>
            <div className="hero__actions">
              <StaticLink
                className="catalog-button catalog-button--primary"
                href={productIdentity.appsPath}
              >
                Explore apps
              </StaticLink>
              <StaticLink
                className="catalog-button catalog-button--secondary"
                href="/discover"
              >
                Start here
              </StaticLink>
            </div>
          </div>

          <div className="home-hero__artwork">
            <Image
              alt="Fawxzzy — build, train, create"
              height={500}
              priority
              src="/brand/fawxzzy-banner.png"
              unoptimized
              width={1500}
            />
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
              <AppStoreCard app={app} key={app.slug} />
            ))}
          </div>
        </section>

        <section aria-labelledby="discover-title" className="discovery-callout surface-panel">
          <div>
            <p className="eyebrow">Everything else, still grounded</p>
            <h2 id="discover-title">Training help, Discord, TikTok, and YouTube.</h2>
            <p>
              One verified map to the current public destinations—without duplicating what those
              products and communities already own.
            </p>
          </div>
          <StaticLink
            className="catalog-button catalog-button--primary"
            href="/discover"
          >
            Open discovery hub
          </StaticLink>
        </section>
      </div>
    </main>
  );
}
