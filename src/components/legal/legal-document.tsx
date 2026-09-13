import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { legalCenter, type LegalDocument as LegalDocumentDefinition } from "@/config/legal";
import { productIdentity } from "@/config/product";

export function LegalDocument({ document }: { document: LegalDocumentDefinition }) {
  return (
    <main className="legal-page app-theme-fawxzzy" id="main-content">
      <AmbientBrandBackground intensity="soft" particleCount={8} pulseEnabled={false} />
      <div className="shell-container legal-shell">
        <SiteNav current="home" />
        <article
          aria-labelledby="legal-title"
          className="legal-document surface-panel"
          data-legal-document={document.id}
          data-legal-version={document.version}
        >
          <header className="legal-document__header">
            <p className="eyebrow">{document.eyebrow}</p>
            <h1 id="legal-title">{document.title}</h1>
            <p>{document.description}</p>
            <p className="legal-document__updated">
              Last updated{" "}
              <time dateTime={legalCenter.lastUpdated.dateTime}>
                {legalCenter.lastUpdated.label}
              </time>
            </p>
          </header>
          <div className="legal-document__sections">
            {document.sections.map((section) => (
              <section key={section.heading}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </section>
            ))}
          </div>
        </article>
        <footer className="legal-footer">
          <p>&copy; 2026 {productIdentity.publicName}</p>
          <StaticLink href="/">Home</StaticLink>
        </footer>
      </div>
    </main>
  );
}
