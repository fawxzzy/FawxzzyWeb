import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { AppSection } from "@/components/catalog/app-section";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
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
        <SiteNav current="apps" />

        {compatibilityIdentity ? (
          <aside className="compatibility-note" aria-label="Compatibility route notice">
            <p>
              The Trove catalog now lives at{" "}
              <StaticLink href={productIdentity.appsPath}>
                /apps
              </StaticLink>
              .
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
                Watch each product first, then open it at its real home. Fitness and Mazer stay
                independently owned on their established production origins.
              </p>
              <div className="catalog-hero__stats" aria-label="Catalog summary">
                <span>
                  <strong>{apps.length}</strong> live apps
                </span>
                <span>
                  <strong>{apps.length}</strong> trailers
                </span>
                <span>
                  <strong>1</strong> shared media source
                </span>
              </div>
            </div>

            <div className="hero__actions">
              <a className="catalog-button catalog-button--primary" href="#catalog">
                Browse apps
              </a>
              <StaticLink className="catalog-button catalog-button--secondary" href="/">
                FawxzzyWeb home
              </StaticLink>
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
