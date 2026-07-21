import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppDetailExperience } from "@/components/catalog/app-detail-experience";
import { StructuredData } from "@/components/seo/structured-data";
import { apps, getAppBySlug, getAppDetailPath } from "@/data/apps";
import { appStructuredData, publicPageMetadata } from "@/lib/seo";

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

  return publicPageMetadata({
    title: app.name,
    description: app.tagline,
    image: {
      alt: `${app.name} interaction walkthrough`,
      url: app.trailer.poster.src,
    },
    path: getAppDetailPath(app),
  });
}

export default async function AppDetailPage({ params }: AppDetailPageProps) {
  const { slug } = await params;
  const app = getAppBySlug(slug);

  if (!app) {
    notFound();
  }

  return (
    <>
      <StructuredData
        data={appStructuredData(app)}
        id={`${app.slug}-application-structured-data`}
      />
      <AppDetailExperience app={app} />
    </>
  );
}
