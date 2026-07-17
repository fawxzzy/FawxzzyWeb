import type { Metadata } from "next";
import { accountCanonicalUrl, accountContract } from "@/config/account";
import { productIdentity } from "@/config/product";

export function accountPageMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  const canonical = accountCanonicalUrl(path);
  return {
    title,
    description,
    applicationName: productIdentity.publicName,
    alternates: { canonical },
    metadataBase: new URL(accountContract.canonicalOrigin),
    openGraph: {
      title: `${title} | ${productIdentity.publicName}`,
      description,
      siteName: productIdentity.publicName,
      type: "website",
      url: canonical,
    },
    robots: { follow: false, index: false },
  };
}
