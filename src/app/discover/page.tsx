import type { Metadata } from "next";
import { StorefrontExperience } from "@/components/storefront/storefront-experience";
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
};

export default function DiscoverPage() {
  return <StorefrontExperience compatibilityIdentity="discover" />;
}
