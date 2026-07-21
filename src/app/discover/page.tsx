import Image from "next/image";
import type { Metadata } from "next";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { DiscoveryGrid } from "@/components/discovery/discovery-grid";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";
import { discoveryDestinations } from "@/data/discovery";

export const metadata: Metadata = {
  title: "Discover",
  description:
    "The Fawxzzy ecosystem hub for using the apps, following the work, and joining the community.",
  alternates: {
    canonical: "/discover",
  },
  openGraph: {
    title: `Discover | ${productIdentity.publicName}`,
    description:
      "Use the apps, follow what is being built, and join the Fawxzzy community from one verified home.",
    url: "/discover",
  },
};

export default function DiscoverPage() {
  return (
    <main className="discover-page editorial-page app-theme-sage" id="main-content">
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

      <div className="shell-container discover-shell editorial-shell">
        <SiteNav current="discover" />

        <header className="editorial-hero editorial-hero--discover">
          <div className="editorial-hero__copy">
            <p className="eyebrow">Fawxzzy / Ecosystem hub</p>
            <h1>Build. Train. Create.</h1>
            <p>
              Use the products, follow what is being built, and find the people and places
              around the work. This is the clear starting point for the full Fawxzzy ecosystem.
            </p>
            <div className="hero__actions">
              <StaticLink className="catalog-button catalog-button--primary" href="/apps">
                Use the apps
              </StaticLink>
              <StaticLink className="catalog-button catalog-button--secondary" href="/newsletter">
                Follow the build
              </StaticLink>
            </div>
            <ul aria-label="Ways to explore Fawxzzy" className="editorial-hero__orientation">
              <li>Use the apps</li>
              <li>Follow the build</li>
              <li>Join the community</li>
            </ul>
          </div>

          <div className="editorial-hero__artwork" aria-hidden="true">
            <Image
              alt=""
              className="editorial-hero__mark"
              height={800}
              priority
              src="/brand/fawxzzy-wolf.png"
              width={800}
            />
          </div>
        </header>

        <DiscoveryGrid destinations={discoveryDestinations} />

        <SiteFooter />
      </div>
    </main>
  );
}
