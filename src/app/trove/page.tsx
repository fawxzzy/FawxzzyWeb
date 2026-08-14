import type { Metadata } from "next";
import { CompatibilityRoute } from "@/components/system/compatibility-route";
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
    <CompatibilityRoute
      actionLabel="Browse apps"
      current="apps"
      description="The app catalog has a shorter name and a clearer home."
      destination="/apps"
      identity="trove"
      label={productIdentity.legacyCatalogName}
      title="Trove is now Apps."
    />
  );
}
