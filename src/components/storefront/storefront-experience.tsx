import type { CSSProperties } from "react";
import Image from "next/image";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { apps, getAppDetailPath } from "@/data/apps";
import { tiktokDestination } from "@/data/discovery";

type StorefrontExperienceProps = {
  compatibilityIdentity?: "discover";
};

type StorefrontAccentStyle = CSSProperties & {
  "--app-accent": string;
};

export function StorefrontExperience({
  compatibilityIdentity,
}: StorefrontExperienceProps) {
  return (
    <main
      className="home-page storefront-page app-theme-sage"
      data-compatibility-identity={compatibilityIdentity}
      id="main-content"
    >
      <AmbientFitnessBackground
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
            <p className="eyebrow">Independent apps by Fawxzzy</p>
            <h1>Find something worth keeping.</h1>
            <p>Focused apps for training, play, and everyday momentum.</p>
            <div className="storefront-hero__actions">
              <StaticLink className="catalog-button catalog-button--primary" href="#apps">
                Explore apps
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
              src="/brand/fawxzzy-banner-v2.png"
              unoptimized
              width={1500}
            />
          </div>
        </header>

        <section aria-labelledby="storefront-apps-title" className="storefront-apps" id="apps">
          <header className="storefront-section-heading">
            <div>
              <p className="eyebrow">Featured apps</p>
              <h2 id="storefront-apps-title">Choose your next app.</h2>
            </div>
            <StaticLink href="/apps">See every app</StaticLink>
          </header>

          <div className="storefront-app-grid">
            {apps.map((app) => {
              const accentStyle: StorefrontAccentStyle = {
                "--app-accent": app.accent.from,
              };

              return (
                <article
                  className="storefront-app"
                  data-app-card={app.slug}
                  key={app.slug}
                  style={accentStyle}
                >
                  <StaticLink
                    aria-label={`View ${app.name}`}
                    className="storefront-app__media"
                    data-analytics-app={app.slug}
                    data-analytics-event="catalog_app_view"
                    href={getAppDetailPath(app)}
                  >
                    <Image
                      alt={`${app.name} app preview`}
                      fill
                      sizes="(max-width: 760px) 100vw, 50vw"
                      src={app.trailer.poster.src}
                      unoptimized
                    />
                  </StaticLink>
                  <div className="storefront-app__body">
                    <Image
                      alt={`${app.name} icon`}
                      className="storefront-app__icon"
                      height={72}
                      src={app.icon.src}
                      unoptimized
                      width={72}
                    />
                    <div className="storefront-app__copy">
                      <p>{app.category}</p>
                      <h3>{app.name}</h3>
                      <span>{app.tagline}</span>
                    </div>
                    <StaticLink
                      aria-label={`View ${app.name}`}
                      className="storefront-app__button"
                      data-analytics-app={app.slug}
                      data-analytics-event="catalog_app_view"
                      href={getAppDetailPath(app)}
                    >
                      View
                    </StaticLink>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="storefront-social-title" className="storefront-social">
          <div className="storefront-social__mark" aria-hidden="true">
            TikTok
          </div>
          <div>
            <p className="eyebrow">Behind the apps</p>
            <h2 id="storefront-social-title">See what is being built.</h2>
            <p>Short demos, updates, and the work in progress.</p>
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
