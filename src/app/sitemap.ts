import type { MetadataRoute } from "next";
import { productIdentity } from "@/config/product";
import { apps } from "@/data/apps";
import { absolutePublicUrl } from "@/lib/seo";
import { legalCenter } from "@/config/legal";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: productIdentity.canonicalOrigin,
      changeFrequency: "weekly",
      priority: 1,
      images: [absolutePublicUrl("/brand/fawxzzy-banner-v2.png")],
    },
    {
      url: absolutePublicUrl(productIdentity.appsPath),
      changeFrequency: "weekly",
      priority: 0.9,
      images: apps.map((app) => absolutePublicUrl(app.display.poster.src)),
    },
    ...Object.values(legalCenter.documents).map((document) => ({
      url: absolutePublicUrl(document.path),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
