"use client";

import { useEffect } from "react";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { AuthDock, AuthStatus } from "@/components/account/auth-status";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { accountExperienceContexts } from "@/config/account";
import { PAGE_CRASH_NOTICE, STATUS_COPY } from "@/lib/auth/status-copy";

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
          dock={<AuthDock onClick={() => unstable_retry()}>{STATUS_COPY.tryAgain}</AuthDock>}
          notice={PAGE_CRASH_NOTICE}
          state="crash"
          surface="crash"
          title={STATUS_COPY.couldNotLoad}
        />
        <SiteFooter />
      </div>
    </main>
  );
}
