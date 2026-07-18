import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppDetailExperience } from "@/components/catalog/app-detail-experience";
import { productIdentity } from "@/config/product";
import { apps, getAppBySlug, getAppDetailPath } from "@/data/apps";

type AppDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return apps.map((app) => ({ slug: app.slug }));
}

export async function generateMetadata({ params }: AppDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const app = getAppBySlug(slug);

  if (!app) {
    return {};
  }

  const canonical = getAppDetailPath(app);

  return {
    title: app.name,
    description: app.tagline,
    alternates: { canonical },
    openGraph: {
      title: `${app.name} | ${productIdentity.publicName}`,
      description: app.tagline,
      images: [{ alt: `${app.name} icon`, url: app.icon.src }],
      url: canonical,
    },
  };
}

export default async function AppDetailPage({ params }: AppDetailPageProps) {
  const { slug } = await params;
  const app = getAppBySlug(slug);

  if (!app) {
    notFound();
  }

  return <AppDetailExperience app={app} />;
}
