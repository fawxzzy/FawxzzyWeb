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

        <section
          aria-labelledby="install-apps-title"
          className="catalog-install surface-panel"
        >
          <div className="catalog-install__intro">
            <h1 id="install-apps-title">How to install my apps</h1>
            <p>
              Open Fitness or Mazer first, then add it from your browser for quick
              access from your device.
            </p>
          </div>

          <ol className="catalog-install__steps">
            <li>
              <strong>iPhone or iPad</strong>
              <span>Tap Share, then Add to Home Screen.</span>
            </li>
            <li>
              <strong>Android</strong>
              <span>Open the browser menu, then tap Install app.</span>
            </li>
            <li>
              <strong>Windows or Mac</strong>
              <span>Use the install icon in the address bar or browser menu.</span>
            </li>
          </ol>
        </section>

        <section aria-label="Apps" className="catalog-launcher" id="catalog">
          {apps.map((app) => (
            <AppCatalogEntry
              iconSrc={app.display.icon.src}
              key={app.slug}
              name={app.name}
              origin={app.origin.current}
              posterSrc={app.display.poster.src}
              slug={app.slug}
            />
          ))}
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
