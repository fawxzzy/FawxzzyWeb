import { AppStoreCard } from "@/components/catalog/app-store-card";
import { EditorialSectionHeading } from "@/components/editorial/editorial-section-heading";
import { apps } from "@/data/apps";
import type { DiscoveryDestination } from "@/data/discovery";

type DiscoveryGridProps = {
  destinations: DiscoveryDestination[];
};

export function DiscoveryGrid({ destinations }: DiscoveryGridProps) {
  const tiktok = destinations.find((destination) => destination.id === "tiktok");
  if (!tiktok) throw new Error("Discover requires the canonical TikTok destination.");

  return (
    <div className="discovery-editorial discovery-editorial--focused">
      <section aria-labelledby="discover-products-title" className="editorial-section">
        <EditorialSectionHeading
          description="Product pages carry the durable details. Each app keeps its own launch destination and data boundary."
          eyebrow="Website / Product truth"
          id="discover-products-title"
          title="Start with the apps."
        />
        <div className="discover-app-directory">
          {apps.map((app) => <AppStoreCard app={app} key={app.slug} />)}
        </div>
      </section>

      <section aria-labelledby="discover-tiktok-title" className="discover-tiktok surface-panel">
        <div aria-hidden="true" className="discover-tiktok__mark">{tiktok.mark}</div>
        <div className="discover-tiktok__copy">
          <p className="eyebrow">TikTok / Public discovery</p>
          <h2 id="discover-tiktok-title">Follow the work in motion.</h2>
          <p>{tiktok.description}</p>
          <span>{tiktok.displayValue}</span>
        </div>
        <a
          aria-label={`${tiktok.action} (opens in a new tab)`}
          className="catalog-button catalog-button--primary"
          data-analytics-event="tiktok_open"
          data-destination-id={tiktok.id}
          href={tiktok.href}
          rel="noreferrer"
          target="_blank"
        >
          Open TikTok <span aria-hidden="true">↗</span>
        </a>
      </section>

      <section aria-labelledby="discover-boundary-title" className="discover-boundary">
        <p className="eyebrow">Focused by design</p>
        <h2 id="discover-boundary-title">Two surfaces. No directory clutter.</h2>
        <p>
          The website is the source for app availability and product details. TikTok is
          the only external profile promoted here. Retired channels remain historical
          knowledge, not active links.
        </p>
      </section>
    </div>
  );
}
