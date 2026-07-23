"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SystemState } from "@/components/system/system-state";
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
        <title>Something went wrong | Fawxzzy</title>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <main className="system-page system-page--global app-theme-sage" id="main-content">
          <div className="shell-container system-shell system-shell--global">
            <SystemState
              actions={
                <>
                  <button
                    className="catalog-button catalog-button--primary"
                    onClick={() => unstable_retry()}
                    type="button"
                  >
                    Retry Fawxzzy
                  </button>
                  <Link className="catalog-button catalog-button--secondary" href="/">
                    Reload home
                  </Link>
                </>
              }
              description="The application shell could not recover this page safely. Retry once, then reload the public home if needed."
              details={
                <p>
                  Reference: <code>{error.digest ?? "not available"}</code>
                </p>
              }
              eyebrow="Application unavailable"
              headingLevel={1}
              title="Fawxzzy needs a fresh start."
              variant="terminal-error"
            />
          </div>
        </main>
      </body>
    </html>
  );
}
