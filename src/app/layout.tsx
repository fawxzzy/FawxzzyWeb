import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TROVE_PREVIEW_IMAGE = "/brand/atlas-sigil-master.png";

function resolveMetadataBase() {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    "https://fawxzzy-trove.vercel.app",
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return new URL(candidate);
    } catch {
      continue;
    }
  }

  return undefined;
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: "Trove",
    template: "%s | Trove",
  },
  description:
    "Trove is the one-page storefront for live Fawxzzy apps, with grounded launch links, app-owned install flow, and inline screenshot rails.",
  applicationName: "Trove",
  manifest: "/manifest.webmanifest",
  keywords: [
    "Trove",
    "Fawxzzy",
    "ATLAS",
    "PWA catalog",
    "app launcher",
  ],
  appleWebApp: {
    capable: true,
    title: "Trove",
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Trove",
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/app/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/app/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    title: "Trove",
    description:
      "A one-page storefront for live Fawxzzy apps with grounded launch links and inline screenshots.",
    type: "website",
    images: [
      {
        url: TROVE_PREVIEW_IMAGE,
        width: 1280,
        height: 1280,
        alt: "Trove sigil and barbell brand art",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Trove",
    description:
      "A one-page storefront for live Fawxzzy apps with grounded launch links and inline screenshots.",
    images: [TROVE_PREVIEW_IMAGE],
  },
};

export const viewport: Viewport = {
  themeColor: "#7f977c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full">
        <main className="safe-area-main">{children}</main>
      </body>
    </html>
  );
}
