import type { Metadata } from "next";
import Image from "next/image";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";

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

        <section aria-labelledby="home-title" className="home-hero surface-panel">
          <div className="home-hero__copy">
            <p className="eyebrow">Fawxzzy</p>
            <h1 id="home-title">Useful software should stay within reach.</h1>
            <p>
              I&apos;m Fawxzzy—an independent builder creating practical software,
              games, and the platform that connects them. I share the work as I
              learn, ship, and make it better.
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
                Meet Fawxzzy
              </StaticLink>
              <StaticLink className="catalog-button" href="/newsletter">
                Building Fawxzzy weekly
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

        <section aria-labelledby="mission-title" className="home-mission">
          <div className="section-heading">
            <p className="eyebrow">What I&apos;m building</p>
            <h2 id="mission-title">One platform. Focused products. A human reason behind them.</h2>
            <p>
              Fawxzzy brings my software, fitness work, games, and community into one
              clear home without flattening each product into the same thing.
            </p>
          </div>

          <div className="home-principles">
            <article className="home-principle surface-panel">
              <p className="eyebrow">Why</p>
              <h3>Make useful tools more affordable.</h3>
              <p>
                Good software should earn its place by helping people, not by hiding
                basic value behind clutter, pressure, or confusing pricing.
              </p>
            </article>
            <article className="home-principle surface-panel">
              <p className="eyebrow">How</p>
              <h3>Build in public and improve from real use.</h3>
              <p>
                I start with a focused problem, keep the product understandable, and
                use honest feedback to decide what deserves to grow next.
              </p>
            </article>
            <article className="home-principle surface-panel">
              <p className="eyebrow">Where it goes</p>
              <h3>A connected home for software, services, and games.</h3>
              <p>
                The long-term platform gives people one trustworthy Fawxzzy identity
                while every app keeps a clear purpose and a reliable home of its own.
              </p>
            </article>
          </div>
        </section>

        <section aria-labelledby="apps-callout-title" className="discovery-callout surface-panel">
          <div>
            <p className="eyebrow">Software and games</p>
            <h2 id="apps-callout-title">See what is live and what I&apos;m building next.</h2>
            <p>Each product has a real trailer, a focused page, and its current destination.</p>
          </div>
          <StaticLink
            className="catalog-button catalog-button--primary"
            href={productIdentity.appsPath}
          >
            View the apps
          </StaticLink>
        </section>

        <section aria-labelledby="newsletter-callout-title" className="discovery-callout surface-panel">
          <div>
            <p className="eyebrow">Building Fawxzzy weekly</p>
            <h2 id="newsletter-callout-title">Follow the work without chasing every feed.</h2>
            <p>
              The weekly archive collects the build story, practical lessons, and what happens next.
              Subscriber delivery is being set up with a privacy-safe email provider before addresses are collected.
            </p>
          </div>
          <StaticLink className="catalog-button catalog-button--primary" href="/newsletter">
            Open the archive
          </StaticLink>
        </section>
      </div>
    </main>
  );
}
