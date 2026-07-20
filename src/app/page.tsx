import type { Metadata } from "next";
import Image from "next/image";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { ProductShowcase } from "@/components/catalog/product-showcase";
import { SiteFooter } from "@/components/site/site-footer";
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
        intensity="soft"
        particleCount={10}
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

        <section aria-labelledby="home-title" className="home-hero">
          <div className="home-hero__copy">
            <p className="eyebrow">Fawxzzy / Independent product studio</p>
            <h1 id="home-title">Software, fitness, games&mdash;and whatever I build next.</h1>
            <p>
              One public home for focused products, experiments, and the work
              behind them. I build useful things, keep them understandable, and
              make them better from real use.
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
                href="/newsletter"
              >
                Read the build log
              </StaticLink>
            </div>
          </div>

          <div className="home-hero__artwork">
            <Image
              alt="Fawxzzy — creator, builder, fitness, and gaming"
              height={500}
              priority
              src="/brand/fawxzzy-banner-v2.png"
              unoptimized
              width={1500}
            />
          </div>
        </section>

        <section aria-labelledby="products-title" className="home-products studio-section">
          <div className="section-heading">
            <p className="eyebrow">Products in the real world</p>
            <h2 id="products-title">See the work before the pitch.</h2>
            <p>
              Fitness and Mazer are live, independently owned products. Their latest
              interaction walkthroughs show exactly what is available today.
            </p>
          </div>

          <div className="product-showcase-grid">
            {apps.map((app) => (
              <ProductShowcase app={app} headingLevel={3} key={app.slug} />
            ))}
          </div>
        </section>

        <section aria-labelledby="build-note-title" className="home-build-note surface-panel">
          <div>
            <p className="eyebrow">Current build note / July 2026</p>
            <h2 id="build-note-title">The products now speak for themselves.</h2>
            <p>
              New one-minute Fitness and Mazer walkthroughs use real production
              interaction, captions, and product-specific posters instead of a
              static screenshot reel.
            </p>
          </div>
          <StaticLink className="catalog-button catalog-button--secondary" href="/newsletter">
            Read the build log
          </StaticLink>
        </section>

        <section aria-labelledby="mission-title" className="home-mission studio-section">
          <div className="section-heading">
            <p className="eyebrow">Why Fawxzzy exists</p>
            <h2 id="mission-title">Useful software should stay within reach.</h2>
            <p>
              Fawxzzy brings software, fitness work, games, and community into one
              clear home without flattening every product into the same thing.
            </p>
          </div>

          <div className="home-principles">
            <article className="home-principle">
              <p className="eyebrow">Why</p>
              <h3>Make useful tools more affordable.</h3>
              <p>
                Good software should earn its place by helping people, not by hiding
                basic value behind clutter, pressure, or confusing pricing.
              </p>
            </article>
            <article className="home-principle">
              <p className="eyebrow">How</p>
              <h3>Build in public and improve from real use.</h3>
              <p>
                I start with a focused problem, keep the product understandable, and
                use honest feedback to decide what deserves to grow next.
              </p>
            </article>
            <article className="home-principle">
              <p className="eyebrow">Where it goes</p>
              <h3>A connected home for software, services, and games.</h3>
              <p>
                The long-term platform gives people one trustworthy Fawxzzy identity
                while every app keeps a clear purpose and a reliable home of its own.
              </p>
            </article>
          </div>
        </section>

        <section aria-labelledby="newsletter-callout-title" className="home-newsletter surface-panel">
          <div>
            <p className="eyebrow">Build in public, without the noise</p>
            <h2 id="newsletter-callout-title">Follow what ships and why it changed.</h2>
            <p>
              Building Fawxzzy is the permanent record of product decisions,
              practical lessons, and what comes next. The archive is open now;
              email collection waits for its privacy-safe delivery path.
            </p>
          </div>
          <div className="home-newsletter__actions">
            <StaticLink className="catalog-button catalog-button--primary" href="/newsletter">
              Open the build log
            </StaticLink>
            <StaticLink className="catalog-button catalog-button--secondary" href="/discover">
              Discover Fawxzzy
            </StaticLink>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
