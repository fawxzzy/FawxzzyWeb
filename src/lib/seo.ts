import type { Metadata } from "next";
import { productIdentity } from "@/config/product";
import type { CatalogApp } from "@/data/apps";

const defaultSocialImage = productIdentity.linkPreview;

export const publicIndexableRoutes = [
  "/",
  productIdentity.appsPath,
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

export function catalogAppsStructuredData(catalog: CatalogApp[]) {
  const catalogUrl = absolutePublicUrl(productIdentity.appsPath);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": `${catalogUrl}#app-list`,
        "@type": "ItemList",
        itemListElement: catalog.map((app, index) => ({
            "@type": "ListItem",
            item: app.origin.current,
            name: app.name,
            position: index + 1,
        })),
      },
      ...catalog.map((app) => ({
        "@id": `${app.origin.current}/#application`,
        "@type": "SoftwareApplication",
        applicationCategory: app.category,
        description: app.description,
        featureList: app.detail.stories.map(({ title }) => title),
        image: absolutePublicUrl(app.display.poster.src),
        mainEntityOfPage: catalogUrl,
        name: app.name,
        operatingSystem: "Web browser",
        publisher: { "@id": `${productIdentity.canonicalOrigin}/#organization` },
        sameAs: app.origin.current,
        screenshot: absolutePublicUrl(app.display.poster.src),
        url: app.origin.current,
      })),
    ],
  };
}
