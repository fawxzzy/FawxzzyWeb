import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { SiteNav } from "@/components/site/site-nav";

type AccountPageShellProps = {
  children: React.ReactNode;
  eyebrow: string;
  intro: string;
  title: string;
};

export function AccountPageShell({
  children,
  eyebrow,
  intro,
  title,
}: AccountPageShellProps) {
  return (
    <main className="account-page app-theme-sage" id="main-content">
      <AmbientFitnessBackground intensity="soft" particleCount={10} pulseEnabled={false} />
      <div className="shell-container account-shell">
        <SiteNav current="account" />
        <header className="account-hero surface-panel">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{intro}</p>
        </header>
        {children}
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
