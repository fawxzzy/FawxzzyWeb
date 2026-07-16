import Image from "next/image";
import Link from "next/link";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { AppSection } from "@/components/catalog/app-section";
import { productIdentity } from "@/config/product";
import { apps } from "@/data/apps";

type CatalogExperienceProps = {
  compatibilityIdentity?: "trove";
};

export function CatalogExperience({ compatibilityIdentity }: CatalogExperienceProps) {
  return (
    <main
      className="catalog-page app-theme-sage"
      data-compatibility-identity={compatibilityIdentity}
      id="main-content"
    >
      <AmbientFitnessBackground
        intensity="high"
        particleCount={18}
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

      <div className="shell-container">
        <nav aria-label="Primary" className="site-nav surface-panel">
          <Link className="site-nav__brand" href="/">
            {productIdentity.name}
          </Link>
          <div className="site-nav__links">
            <Link href="/">Home</Link>
            <Link aria-current="page" href={productIdentity.appsPath}>
              Apps
            </Link>
          </div>
        </nav>

        {compatibilityIdentity ? (
          <aside className="compatibility-note" aria-label="Compatibility route notice">
            <p>
              The Trove catalog now lives at <Link href={productIdentity.appsPath}>/apps</Link>.
              This route remains available as a reversible compatibility surface.
            </p>
          </aside>
        ) : null}

        <section aria-labelledby="apps-title" className="hero surface-panel">
          <div className="hero__copy">
            <div className="hero__intro">
              <p className="eyebrow">{productIdentity.name} / Apps</p>
              <h1 className="hero__title" id="apps-title">
                Apps, grounded in their real homes.
              </h1>
              <p className="hero__lede readable-column">
                Browse the Fawxzzy app catalog. Fitness and Mazer stay independently owned and
                open on their established production origins.
              </p>
              <div className="hero__art hero__art--inline">
                <Image
                  alt="Trove catalog fox mark"
                  height={1280}
                  src="/brand/trove-foxmark.png"
                  unoptimized
                  width={1280}
                />
              </div>
            </div>

            <div className="hero__actions">
              <a className="catalog-button catalog-button--primary" href="#catalog">
                Browse apps
              </a>
              <Link className="catalog-button catalog-button--secondary" href="/">
                FawxzzyWeb home
              </Link>
            </div>
          </div>
        </section>

        <div className="catalog-stack" id="catalog">
          {apps.map((app) => (
            <AppSection app={app} key={app.slug} />
          ))}
        </div>
      </div>
    </main>
  );
}
