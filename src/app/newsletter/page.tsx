import type { Metadata } from "next";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { EditorialSectionHeading } from "@/components/editorial/editorial-section-heading";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";

export const metadata: Metadata = {
  title: "Building Fawxzzy Weekly",
  description:
    "The owned editorial home for Fawxzzy product decisions, development notes, experiments, lessons, and releases.",
  alternates: { canonical: "/newsletter" },
  openGraph: {
    title: `Building Fawxzzy Weekly | ${productIdentity.publicName}`,
    description:
      "The owned editorial record for what Fawxzzy ships, what changed, and what the work teaches along the way.",
    url: "/newsletter",
  },
};

const editorialTopics = [
  {
    title: "Product decisions",
    description: "Why a feature, constraint, or direction earned its place.",
  },
  {
    title: "Development notes",
    description: "The systems, tradeoffs, and fixes behind the finished surface.",
  },
  {
    title: "Experiments and lessons",
    description: "What worked, what did not, and what changes because of it.",
  },
  {
    title: "Releases",
    description: "A permanent record of meaningful product work after it ships.",
  },
];

export default function NewsletterPage() {
  return (
    <main className="newsletter-page editorial-page app-theme-sage" id="main-content">
      <AmbientFitnessBackground
        intensity="soft"
        particleCount={8}
        palette={{
          base: "#070C0A",
          glow: "#7F977C",
          glowStrong: "#A4B5A3",
          wisp: "#5C725D",
          particle: "#CFD8D0",
          warm: "#1C2420",
        }}
      />

      <div className="shell-container newsletter-shell editorial-shell">
        <SiteNav current="newsletter" />

        <header className="editorial-hero newsletter-editorial-hero">
          <div className="editorial-hero__copy">
            <p className="eyebrow">Building Fawxzzy / Editorial record</p>
            <h1>Building Fawxzzy weekly.</h1>
            <p>
              Product decisions, development notes, experiments, lessons, and releases
              from an independent studio building software, fitness tools, and games in public.
            </p>
            <div className="hero__actions">
              <a className="catalog-button catalog-button--primary" href="#newsletter-archive">
                Browse the archive
              </a>
              <StaticLink className="catalog-button catalog-button--secondary" href="/discover">
                Explore the ecosystem
              </StaticLink>
            </div>
          </div>

          <aside className="newsletter-editorial-note" aria-label="Editorial promise">
            <p className="eyebrow">The promise</p>
            <p>
              Useful context over noise. Every published issue gets a permanent URL,
              source links, and an honest place in the archive.
            </p>
          </aside>
        </header>

        <section aria-labelledby="newsletter-topics-title" className="editorial-section newsletter-topics">
          <EditorialSectionHeading
            description="The publication follows the work far enough to explain what changed and why it matters."
            eyebrow="What readers receive"
            id="newsletter-topics-title"
            title="Field notes from the products and the process."
          />
          <div className="newsletter-topic-list">
            {editorialTopics.map((topic, index) => (
              <article className="newsletter-topic" data-editorial-topic key={topic.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{topic.title}</h3>
                <p>{topic.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="newsletter-archive-title" className="editorial-section newsletter-archive" id="newsletter-archive">
          <EditorialSectionHeading
            description="Published issues will appear here with truthful dates, categories, source links, and reading time."
            eyebrow="Issue archive"
            id="newsletter-archive-title"
            title="The archive starts when the first issue ships."
          />
          <div className="newsletter-archive-empty" data-archive-state="empty">
            <p className="eyebrow">No published issues</p>
            <h3>No issues are public yet.</h3>
            <p>
              The empty state is intentional. Draft titles, publication dates, readership,
              and previews are not presented as real until an issue is actually published.
            </p>
          </div>
        </section>

        <aside aria-labelledby="newsletter-delivery-title" className="newsletter-delivery">
          <div>
            <p className="eyebrow">Delivery status / Not open</p>
            <h2 id="newsletter-delivery-title">Read here now. Subscribe later.</h2>
            <p>
              The public archive can grow before email delivery opens. Collection remains closed
              until storage, confirmation, unsubscribe, privacy, and delivery receipts are ready together.
            </p>
          </div>
          <p className="newsletter-status" role="status">
            Email delivery is not open. No email address is collected on this page.
          </p>
        </aside>

        <section aria-labelledby="newsletter-close-title" className="newsletter-close surface-panel">
          <div>
            <p className="eyebrow">Until the first issue</p>
            <h2 id="newsletter-close-title">The live products are the current record.</h2>
            <p>See what is available now, or use the ecosystem hub to find the community and verified profiles.</p>
          </div>
          <div className="newsletter-close__actions">
            <StaticLink className="catalog-button catalog-button--primary" href="/apps">Explore apps</StaticLink>
            <StaticLink className="catalog-button catalog-button--secondary" href="/discover">Open Discover</StaticLink>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
