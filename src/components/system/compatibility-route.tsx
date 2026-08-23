import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { SystemState } from "@/components/system/system-state";

type CompatibilityRouteProps = {
  actionLabel: string;
  current: "apps" | "home";
  description: string;
  destination: string;
  identity: "discover" | "trove";
  label: string;
  title: string;
};

export function CompatibilityRoute({
  actionLabel,
  current,
  description,
  destination,
  identity,
  label,
  title,
}: CompatibilityRouteProps) {
  return (
    <main
      className="system-page app-theme-fawxzzy"
      data-compatibility-identity={identity}
      id="main-content"
    >
      <AmbientBrandBackground intensity="soft" particleCount={6} pulseEnabled={false} />
      <div className="shell-container system-shell">
        <SiteNav current={current} />
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
