import Image from "next/image";
import type { Metadata } from "next";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { DiscoveryGrid } from "@/components/discovery/discovery-grid";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";
import { discoveryDestinations } from "@/data/discovery";

export const metadata: Metadata = {
  title: "Discover",
  description:
    "The canonical Fawxzzy hub for apps, training, community, social profiles, support, and gaming.",
  alternates: {
    canonical: "/discover",
  },
  openGraph: {
    title: `Discover | ${productIdentity.publicName}`,
    description:
      "One verified home for Fawxzzy apps, training, community, social profiles, and everything next.",
    url: "/discover",
  },
};

export default function DiscoverPage() {
  return (
    <main className="discover-page app-theme-sage" id="main-content">
      <AmbientFitnessBackground
        intensity="soft"
        particleCount={8}
        palette={{
          base: "#070C0A",
          glow: "#7F977C",
          glowStrong: "#A4B5A3",
          wisp: "#5C725D",
          particle: "#CFD8D0",
          warm: "#1C2420",
        }}
      />

      <div className="shell-container discover-shell">
        <SiteNav current="discover" />

        <header className="discover-hero surface-panel">
          <Image
            alt="Fawxzzy wolf mark"
            className="discover-hero__mark"
            height={800}
            priority
            src="/brand/fawxzzy-wolf.png"
            width={800}
          />
          <div className="discover-hero__copy">
            <p className="eyebrow">The official Fawxzzy hub</p>
            <h1>Build. Train. Create.</h1>
            <p>
              Apps, training, community, and every verified profile—organized in one clean,
              permanent home.
            </p>
            <div className="hero__actions">
              <StaticLink className="catalog-button catalog-button--primary" href="/apps">
                Explore the apps
              </StaticLink>
              <a className="catalog-button" href="#discovery-social">
                Find Fawxzzy online
              </a>
              <StaticLink className="catalog-button" href="/newsletter">
                Building Fawxzzy weekly
              </StaticLink>
            </div>
          </div>
        </header>

        <DiscoveryGrid destinations={discoveryDestinations} />

        <section aria-labelledby="discover-newsletter-title" className="discovery-callout surface-panel">
          <div>
            <p className="eyebrow">Follow the build</p>
            <h2 id="discover-newsletter-title">The weekly archive lives here, not in another link hub.</h2>
            <p>
              Read the Building Fawxzzy record in one place. Email sign-up remains intentionally closed
              until its delivery provider and privacy controls are live.
            </p>
          </div>
          <StaticLink className="catalog-button catalog-button--primary" href="/newsletter">
            View the newsletter
          </StaticLink>
        </section>
      </div>
    </main>
  );
}
