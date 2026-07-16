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
    default: productIdentity.name,
    template: `%s | ${productIdentity.name}`,
  },
  description: productIdentity.description,
  applicationName: productIdentity.name,
  manifest: "/manifest.webmanifest",
  keywords: [
    productIdentity.name,
    "Fawxzzy",
    "ATLAS",
    "apps",
    "software",
  ],
  appleWebApp: {
    capable: true,
    title: productIdentity.name,
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": productIdentity.name,
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
    title: productIdentity.name,
    description: productIdentity.description,
    siteName: productIdentity.name,
    url: productIdentity.canonicalOrigin,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: productIdentity.name,
    description: productIdentity.description,
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
