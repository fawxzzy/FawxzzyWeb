import type { CatalogApp } from "@/data/apps";
import { AppStoreCard } from "@/components/catalog/app-store-card";
import { ReviewPlaceholder } from "@/components/catalog/review-placeholder";
import { TrailerDisclosure } from "@/components/catalog/trailer-disclosure";

type AppCatalogEntryProps = {
  app: CatalogApp;
};

export function AppCatalogEntry({ app }: AppCatalogEntryProps) {
  return (
    <article className="app-catalog-entry surface-panel" id={app.slug}>
      <AppStoreCard app={app} />
      <TrailerDisclosure appName={app.name} appSlug={app.slug} trailer={app.trailer} />
      <ReviewPlaceholder appName={app.name} appSlug={app.slug} compact />
    </article>
  );
}
