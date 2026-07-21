import Image from "next/image";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
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
        <span>Secure account</span>
        <StaticLink href="/">Back to site</StaticLink>
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
      className={`account-page app-theme-sage${utility ? " account-page--utility" : ""}`}
      id="main-content"
    >
      <AmbientFitnessBackground intensity="soft" particleCount={10} pulseEnabled={false} />
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
          <p>
            One Fawxzzy identity. Product data stays with the product that owns it.
          </p>
          <a href="https://fawxzzy.com/">Back to Fawxzzy</a>
        </footer>
      </div>
    </main>
  );
}
