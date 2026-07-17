import type { Metadata } from "next";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { DiscoveryGrid } from "@/components/discovery/discovery-grid";
import { SiteNav } from "@/components/site/site-nav";
import { productIdentity } from "@/config/product";
import { discoveryDestinations } from "@/data/discovery";

export const metadata: Metadata = {
  title: "Discover",
  description:
    "Open Fawxzzy Fitness, start a custom workout setup, join Discord, or follow Fawxzzy on TikTok and YouTube.",
  alternates: {
    canonical: "/discover",
  },
  openGraph: {
    title: `Discover | ${productIdentity.publicName}`,
    description:
      "The verified starting points for Fawxzzy apps, training, community, TikTok, and YouTube.",
    url: "/discover",
  },
};

export default function DiscoverPage() {
  return (
    <main className="discover-page app-theme-sage" id="main-content">
      <AmbientFitnessBackground
        intensity="medium"
        particleCount={14}
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

      <div className="shell-container discover-shell">
        <SiteNav current="discover" />

        <header className="discover-hero surface-panel">
          <p className="eyebrow">Start with what you need</p>
          <h1>Apps, training, and community—one clean jump away.</h1>
          <p>
            These are the current public homes. Each destination stays owned by the product or
            social surface behind it; {productIdentity.publicName} is the map, not a duplicate
            system.
          </p>
        </header>

        <DiscoveryGrid destinations={discoveryDestinations} />
      </div>
    </main>
  );
}
