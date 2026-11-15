"use client";

import { useEffect } from "react";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { AuthDock, AuthStatus } from "@/components/account/auth-surface";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { accountExperienceContexts } from "@/config/account";
import { AUTH_COPY, authNotice } from "@/lib/auth/copy-matrix";

type RouteErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function RouteError({ error, unstable_retry }: RouteErrorProps) {
  useEffect(() => {
    console.error("Fawxzzy route rendering failed.", error);
  }, [error]);

  return (
    <main className="system-page system-page--locked app-theme-fawxzzy" id="main-content">
      <AmbientBrandBackground intensity="soft" particleCount={8} pulseEnabled={false} />
      <div className="shell-container system-shell">
        <SiteNav current="apps" />
        <AuthStatus
          context={accountExperienceContexts.website}
          dock={<AuthDock onClick={() => unstable_retry()}>{AUTH_COPY.button.tryAgain}</AuthDock>}
          notice={authNotice("page.crash")}
          state="crash"
          surface="crash"
          title={AUTH_COPY.title.couldNotLoad}
        />
        <SiteFooter />
      </div>
    </main>
  );
}
