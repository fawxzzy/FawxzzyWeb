import Image from "next/image";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { ProductShowcase } from "@/components/catalog/product-showcase";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { apps } from "@/data/apps";
import { tiktokDestination } from "@/data/discovery";

export function StorefrontExperience() {
  return (
    <main
      className="home-page storefront-page app-theme-fawxzzy"
      id="main-content"
    >
      <AmbientBrandBackground
        intensity="soft"
        particleCount={6}
        palette={{
          base: "#070b09",
          glow: "#8da08d",
          glowStrong: "#c8d2c8",
          wisp: "#4f6253",
          particle: "#dce3dc",
          warm: "#202a24",
        }}
      />

      <div className="shell-container storefront-shell">
        <SiteNav current="home" />

        <header className="storefront-hero">
          <div className="storefront-hero__copy">
            <p className="eyebrow">Fawxzzy apps</p>
            <h1>Train. Play. Keep moving.</h1>
            <p>{apps.length} focused apps. One simple place to choose what comes next.</p>
            <div className="storefront-hero__actions">
              <StaticLink
                className="catalog-button catalog-button--primary"
                href="#apps"
              >
                Choose an app <span aria-hidden="true">&darr;</span>
              </StaticLink>
              <a
                className="catalog-button catalog-button--ghost"
                data-analytics-event="tiktok_open"
                href={tiktokDestination.href}
                rel="noreferrer"
                target="_blank"
              >
                Follow on TikTok <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
          <div className="storefront-hero__artwork">
            <Image
              alt="Fawxzzy apps"
              height={500}
              priority
              src="/brand/fawxzzy-banner-v2-hero.webp"
              unoptimized
              width={1500}
            />
          </div>
        </header>

        <section aria-labelledby="storefront-apps-title" className="storefront-apps" id="apps">
          <header className="storefront-section-heading">
            <div>
              <p className="eyebrow">Choose your app</p>
              <h2 id="storefront-apps-title">Built for momentum and play.</h2>
            </div>
          </header>

          <div className="storefront-app-grid">
            {apps.map((app, index) => (
              <ProductShowcase
                app={app}
                compact
                headingLevel={3}
                key={app.slug}
                priority={index === 0}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="storefront-social-title" className="storefront-social">
          <div className="storefront-social__mark" aria-hidden="true">
            TikTok
          </div>
          <div>
            <p className="eyebrow">On TikTok</p>
            <h2 id="storefront-social-title">See the next build.</h2>
            <p>Short demos and product updates, straight from the workbench.</p>
          </div>
          <a
            className="catalog-button catalog-button--secondary"
            data-analytics-event="tiktok_open"
            data-destination-id={tiktokDestination.id}
            href={tiktokDestination.href}
            rel="noreferrer"
            target="_blank"
          >
            {tiktokDestination.displayValue} <span aria-hidden="true">↗</span>
          </a>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
