import type { Metadata } from "next";
import { productIdentity } from "@/config/product";
import type { CatalogApp } from "@/data/apps";
import { getAppDetailPath } from "@/data/apps";

const defaultSocialImage = {
  alt: "Fawxzzy — creator, builder, fitness, and gaming",
  height: 500,
  url: "/brand/fawxzzy-banner-v2.png",
  width: 1500,
} as const;

export const publicIndexableRoutes = [
  "/",
  productIdentity.appsPath,
  "/apps/fitness",
  "/apps/mazer",
  "/discover",
  "/newsletter",
] as const;

export function absolutePublicUrl(path: string) {
  return new URL(path, productIdentity.canonicalOrigin).href;
}

type PublicPageMetadataInput = {
  description: string;
  image?: {
    alt: string;
    url: string;
  };
  path: string;
  title: string;
};

export function publicPageMetadata({
  description,
  image,
  path,
  title,
}: PublicPageMetadataInput): Metadata {
  const socialTitle =
    title === productIdentity.publicName
      ? productIdentity.publicName
      : `${title} | ${productIdentity.publicName}`;
  const socialImage = image ?? defaultSocialImage;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: socialTitle,
      description,
      images: [socialImage],
      siteName: productIdentity.publicName,
      type: "website",
      url: path,
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [socialImage.url],
    },
  };
}

export function siteStructuredData() {
  const organizationId = `${productIdentity.canonicalOrigin}/#organization`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": organizationId,
        "@type": "Organization",
        description: productIdentity.description,
        image: absolutePublicUrl(defaultSocialImage.url),
        logo: absolutePublicUrl("/app/icon-512.png"),
        name: productIdentity.publicName,
        url: productIdentity.canonicalOrigin,
      },
      {
        "@id": `${productIdentity.canonicalOrigin}/#website`,
        "@type": "WebSite",
        description: productIdentity.description,
        inLanguage: "en",
        name: productIdentity.publicName,
        publisher: { "@id": organizationId },
        url: productIdentity.canonicalOrigin,
      },
    ],
  };
}

export function appStructuredData(app: CatalogApp) {
  const detailPath = getAppDetailPath(app);
  const detailUrl = absolutePublicUrl(detailPath);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": `${detailUrl}#application`,
        "@type": "SoftwareApplication",
        applicationCategory: app.category,
        description: app.description,
        featureList: app.detail.capabilities.map(({ title }) => title),
        image: absolutePublicUrl(app.trailer.poster.src),
        mainEntityOfPage: detailUrl,
        name: app.name,
        operatingSystem: "Web browser",
        publisher: { "@id": `${productIdentity.canonicalOrigin}/#organization` },
        sameAs: app.origin.current,
        screenshot: absolutePublicUrl(app.trailer.poster.src),
        url: detailUrl,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            item: absolutePublicUrl(productIdentity.appsPath),
            name: "Apps",
            position: 1,
          },
          {
            "@type": "ListItem",
            item: detailUrl,
            name: app.name,
            position: 2,
          },
        ],
      },
    ],
  };
}
