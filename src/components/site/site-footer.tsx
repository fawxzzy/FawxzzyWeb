import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";
import { tiktokDestination } from "@/data/discovery";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Footer" className="site-footer__nav">
        <StaticLink href="/">Home</StaticLink>
        <StaticLink href="/#apps">Apps</StaticLink>
        <a
          data-analytics-event="tiktok_open"
          href={tiktokDestination.href}
          rel="noreferrer"
          target="_blank"
        >
          TikTok
        </a>
        <StaticLink href="/account">Account</StaticLink>
      </nav>

      <div className="site-footer__closing">
        <p>&copy; 2026 {productIdentity.publicName}</p>
        <StaticLink href="#main-content">Back to top</StaticLink>
      </div>
    </footer>
  );
}
