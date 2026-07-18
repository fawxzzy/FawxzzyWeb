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
          <p className="eyebrow">Discover</p>
          <h1>Find what you need.</h1>
          <p>
            Apps, training, community, and socials—all in one simple place.
          </p>
        </header>

        <DiscoveryGrid destinations={discoveryDestinations} />
      </div>
    </main>
  );
}
