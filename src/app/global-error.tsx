"use client";

import { useEffect } from "react";
import { AuthDock, AuthStatus } from "@/components/account/auth-surface";
import { accountExperienceContexts } from "@/config/account";
import { AUTH_COPY, authNotice } from "@/lib/auth/copy-matrix";
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
        <title>{`${AUTH_COPY.title.couldNotLoad} | Fawxzzy`}</title>
        <main className="system-page system-page--global system-page--locked app-theme-fawxzzy" id="main-content">
          <div className="shell-container system-shell system-shell--global">
            <AuthStatus
              context={accountExperienceContexts.website}
              dock={<AuthDock onClick={() => unstable_retry()}>{AUTH_COPY.button.tryAgain}</AuthDock>}
              notice={authNotice("page.crash")}
              state="crash"
              surface="crash"
              title={AUTH_COPY.title.couldNotLoad}
            />
          </div>
        </main>
      </body>
    </html>
  );
}
