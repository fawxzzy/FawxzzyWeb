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
      {utility ? null : <AmbientBrandBackground intensity="soft" particleCount={10} pulseEnabled={false} />}
      <div className={`shell-container account-shell${utility ? " account-shell--utility" : ""}`}>
        {utility ? null : <SiteNav current="account" />}
        {utility ? (
          <div className="account-utility-layout">{children}</div>
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
        <footer className={`account-footer${utility ? " account-footer--utility" : ""}`}>
          <p>&copy; 2026 {productIdentity.publicName}</p>
          {utility ? null : <StaticLink href="/">Home</StaticLink>}
        </footer>
      </div>
    </main>
  );
}
