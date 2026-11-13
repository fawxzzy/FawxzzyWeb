import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { SystemState } from "@/components/system/system-state";

type CompatibilityRouteProps = {
  actionLabel: string;
  description: string;
  destination: string;
  identity: "discover" | "home" | "trove";
  label: string;
  /**
   * Static-export fallback for hosts that do not apply vercel.json redirects:
   * asks the browser to continue to `destination` immediately.
   */
  redirectToDestination?: boolean;
  title: string;
};

export function CompatibilityRoute({
  actionLabel,
  description,
  destination,
  identity,
  label,
  redirectToDestination = false,
  title,
}: CompatibilityRouteProps) {
  return (
    <main
      className="system-page app-theme-fawxzzy"
      data-compatibility-identity={identity}
      id="main-content"
    >
      {redirectToDestination ? (
        <meta httpEquiv="refresh" content={`0;url=${destination}`} />
      ) : null}
      <AmbientBrandBackground intensity="soft" particleCount={6} pulseEnabled={false} />
      <div className="shell-container system-shell">
        <SiteNav current="apps" />
        <SystemState
          actions={
            <StaticLink className="catalog-button catalog-button--primary" href={destination}>
              {actionLabel} <span aria-hidden="true">&rarr;</span>
            </StaticLink>
          }
          description={description}
          eyebrow={label}
          headingLevel={1}
          title={title}
          variant="unavailable"
        />
        <SiteFooter />
      </div>
    </main>
  );
}
