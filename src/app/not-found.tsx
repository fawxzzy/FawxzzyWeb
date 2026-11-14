import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { NotFoundState } from "@/components/system/not-found-state";

export default function NotFound() {
  return (
    <main className="system-page system-page--locked app-theme-fawxzzy" id="main-content">
      <AmbientBrandBackground intensity="soft" particleCount={8} pulseEnabled={false} />
      <div className="shell-container system-shell">
        <SiteNav current="apps" />
        <NotFoundState />
        <SiteFooter />
      </div>
    </main>
  );
}
