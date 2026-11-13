import Image from "next/image";
import { OwnerProjectsLink } from "@/components/site/owner-projects-link";
import { StaticLink } from "@/components/site/static-link";
import { accountUrls } from "@/config/account";
import { productIdentity } from "@/config/product";

type SiteNavProps = {
  current: "account" | "apps" | "projects";
};

export function SiteNav({ current }: SiteNavProps) {
  return (
    <nav aria-label="Primary" className="site-nav surface-panel">
      <StaticLink
        aria-label={`${productIdentity.publicName} apps`}
        className="site-nav__brand"
        href={productIdentity.appsPath}
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
        <span className="site-nav__brand-label">{productIdentity.publicName}</span>
      </StaticLink>
      <div className="site-nav__links">
        <StaticLink
          aria-current={current === "apps" ? "page" : undefined}
          href={productIdentity.appsPath}
        >
          Apps
        </StaticLink>
        <OwnerProjectsLink current={current === "projects"} />
        <StaticLink href={accountUrls.account}>Account</StaticLink>
      </div>
    </nav>
  );
}
