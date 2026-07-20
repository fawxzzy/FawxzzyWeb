import Image from "next/image";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";
import { apps, getAppDetailPath } from "@/data/apps";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__lead">
        <Image
          alt=""
          aria-hidden="true"
          className="site-footer__mark"
          height={80}
          src="/brand/fawxzzy-wolf.png"
          unoptimized
          width={80}
        />
        <div>
          <p className="eyebrow">Independent product studio</p>
          <h2>{productIdentity.publicName}</h2>
          <p>Software, fitness, games, and the work behind them.</p>
        </div>
      </div>

      <nav aria-label="Footer" className="site-footer__nav">
        <div>
          <p>Products</p>
          <StaticLink href={productIdentity.appsPath}>All apps</StaticLink>
          {apps.map((app) => (
            <StaticLink href={getAppDetailPath(app)} key={app.slug}>
              {app.name}
            </StaticLink>
          ))}
        </div>
        <div>
          <p>Follow the work</p>
          <StaticLink href="/discover">Discover</StaticLink>
          <StaticLink href="/newsletter">Build log</StaticLink>
        </div>
        <div>
          <p>Account</p>
          <StaticLink href="/login">Sign in</StaticLink>
          <StaticLink href="/account">Manage account</StaticLink>
        </div>
      </nav>

      <div className="site-footer__closing">
        <p>&copy; 2026 Fawxzzy. Built independently and improved in public.</p>
        <StaticLink href="#main-content">Back to top</StaticLink>
      </div>
    </footer>
  );
}
