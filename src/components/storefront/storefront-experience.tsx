import Image from "next/image";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { AuthAwareSignInAction } from "@/components/account/auth-aware-sign-in-action";
import { productIdentity } from "@/config/product";
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
            <p className="eyebrow">Independent creator</p>
            <h1>Built by Fawxzzy.</h1>
            <p>
              Focused software for training, play, and everyday momentum&mdash;made
              to stay useful, understandable, and easy to use.
            </p>
            <div className="storefront-hero__actions">
              <StaticLink
                className="catalog-button catalog-button--primary"
                href={productIdentity.appsPath}
              >
                Explore apps
              </StaticLink>
              <AuthAwareSignInAction />
            </div>
          </div>
          <div className="storefront-hero__artwork">
            <Image
              alt="Fawxzzy creator brand"
              height={500}
              priority
              src="/brand/fawxzzy-banner-v2-hero.webp"
              unoptimized
              width={1500}
            />
          </div>
        </header>

        <section aria-labelledby="creator-profile-title" className="creator-profile">
          <div className="creator-profile__mark">
            <Image
              alt=""
              aria-hidden="true"
              height={1254}
              src="/brand/fawxzzy-wolf.png"
              unoptimized
              width={1254}
            />
          </div>
          <div className="creator-profile__copy">
            <p className="eyebrow">About Fawxzzy</p>
            <h2 id="creator-profile-title">Creator. Builder. Fitness. Gamer.</h2>
            <p>
              This is my home for the products I ship, the work behind them, and
              whatever I build next.
            </p>
          </div>
          <a
            className="catalog-button catalog-button--secondary"
            data-analytics-event="tiktok_open"
            data-destination-id={tiktokDestination.id}
            href={tiktokDestination.href}
            rel="noreferrer"
            target="_blank"
          >
            Follow {tiktokDestination.displayValue} <span aria-hidden="true">↗</span>
          </a>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
