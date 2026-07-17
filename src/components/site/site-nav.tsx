import Image from "next/image";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";

type SiteNavProps = {
  current: "apps" | "discover" | "home";
};

export function SiteNav({ current }: SiteNavProps) {
  return (
    <nav aria-label="Primary" className="site-nav surface-panel">
      <StaticLink
        aria-current={current === "home" ? "page" : undefined}
        className="site-nav__brand"
        href="/"
      >
        <Image
          alt=""
          aria-hidden="true"
          className="site-nav__mark"
          height={800}
          src="/brand/fawxzzy-wolf.png"
          unoptimized
          width={800}
        />
        <span>{productIdentity.publicName}</span>
      </StaticLink>
      <div className="site-nav__links">
        <StaticLink aria-current={current === "home" ? "page" : undefined} href="/">
          Home
        </StaticLink>
        <StaticLink
          aria-current={current === "apps" ? "page" : undefined}
          href={productIdentity.appsPath}
        >
          Apps
        </StaticLink>
        <StaticLink
          aria-current={current === "discover" ? "page" : undefined}
          href="/discover"
        >
          Discover
        </StaticLink>
      </div>
    </nav>
  );
}
