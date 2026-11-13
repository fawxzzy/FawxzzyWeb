import type { Metadata } from "next";
import { CompatibilityRoute } from "@/components/system/compatibility-route";
import { productIdentity } from "@/config/product";
import { publicPageMetadata } from "@/lib/seo";

const appsMetadata = publicPageMetadata({
  title: productIdentity.publicName,
  description: productIdentity.description,
  path: productIdentity.appsPath,
});

export const metadata: Metadata = {
  ...appsMetadata,
  title: { absolute: productIdentity.publicName },
  robots: {
    index: false,
    follow: true,
  },
};

export default function DiscoverPage() {
  return (
    <CompatibilityRoute
      actionLabel="Browse apps"
      description="Discovery now lives on the Fawxzzy apps page."
      destination={productIdentity.appsPath}
      identity="discover"
      label="Discovery"
      title="Everything is together now."
    />
  );
}
