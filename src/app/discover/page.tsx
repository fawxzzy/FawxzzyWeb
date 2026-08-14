import Image from "next/image";
import type { Metadata } from "next";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { DiscoveryGrid } from "@/components/discovery/discovery-grid";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { discoveryDestinations } from "@/data/discovery";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Discover",
  description: "Discover Fawxzzy apps on the website and follow the public build on TikTok.",
  path: "/discover",
});

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
            <p className="eyebrow">Fawxzzy / Discover</p>
            <h1>Apps here. The build on TikTok.</h1>
            <p>
              A deliberately focused discovery page: use the products on this website,
              or follow the public work in motion on TikTok.
            </p>
            <div className="hero__actions">
              <StaticLink className="catalog-button catalog-button--primary" href="/apps">
                Browse apps
              </StaticLink>
              <a
                className="catalog-button catalog-button--secondary"
                data-analytics-event="tiktok_open"
                href={discoveryDestinations[0].href}
                rel="noreferrer"
                target="_blank"
              >
                Open TikTok <span aria-hidden="true">↗</span>
              </a>
            </div>
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
