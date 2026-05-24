import Image from "next/image";
import type { CSSProperties } from "react";
import type { CatalogApp } from "@/data/apps";
import { getAppActions } from "@/lib/catalog";
import { ActionLink } from "@/components/catalog/action-link";
import { AppPreview } from "@/components/catalog/app-preview";

type AppSectionProps = {
  app: CatalogApp;
};

export function AppSection({ app }: AppSectionProps) {
  const actions = getAppActions(app);

  return (
    <section className="catalog-section" id={app.slug}>
      <div className="catalog-section__card surface-panel">
        <div
          className="catalog-section__glow"
          style={
            {
              "--section-from": app.accent.from,
              "--section-glow": app.accent.glow,
              "--section-panel": app.accent.panel,
              "--section-to": app.accent.to,
            } as CSSProperties
          }
        />

        <div className="catalog-section__card-content">
          <div className="catalog-section__body">
            <div className="catalog-section__header">
              <div className="catalog-section__title">
                <div className="catalog-section__icon-frame">
                  <Image
                    alt={`${app.name} icon`}
                    className="catalog-section__icon"
                    height={96}
                    src={app.icon.src}
                    unoptimized
                    width={96}
                  />
                </div>
                <div>
                  <h2>{app.name}</h2>
                  <p>{app.tagline}</p>
                </div>
              </div>
            </div>

            <div className="catalog-section__meta">
              <div className="catalog-section__actions">
                {actions.map((action) => (
                  <ActionLink action={action} key={`${app.slug}-${action.label}`} />
                ))}
              </div>

              <div className="catalog-section__support readable-column">
                <div className="catalog-section__tags">
                  {app.tags.map((tag) => (
                    <span className="meta-chip" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <AppPreview app={app} />
        </div>
      </div>
    </section>
  );
}
