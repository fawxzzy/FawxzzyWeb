"use client";

import { useEffect, useState } from "react";
import { formatOnline, isPresenceOrigin } from "@/lib/presence/presence-contract.mjs";

// Presentation only. `count` is null while connecting or unavailable: the display is then a dim
// dot with no number. A made-up or zero count is never shown.
export function PresenceView({ count }: { count: number | null }) {
  const text = formatOnline(count as number);
  return (
    <span className="site-nav__presence" data-state={text ? "live" : "idle"}>
      <span aria-hidden="true" className="site-nav__presence-dot" />
      {text ? (
        <span className="site-nav__presence-count">
          {text}
          <span className="site-nav__presence-word"> online</span>
        </span>
      ) : null}
    </span>
  );
}

// Live "online now" display for the site header (docs/live-presence.md). The static HTML is the
// dim dot only. Nothing runs off the production site origins, and the Realtime client is loaded
// on demand after the page settles so it never counts toward the catalog's route JavaScript.
export function PresenceCounter() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!isPresenceOrigin(window.location.origin)) return;
    let stop = () => {};
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void import("@/lib/presence/presence-client")
        .then(({ startPresence }) => { if (!cancelled) stop = startPresence(setCount); })
        .catch(() => undefined);
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop();
    };
  }, []);
  return <PresenceView count={count} />;
}
