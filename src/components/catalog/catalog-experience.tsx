import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { AppCatalogEntry } from "@/components/catalog/app-catalog-entry";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";
import { apps } from "@/data/apps";

type CatalogExperienceProps = { compatibilityIdentity?: "trove" };

export function CatalogExperience({ compatibilityIdentity }: CatalogExperienceProps) {
  return (
    <main
      className="catalog-page app-theme-sage"
      data-compatibility-identity={compatibilityIdentity}
      id="main-content"
    >
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

      <div className="shell-container">
        <SiteNav current="apps" />

        {compatibilityIdentity ? (
          <aside className="compatibility-note" aria-label="Compatibility route notice">
            <p>
              The Trove catalog now lives at <StaticLink href={productIdentity.appsPath}>/apps</StaticLink>.
              This route remains available as a reversible compatibility surface.
            </p>
          </aside>
        ) : null}

        <header className="catalog-editorial-hero catalog-editorial-hero--store">
          <div>
            <p className="eyebrow">{productIdentity.publicName} / App catalog</p>
            <h1 id="apps-title">Apps built to be used.</h1>
            <p>
              Browse current Fawxzzy products with direct access, grounded status,
              and real walkthroughs. No filler listings or invented marketplace signals.
            </p>
          </div>
          <dl className="catalog-overview" aria-label="Catalog overview">
            <div><dt>Apps</dt><dd>{apps.length}</dd></div>
            <div><dt>Status</dt><dd>Available now</dd></div>
            <div><dt>Proof</dt><dd>Live walkthroughs</dd></div>
          </dl>
        </header>

        <section aria-labelledby="apps-title" className="catalog-stack" id="catalog">
          {apps.map((app) => <AppCatalogEntry app={app} key={app.slug} />)}
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
