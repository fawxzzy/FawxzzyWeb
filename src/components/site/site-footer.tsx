import { StaticLink } from "@/components/site/static-link";
import { accountUrls } from "@/config/account";
import { productIdentity } from "@/config/product";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Footer" className="site-footer__nav">
        <StaticLink href={productIdentity.appsPath}>Apps</StaticLink>
        <StaticLink href={accountUrls.account}>Account</StaticLink>
      </nav>

      <div className="site-footer__closing">
        <p>&copy; 2026 {productIdentity.publicName}</p>
        <StaticLink href="#main-content">Back to top</StaticLink>
      </div>
    </footer>
  );
}
