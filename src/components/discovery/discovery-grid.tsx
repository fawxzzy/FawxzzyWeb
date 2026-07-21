import Image from "next/image";
import { EditorialSectionHeading } from "@/components/editorial/editorial-section-heading";
import { StaticLink } from "@/components/site/static-link";
import { apps, getAppDetailPath } from "@/data/apps";
import type { DiscoveryDestination } from "@/data/discovery";

type DiscoveryGridProps = {
  destinations: DiscoveryDestination[];
};

function DestinationMark({ destination }: { destination: DiscoveryDestination }) {
  if (destination.icon) {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className="editorial-directory__mark editorial-directory__mark--image"
        height={96}
        src={destination.icon.src}
        unoptimized
        width={96}
      />
    );
  }

  return (
    <span aria-hidden="true" className="editorial-directory__mark">
      {destination.mark}
    </span>
  );
}

function DestinationLink({ destination }: { destination: DiscoveryDestination }) {
  if (!destination.href || !destination.action) {
    return (
      <article
        aria-label={`${destination.title}: ${destination.displayValue}`}
        className="editorial-directory__item editorial-directory__item--identity"
        data-destination-id={destination.id}
      >
        <DestinationMark destination={destination} />
        <span>
          <strong>{destination.title}</strong>
          <small>{destination.displayValue}</small>
        </span>
        <span className="editorial-directory__note">Verified ID</span>
      </article>
    );
  }

  return (
    <a
      aria-label={`${destination.action} (opens in a new tab)`}
      className="editorial-directory__item"
      data-destination-id={destination.id}
      href={destination.href}
      rel="noreferrer"
      target="_blank"
    >
      <DestinationMark destination={destination} />
      <span>
        <strong>{destination.title}</strong>
        <small>{destination.displayValue}</small>
      </span>
      <span aria-hidden="true" className="editorial-directory__arrow">↗</span>
    </a>
  );
}

export function DiscoveryGrid({ destinations }: DiscoveryGridProps) {
  const findDestination = (id: DiscoveryDestination["id"]) => {
    const destination = destinations.find((candidate) => candidate.id === id);
    if (!destination) throw new Error(`Missing discovery destination: ${id}`);
    return destination;
  };

  const fitness = findDestination("fitness-app");
  const customWorkout = findDestination("custom-workout");
  const discord = findDestination("discord");
  const socialDestinations = destinations.filter((destination) => destination.category === "social");
  const supportDestinations = destinations.filter((destination) => destination.category === "support");

  return (
    <div className="discovery-editorial">
      <section aria-labelledby="discover-paths-title" className="editorial-section">
        <EditorialSectionHeading
          description="Three clear ways into the ecosystem, each grounded in something available now."
          eyebrow="Start here"
          id="discover-paths-title"
          title="Choose what you came to do."
        />

        <div className="editorial-paths">
          <article className="editorial-path" data-editorial-path="build">
            <p className="editorial-path__number">01</p>
            <div>
              <p className="eyebrow">Build</p>
              <h3>Use the software.</h3>
              <p>See the products in motion, understand what is live, and open each one at its real home.</p>
            </div>
            <StaticLink className="editorial-text-link" href="/apps">
              Explore the apps <span aria-hidden="true">&rarr;</span>
            </StaticLink>
          </article>

          <article className="editorial-path" data-editorial-path="train">
            <p className="editorial-path__number">02</p>
            <div>
              <p className="eyebrow">Train</p>
              <h3>Put the plan to work.</h3>
              <p>Open Fitness or use the current Fitness-owned bridge for a custom workout setup.</p>
              <p className="editorial-path__boundary">
                Fitness owns the future intake replacement. Fawxzzy stores no intake or payment state.
              </p>
            </div>
            <div className="editorial-path__links">
              <DestinationLink destination={fitness} />
              <DestinationLink destination={customWorkout} />
            </div>
          </article>

          <article className="editorial-path" data-editorial-path="create">
            <p className="editorial-path__number">03</p>
            <div>
              <p className="eyebrow">Create</p>
              <h3>Follow the work behind it.</h3>
              <p>Read the build record, watch the real product stories, and join the people around what comes next.</p>
            </div>
            <StaticLink className="editorial-text-link" href="/newsletter">
              Read the build log <span aria-hidden="true">&rarr;</span>
            </StaticLink>
          </article>
        </div>
      </section>

      <section aria-labelledby="current-work-title" className="editorial-section">
        <EditorialSectionHeading
          description="The latest verified product work comes directly from the same catalog contract used by the app pages."
          eyebrow="Current work / July 2026"
          id="current-work-title"
          title="What is moving right now."
        />
        <div className="editorial-updates">
          {apps.map((app) => (
            <article className="editorial-update" data-current-work={app.slug} key={app.slug}>
              <Image
                alt=""
                aria-hidden="true"
                className="editorial-update__poster"
                height={720}
                src={app.trailer.poster.src}
                width={1280}
              />
              <div>
                <p className="editorial-update__meta">{app.category} / {app.status}</p>
                <h3>{app.name}: {app.latestUpdate}</h3>
                <p>{app.tagline}</p>
              </div>
              <StaticLink
                aria-label={`View ${app.name} details`}
                className="editorial-text-link"
                href={getAppDetailPath(app)}
              >
                View product <span aria-hidden="true">&rarr;</span>
              </StaticLink>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="verified-profiles-title" className="editorial-section" id="discovery-social">
        <EditorialSectionHeading
          description="A compact directory of the profiles Fawxzzy currently publishes. No scraped activity or invented metrics."
          eyebrow="Verified profiles"
          id="verified-profiles-title"
          title="Find Fawxzzy in the places you already use."
        />
        <div className="editorial-directory">
          {socialDestinations.map((destination) => (
            <DestinationLink destination={destination} key={destination.id} />
          ))}
        </div>

        <div className="editorial-directory editorial-directory--secondary" aria-label="Support and gaming identities">
          {supportDestinations.map((destination) => (
            <DestinationLink destination={destination} key={destination.id} />
          ))}
        </div>
      </section>

      <section aria-labelledby="community-close-title" className="editorial-community surface-panel" id="community">
        <div>
          <p className="eyebrow">Community / Build log</p>
          <h2 id="community-close-title">Stay close to what ships next.</h2>
          <p>Join the Discord for the community, or use the owned weekly archive for the quieter record of the work.</p>
        </div>
        <div className="editorial-community__actions">
          <DestinationLink destination={discord} />
          <StaticLink className="catalog-button catalog-button--secondary" href="/newsletter">
            View the newsletter
          </StaticLink>
        </div>
      </section>
    </div>
  );
}
