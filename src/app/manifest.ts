import type { MetadataRoute } from "next";
import { productIdentity } from "@/config/product";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: productIdentity.publicName,
    short_name: productIdentity.publicName,
    description: productIdentity.description,
    start_url: "/",
    display: "standalone",
    background_color: "#070c0a",
    theme_color: "#7f977c",
    icons: [
      {
        src: "/app/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/app/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
