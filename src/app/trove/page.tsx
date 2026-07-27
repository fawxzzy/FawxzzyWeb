import type { Metadata } from "next";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { SystemState } from "@/components/system/system-state";
import { productIdentity } from "@/config/product";

export const metadata: Metadata = {
  title: "Apps",
  description: "Compatibility access to the Fawxzzy app catalog.",
  alternates: {
    canonical: productIdentity.appsPath,
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function TroveCompatibilityPage() {
  return (
    <main
      className="system-page app-theme-sage"
      data-compatibility-identity="trove"
      id="main-content"
    >
      <AmbientFitnessBackground intensity="soft" particleCount={8} pulseEnabled={false} />
      <div className="shell-container system-shell">
        <SiteNav current="apps" />
        <SystemState
          actions={
            <StaticLink
              className="catalog-button catalog-button--primary"
              href={productIdentity.appsPath}
            >
              Open the app catalog
            </StaticLink>
          }
          description={
            <>
              {productIdentity.legacyCatalogName} remains available only as a reversible
              compatibility surface. The current catalog and every product detail now live under
              {` ${productIdentity.appsPath}`}.
            </>
          }
          details={
            <p>
              This route is excluded from search indexing and points its canonical metadata to
              {` ${productIdentity.appsPath}`}.
            </p>
          }
          eyebrow={`${productIdentity.legacyCatalogName} compatibility`}
          headingLevel={1}
          title="The catalog moved to Apps."
          variant="unavailable"
        />
        <SiteFooter />
      </div>
    </main>
  );
}
