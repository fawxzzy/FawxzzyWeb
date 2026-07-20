import type { Metadata } from "next";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";

export const metadata: Metadata = {
  title: "Building Fawxzzy Weekly",
  description:
    "The owned archive for Building Fawxzzy: the weekly record of software, training, games, and the work behind them.",
  alternates: { canonical: "/newsletter" },
  openGraph: {
    title: `Building Fawxzzy Weekly | ${productIdentity.publicName}`,
    description:
      "The owned weekly archive for Fawxzzy: what shipped, what changed, and what is next.",
    url: "/newsletter",
  },
};

export default function NewsletterPage() {
  return (
    <main className="newsletter-page app-theme-sage" id="main-content">
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

      <div className="shell-container newsletter-shell">
        <SiteNav current="newsletter" />

        <header className="newsletter-hero surface-panel">
          <p className="eyebrow">Owned archive / weekly field notes</p>
          <h1>Building Fawxzzy weekly.</h1>
          <p>
            A quieter record of the apps, training, games, experiments, and decisions behind the work.
            Each issue is meant to be useful even if you missed every post that week.
          </p>
          <div className="hero__actions">
            <StaticLink className="catalog-button catalog-button--primary" href="/discover">
              Explore the hub
            </StaticLink>
            <StaticLink className="catalog-button" href="/apps">
              See the apps
            </StaticLink>
          </div>
        </header>

        <section aria-labelledby="newsletter-subscribe-title" className="newsletter-subscribe surface-panel">
          <div>
            <p className="eyebrow">Subscribe</p>
            <h2 id="newsletter-subscribe-title">Delivery is being wired before addresses are collected.</h2>
            <p>
              This is the permanent subscribe and archive surface. Email collection stays closed until
              the provider, double-opt-in policy, unsubscribe path, and delivery receipts are live.
            </p>
          </div>
          <p className="newsletter-status" role="status">
            Subscription opening soon — no email address is collected on this page yet.
          </p>
        </section>

        <section aria-labelledby="newsletter-archive-title" className="newsletter-archive">
          <div className="section-heading">
            <p className="eyebrow">Archive</p>
            <h2 id="newsletter-archive-title">Issues will appear here.</h2>
            <p>
              The first issue is in editorial preparation. Published issues will have a stable URL,
              issue date, source links, and an archive entry rather than disappearing into a social feed.
            </p>
          </div>
          <article className="newsletter-empty surface-panel">
            <p className="eyebrow">Next issue</p>
            <h3>Issue 001 / Building the operating system around the work.</h3>
            <p>
              The initial edition will cover the live Fawxzzy app catalog, the build-in-public system,
              and the next product work once the editorial draft is ready to publish.
            </p>
            <span>Not published yet</span>
          </article>
        </section>
      </div>
    </main>
  );
}
