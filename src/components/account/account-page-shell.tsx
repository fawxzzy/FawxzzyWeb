import Image from "next/image";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { SiteNav } from "@/components/site/site-nav";
import { StaticLink } from "@/components/site/static-link";
import { productIdentity } from "@/config/product";

type AccountPageShellProps = {
  children: React.ReactNode;
  eyebrow: string;
  intro: string;
  title: string;
  variant?: "account" | "utility";
};

function AccountUtilityNav() {
  return (
    <nav aria-label="Account" className="account-utility-nav surface-panel">
      <StaticLink
        aria-label={`${productIdentity.publicName} home`}
        className="account-utility-nav__brand"
        href="/"
      >
        <Image
          alt=""
          aria-hidden="true"
          className="account-utility-nav__mark"
          height={800}
          src="/brand/fawxzzy-wolf.png"
          unoptimized
          width={800}
        />
        <span>{productIdentity.publicName}</span>
      </StaticLink>
      <div className="account-utility-nav__actions">
        <StaticLink href="/">Back home</StaticLink>
      </div>
    </nav>
  );
}

export function AccountPageShell({
  children,
  eyebrow,
  intro,
  title,
  variant = "account",
}: AccountPageShellProps) {
  const utility = variant === "utility";

  return (
    <main
      className={`account-page app-theme-fawxzzy${utility ? " account-page--utility" : ""}`}
      data-auth-family="fawxzzy"
      data-auth-layout={utility ? "focused-split" : "account-status"}
      data-auth-product="website"
      id="main-content"
    >
      <AmbientBrandBackground intensity="soft" particleCount={10} pulseEnabled={false} />
      <div className={`shell-container account-shell${utility ? " account-shell--utility" : ""}`}>
        {utility ? <AccountUtilityNav /> : <SiteNav current="account" />}
        {utility ? (
          <div className="account-utility-layout">
            <header className="account-hero account-hero--utility">
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              <p>{intro}</p>
            </header>
            {children}
          </div>
        ) : (
          <>
            <header className="account-hero surface-panel">
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              <p>{intro}</p>
            </header>
            {children}
          </>
        )}
        <footer className="account-footer">
          <p>&copy; 2026 {productIdentity.publicName}</p>
          <StaticLink href="/">Home</StaticLink>
        </footer>
      </div>
    </main>
  );
}
