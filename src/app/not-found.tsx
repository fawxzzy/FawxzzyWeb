import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { SystemState } from "@/components/system/system-state";
import { productIdentity } from "@/config/product";

export default function NotFound() {
  return (
    <main className="system-page app-theme-sage" id="main-content">
      <AmbientFitnessBackground intensity="soft" particleCount={8} pulseEnabled={false} />
      <div className="shell-container system-shell">
        <SiteNav current="apps" />
        <SystemState
          actions={
            <>
              <StaticLink className="catalog-button catalog-button--primary" href="/apps">
                Explore apps
              </StaticLink>
              <StaticLink className="catalog-button catalog-button--secondary" href="/">
                Return home
              </StaticLink>
            </>
          }
          description={
            <>The address does not match a current {productIdentity.publicName} page.</>
          }
          eyebrow="Page not found"
          headingLevel={1}
          title="This page is not here."
          variant="empty"
        />
        <SiteFooter />
      </div>
    </main>
  );
}
