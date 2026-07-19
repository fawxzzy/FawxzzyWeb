import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { productIdentity } from "@/config/product";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(productIdentity.canonicalOrigin),
  title: {
    default: productIdentity.publicName,
    template: `%s | ${productIdentity.publicName}`,
  },
  description: productIdentity.description,
  applicationName: productIdentity.publicName,
  manifest: "/manifest.webmanifest",
  keywords: [
    productIdentity.publicName,
    "ATLAS",
    "apps",
    "software",
  ],
  appleWebApp: {
    capable: true,
    title: productIdentity.publicName,
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
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
    title: productIdentity.publicName,
    description: productIdentity.description,
    siteName: productIdentity.publicName,
    url: productIdentity.canonicalOrigin,
    type: "website",
    images: [
      {
        alt: "Fawxzzy — creator, builder, fitness, and gaming",
        height: 500,
        url: "/brand/fawxzzy-banner-v2.png",
        width: 1500,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: productIdentity.publicName,
    description: productIdentity.description,
    images: ["/brand/fawxzzy-banner-v2.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#7f977c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
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
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="safe-area-main">{children}</div>
      </body>
    </html>
  );
}
