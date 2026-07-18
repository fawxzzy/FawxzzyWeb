import type { NextConfig } from "next";
import { assertBrowserSafeSupabasePublicKeyForBuild } from "./src/lib/auth/supabase-public-key.mjs";

assertBrowserSafeSupabasePublicKeyForBuild(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

const nextConfig: NextConfig = {
  output: "export",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "fawxzzy-fitness-local.vercel.app",
      },
      {
        protocol: "https",
        hostname: "fawxzzy-mazer.vercel.app",
      },
    ],
    unoptimized: true,
  },
};

export default nextConfig;
