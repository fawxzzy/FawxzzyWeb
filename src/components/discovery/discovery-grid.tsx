import Image from "next/image";
import type { DiscoveryDestination } from "@/data/discovery";

type DiscoveryGridProps = {
  destinations: DiscoveryDestination[];
};

const sectionCopy: Record<DiscoveryDestination["category"], { eyebrow: string; title: string }> = {
  featured: {
    eyebrow: "Start here",
    title: "Apps, training, and community.",
  },
  social: {
    eyebrow: "Follow the story",
    title: "Every verified social profile.",
  },
  support: {
    eyebrow: "Elsewhere",
    title: "Support and gaming.",
  },
};

function DestinationMark({ destination }: { destination: DiscoveryDestination }) {
  if (destination.icon) {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className="discovery-card__icon discovery-card__icon--image"
        height={96}
        src={destination.icon.src}
        unoptimized
        width={96}
      />
    );
  }

  return (
    <span aria-hidden="true" className="discovery-card__icon">
      {destination.mark}
    </span>
  );
}

function FeaturedDestination({ destination }: { destination: DiscoveryDestination }) {
  return (
    <article
      className={`discovery-card surface-panel discovery-card--${destination.id}`}
      data-destination-id={destination.id}
    >
      <div className="discovery-card__topline">
        <DestinationMark destination={destination} />
        <div>
          <p className="field-label">{destination.eyebrow}</p>
          <p className="discovery-card__owner">{destination.displayValue}</p>
        </div>
      </div>

      <div className="discovery-card__copy">
        <h3>{destination.title}</h3>
        <p>{destination.description}</p>
      </div>

      {destination.temporaryBridge ? (
        <p className="discovery-card__bridge">
          <strong>Current bridge:</strong> Fitness owns the future intake replacement;
          Fawxzzy stores no intake or payment state.
        </p>
      ) : null}

      {destination.href && destination.action ? (
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
      ) : null}
    </article>
  );
}

function CompactDestination({ destination }: { destination: DiscoveryDestination }) {
  const content = (
    <>
      <DestinationMark destination={destination} />
      <span className="discovery-link__copy">
        <span className="discovery-link__title">{destination.title}</span>
        <span className="discovery-link__value">{destination.displayValue}</span>
      </span>
      <span aria-hidden="true" className="discovery-link__arrow">
        {destination.href ? "↗" : "ID"}
      </span>
    </>
  );

  if (!destination.href || !destination.action) {
    return (
      <article
        aria-label={`${destination.title}: ${destination.displayValue}`}
        className="discovery-link discovery-link--identity surface-panel"
        data-destination-id={destination.id}
      >
        {content}
        <p className="discovery-link__note">{destination.description}</p>
      </article>
    );
  }

  return (
    <a
      aria-label={`${destination.action} (opens in a new tab)`}
      className="discovery-link surface-panel"
      data-destination-id={destination.id}
      href={destination.href}
      rel="noreferrer"
      target="_blank"
    >
      {content}
    </a>
  );
}

export function DiscoveryGrid({ destinations }: DiscoveryGridProps) {
  return (
    <div className="discovery-sections">
      {(["featured", "social", "support"] as const).map((category) => {
        const categoryDestinations = destinations.filter(
          (destination) => destination.category === category,
        );

        return (
          <section aria-labelledby={`discovery-${category}`} className="discovery-section" key={category}>
            <header className="discovery-section__heading">
              <p className="eyebrow">{sectionCopy[category].eyebrow}</p>
              <h2 id={`discovery-${category}`}>{sectionCopy[category].title}</h2>
            </header>

            {category === "featured" ? (
              <div className="discovery-grid discovery-grid--featured">
                {categoryDestinations.map((destination) => (
                  <FeaturedDestination destination={destination} key={destination.id} />
                ))}
              </div>
            ) : (
              <div className="discovery-grid discovery-grid--compact">
                {categoryDestinations.map((destination) => (
                  <CompactDestination destination={destination} key={destination.id} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
