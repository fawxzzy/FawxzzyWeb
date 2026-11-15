"use client";

import { useEffect } from "react";
import { AuthDock, AuthStatus } from "@/components/account/auth-status";
import { accountExperienceContexts } from "@/config/account";
import { PAGE_CRASH_NOTICE, STATUS_COPY } from "@/lib/auth/status-copy";
import "./globals.css";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function GlobalError({ error, unstable_retry }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Fawxzzy root rendering failed.", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>{`${STATUS_COPY.couldNotLoad} | Fawxzzy`}</title>
        <main className="system-page system-page--global system-page--locked app-theme-fawxzzy" id="main-content">
          <div className="shell-container system-shell system-shell--global">
            <AuthStatus
              context={accountExperienceContexts.website}
              dock={<AuthDock onClick={() => unstable_retry()}>{STATUS_COPY.tryAgain}</AuthDock>}
              notice={PAGE_CRASH_NOTICE}
              state="crash"
              surface="crash"
              title={STATUS_COPY.couldNotLoad}
            />
          </div>
        </main>
      </body>
    </html>
  );
}
