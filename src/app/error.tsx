"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { SystemState } from "@/components/system/system-state";

type RouteErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function RouteError({ error, unstable_retry }: RouteErrorProps) {
  useEffect(() => {
    console.error("Fawxzzy route rendering failed.", error);
  }, [error]);

  return (
    <main className="system-page app-theme-sage" id="main-content">
      <AmbientFitnessBackground intensity="soft" particleCount={8} pulseEnabled={false} />
      <div className="shell-container system-shell">
        <SiteNav current="home" />
        <SystemState
          actions={
            <>
              <button
                className="catalog-button catalog-button--primary"
                onClick={() => unstable_retry()}
                type="button"
              >
                Try again
              </button>
              <Link className="catalog-button catalog-button--secondary" href="/">
                Return home
              </Link>
            </>
          }
          description="The current page could not finish rendering. Retry once, or return home if the problem continues."
          details={
            <p>
              Reference: <code>{error.digest ?? "not available"}</code>
            </p>
          }
          eyebrow="Recoverable page error"
          headingLevel={1}
          title="This page hit a temporary problem."
          variant="recoverable-error"
        />
        <SiteFooter />
      </div>
    </main>
  );
}
