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
              href="/#apps"
            >
              Browse apps
            </StaticLink>
          }
          description="Everything is still here—just in one cleaner place."
          eyebrow={productIdentity.legacyCatalogName}
          headingLevel={1}
          title="Apps moved home."
          variant="unavailable"
        />
        <SiteFooter />
      </div>
    </main>
  );
}
