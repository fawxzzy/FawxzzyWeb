import type { Metadata } from "next";
import { CompatibilityRoute } from "@/components/system/compatibility-route";
import { productIdentity } from "@/config/product";
import { publicPageMetadata } from "@/lib/seo";

// Fawxzzy has no separate home page: the root opens the Apps catalog. Production sends `/` to
// `/apps` through the vercel.json redirect before this page is served; this static fallback
// keeps `/` working (and moving on to Apps) on hosts that ignore vercel.json, such as the
// local static server used by tests.
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

export default function RootRedirectPage() {
  return (
    <CompatibilityRoute
      actionLabel="Browse apps"
      description="Fawxzzy opens on the app catalog."
      destination={productIdentity.appsPath}
      identity="home"
      label={productIdentity.publicName}
      redirectToDestination
      title="Opening Apps."
    />
  );
}
