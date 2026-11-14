import type { CSSProperties } from "react";
import Image from "next/image";
import { StaticLink } from "@/components/site/static-link";

type AppCatalogEntryProps = {
  accent: { from: string; glow: string; to: string };
  category: string;
  description: string;
  iconSrc: string;
  name: string;
  origin: string;
  slug: string;
  status: string;
  tagline: string;
};

// One app in the store list: icon, name, category, one-line promise, a short description, honest
// facts (availability, that it is a web app) and a single Open action. No ratings, counts or
// previews: only what is true and current.
export function AppCatalogEntry({
  accent,
  category,
  description,
  iconSrc,
  name,
  origin,
  slug,
  status,
  tagline,
}: AppCatalogEntryProps) {
  const accentStyle = {
    "--app-from": accent.from,
    "--app-glow": accent.glow,
    "--app-to": accent.to,
  } as CSSProperties;

  return (
    <article className="app-launcher" data-app-launcher={slug} id={slug} style={accentStyle}>
      <div className="app-launcher__head">
        <Image
          alt=""
          aria-hidden="true"
          className="app-launcher__icon"
          height={160}
          src={iconSrc}
          unoptimized
          width={160}
        />
        <div className="app-launcher__titles">
          <h2>{name}</h2>
          <p className="app-launcher__category">{category}</p>
          <p className="app-launcher__tagline">{tagline}</p>
        </div>
      </div>

      <p className="app-launcher__description">{description}</p>

      <ul aria-label={`${name} details`} className="app-launcher__meta">
        <li>{status}</li>
        <li>Web app</li>
        <li>Add to home screen</li>
      </ul>

      <div className="app-launcher__actions">
        <StaticLink
          aria-label={`Open ${name} app`}
          className="app-launcher__action"
          data-analytics-app={slug}
          data-analytics-event="app_launch"
          href={origin}
          rel="noreferrer"
          target="_blank"
        >
          Open
          <span aria-hidden="true">↗</span>
        </StaticLink>
      </div>
    </article>
  );
}
