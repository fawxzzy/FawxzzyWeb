import type { CatalogApp } from "@/data/apps";
import { ProductShowcase } from "@/components/catalog/product-showcase";

type AppCatalogEntryProps = {
  app: CatalogApp;
};

export function AppCatalogEntry({ app }: AppCatalogEntryProps) {
  return <ProductShowcase app={app} />;
}
