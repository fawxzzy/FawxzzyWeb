import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { AppCatalogEntry } from "@/components/catalog/app-catalog-entry";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { apps } from "@/data/apps";

export function CatalogExperience() {
  return (
    <main
      className="catalog-page app-theme-sage"
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

        <header className="catalog-editorial-hero catalog-editorial-hero--store">
          <div>
            <p className="eyebrow">All apps</p>
            <h1 id="apps-title">Pick an app and jump in.</h1>
            <p>Watch a quick preview, then open the app that fits.</p>
          </div>
        </header>

        <section aria-labelledby="apps-title" className="catalog-stack" id="catalog">
          {apps.map((app) => <AppCatalogEntry app={app} key={app.slug} />)}
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
