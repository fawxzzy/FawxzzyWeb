import type { Metadata } from "next";
import { CatalogExperience } from "@/components/catalog/catalog-experience";
import { StructuredData } from "@/components/seo/structured-data";
import { productIdentity } from "@/config/product";
import { apps } from "@/data/apps";
import { catalogAppsStructuredData, publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Apps",
  description:
    "Browse the Fawxzzy app catalog and learn how to install Fitness or Mazer from your browser.",
  path: productIdentity.appsPath,
});

export default function AppsPage() {
  return (
    <>
      <StructuredData
        data={catalogAppsStructuredData(apps)}
        id="fawxzzy-app-catalog-structured-data"
      />
      <CatalogExperience />
    </>
  );
}
