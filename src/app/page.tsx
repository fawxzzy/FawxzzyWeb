import type { Metadata } from "next";
import { StructuredData } from "@/components/seo/structured-data";
import { StorefrontExperience } from "@/components/storefront/storefront-experience";
import { productIdentity } from "@/config/product";
import { publicPageMetadata, siteStructuredData } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: productIdentity.publicName,
  description: productIdentity.description,
  path: "/",
});

export default function Home() {
  return (
    <>
      <StructuredData data={siteStructuredData()} id="fawxzzy-site-structured-data" />
      <StorefrontExperience />
    </>
  );
}
