import type { Metadata } from "next";
import { CatalogExperience } from "@/components/catalog/catalog-experience";
import { productIdentity } from "@/config/product";

export const metadata: Metadata = {
  title: "Apps",
  description: "Compatibility access to the FawxzzyWeb app catalog.",
  alternates: {
    canonical: productIdentity.appsPath,
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function TroveCompatibilityPage() {
  return <CatalogExperience compatibilityIdentity="trove" />;
}
