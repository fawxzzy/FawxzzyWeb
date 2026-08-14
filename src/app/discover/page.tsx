import type { Metadata } from "next";
import { CompatibilityRoute } from "@/components/system/compatibility-route";
import { productIdentity } from "@/config/product";
import { publicPageMetadata } from "@/lib/seo";

const unifiedStorefrontMetadata = publicPageMetadata({
  title: productIdentity.publicName,
  description: productIdentity.description,
  path: "/",
});

export const metadata: Metadata = {
  ...unifiedStorefrontMetadata,
  title: { absolute: productIdentity.publicName },
  robots: {
    index: false,
    follow: true,
  },
};

export default function DiscoverPage() {
  return (
    <CompatibilityRoute
      actionLabel="Go to Fawxzzy"
      current="home"
      description="Discovery now lives on the Fawxzzy home page."
      destination="/"
      identity="discover"
      label="Discovery"
      title="Everything is together now."
    />
  );
}
