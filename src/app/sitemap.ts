import type { MetadataRoute } from "next";
import { productIdentity } from "@/config/product";
import { apps, getAppDetailPath } from "@/data/apps";
import { absolutePublicUrl } from "@/lib/seo";

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
    },
    ...apps.map((app) => ({
      url: absolutePublicUrl(getAppDetailPath(app)),
      changeFrequency: "weekly" as const,
      priority: 0.8,
      images: [absolutePublicUrl(app.trailer.poster.src)],
    })),
    {
      url: absolutePublicUrl("/discover"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: absolutePublicUrl("/newsletter"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];
}
