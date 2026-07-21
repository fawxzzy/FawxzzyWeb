import type { Metadata } from "next";
import { CatalogExperience } from "@/components/catalog/catalog-experience";
import { productIdentity } from "@/config/product";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Apps",
  description:
    "Browse the Fawxzzy app catalog with grounded links to Fitness and Mazer on their independently owned origins.",
  path: productIdentity.appsPath,
});

export default function AppsPage() {
  return <CatalogExperience />;
}
