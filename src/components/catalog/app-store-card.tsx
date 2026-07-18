import Image from "next/image";
import type { CatalogApp } from "@/data/apps";
import { getAppDetailPath } from "@/data/apps";
import { StaticLink } from "@/components/site/static-link";

type AppStoreCardProps = {
  app: CatalogApp;
};

export function AppStoreCard({ app }: AppStoreCardProps) {
  return (
    <StaticLink
      aria-label={`View ${app.name} details`}
      className="app-store-card surface-panel"
      data-app-card={app.slug}
      href={getAppDetailPath(app)}
    >
      <Image
        alt={`${app.name} icon`}
        className="app-store-card__icon"
        height={80}
        src={app.icon.src}
        unoptimized
        width={80}
      />
      <span className="app-store-card__copy">
        <span className="app-store-card__category">{app.category}</span>
        <strong>{app.name}</strong>
        <span>{app.tagline}</span>
        <span className="app-store-card__status">{app.status}</span>
      </span>
      <span aria-hidden="true" className="app-store-card__cue">
        ›
      </span>
    </StaticLink>
  );
}
