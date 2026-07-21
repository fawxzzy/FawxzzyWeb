import type { MetadataRoute } from "next";
import { productIdentity } from "@/config/product";
import { absolutePublicUrl } from "@/lib/seo";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/account",
        "/auth/",
        "/login",
        "/reset-password",
        productIdentity.legacyCatalogPath,
      ],
    },
    sitemap: absolutePublicUrl("/sitemap.xml"),
    host: productIdentity.canonicalOrigin,
  };
}
