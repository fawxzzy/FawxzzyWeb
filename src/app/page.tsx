import type { Metadata } from "next";
import Image from "next/image";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { AppStoreCard } from "@/components/catalog/app-store-card";
import { StructuredData } from "@/components/seo/structured-data";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";
import { apps } from "@/data/apps";
import { tiktokDestination } from "@/data/discovery";
import { publicPageMetadata, siteStructuredData } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: productIdentity.publicName,
  description: productIdentity.description,
  path: "/",
});

export default function Home() {
  return (
    <main className="home-page app-theme-sage" id="main-content">
      <StructuredData data={siteStructuredData()} id="fawxzzy-site-structured-data" />
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

      <div className="shell-container home-shell">
        <SiteNav current="home" />

        <section aria-labelledby="home-title" className="home-hero home-hero--storefront">
          <div className="home-hero__copy">
            <p className="eyebrow">Fawxzzy / Independent apps</p>
            <h1 id="home-title">Focused software, presented clearly.</h1>
            <p>
              A professional home for the Fawxzzy app catalog. Compare the products,
              watch real walkthroughs, and open each app at its current home.
            </p>
            <div className="hero__actions">
              <StaticLink className="catalog-button catalog-button--primary" href="/apps">
                Browse all apps
              </StaticLink>
              <StaticLink className="catalog-button catalog-button--secondary" href="/discover">
                Open Discover
              </StaticLink>
            </div>
          </div>

          <div className="home-hero__artwork">
            <Image
              alt="Fawxzzy independent app catalog"
              height={500}
              priority
              src="/brand/fawxzzy-banner-v2.png"
              unoptimized
              width={1500}
            />
          </div>
        </section>

        <dl aria-label="Catalog facts" className="storefront-facts">
          <div><dt>Available apps</dt><dd>{apps.length}</dd></div>
          <div><dt>Product proof</dt><dd>Real walkthroughs</dd></div>
          <div><dt>Access</dt><dd>Direct from each app</dd></div>
        </dl>

        <section aria-labelledby="home-apps-title" className="home-app-directory studio-section">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow">App directory</p>
              <h2 id="home-apps-title">Choose a product.</h2>
            </div>
            <StaticLink className="editorial-text-link" href="/apps">
              View the full catalog <span aria-hidden="true">&rarr;</span>
            </StaticLink>
          </div>
          <div className="home-app-directory__grid">
            {apps.map((app) => <AppStoreCard app={app} key={app.slug} />)}
          </div>
        </section>

        <section aria-labelledby="home-discover-title" className="home-discover surface-panel">
          <div>
            <p className="eyebrow">One external channel</p>
            <h2 id="home-discover-title">Product updates live on TikTok.</h2>
            <p>
              Discover stays intentionally small: this website for product truth,
              and TikTok for the public build in motion.
            </p>
          </div>
          <a
            className="catalog-button catalog-button--secondary"
            data-analytics-event="tiktok_open"
            href={tiktokDestination.href}
            rel="noreferrer"
            target="_blank"
          >
            {tiktokDestination.displayValue} <span aria-hidden="true">&nearr;</span>
          </a>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
