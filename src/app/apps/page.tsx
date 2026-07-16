import type { Metadata } from "next";
import { CatalogExperience } from "@/components/catalog/catalog-experience";
import { productIdentity } from "@/config/product";

export const metadata: Metadata = {
  title: "Apps",
  description:
    "Browse the Fawxzzy app catalog with grounded links to Fitness and Mazer on their independently owned origins.",
  alternates: {
    canonical: productIdentity.appsPath,
  },
};

export default function AppsPage() {
  return <CatalogExperience />;
}
