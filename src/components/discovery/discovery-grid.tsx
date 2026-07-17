import Image from "next/image";
import type { DiscoveryDestination } from "@/data/discovery";

const destinationMarks: Record<DiscoveryDestination["id"], string> = {
  "fitness-app": "FF",
  "custom-workout": "CW",
  discord: "DC",
  tiktok: "TT",
  youtube: "YT",
};

type DiscoveryGridProps = {
  destinations: DiscoveryDestination[];
};

export function DiscoveryGrid({ destinations }: DiscoveryGridProps) {
  return (
    <div className="discovery-grid">
      {destinations.map((destination) => (
        <article
          className={`discovery-card surface-panel discovery-card--${destination.id}`}
          data-destination-id={destination.id}
          key={destination.id}
        >
          <div className="discovery-card__topline">
            {destination.icon ? (
              <Image
                alt=""
                aria-hidden="true"
                className="discovery-card__icon discovery-card__icon--image"
                height={96}
                src={destination.icon.src}
                unoptimized
                width={96}
              />
            ) : (
              <span aria-hidden="true" className="discovery-card__icon">
                {destinationMarks[destination.id]}
              </span>
            )}
            <div>
              <p className="field-label">{destination.eyebrow}</p>
              <p className="discovery-card__owner">Owned by {destination.owner}</p>
            </div>
          </div>

          <div className="discovery-card__copy">
            <h2>{destination.title}</h2>
            <p>{destination.description}</p>
          </div>

          {destination.temporaryBridge ? (
            <p className="discovery-card__bridge">
              <strong>Current bridge:</strong> Fitness owns the future intake replacement;
              FawxzzyWeb stores no intake or payment state.
            </p>
          ) : null}

          <a
            aria-label={`${destination.action} (opens in a new tab)`}
            className="catalog-button catalog-button--primary discovery-card__action"
            href={destination.href}
            rel="noreferrer"
            target="_blank"
          >
            {destination.action}
            <span aria-hidden="true">↗</span>
          </a>
        </article>
      ))}
    </div>
  );
}
