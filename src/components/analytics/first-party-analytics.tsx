"use client";

import { useEffect } from "react";
import {
  isAnalyticsEvent,
  normalizeAnalyticsRoute,
  parseAnalyticsApp,
  parseCompatibilitySource,
  type AnalyticsEnvelope,
} from "@/lib/analytics/contract";

const endpoint = process.env.NEXT_PUBLIC_FAWXZZY_ANALYTICS_URL;
const analyticsOrigins = new Set(["https://fawxzzy.com", "https://www.fawxzzy.com"]);

function emit(payload: AnalyticsEnvelope) {
  if (!endpoint) return;

  const body = JSON.stringify(payload);
  void fetch(endpoint, {
    body,
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
    mode: "cors",
  });
}

function analyticsEnvelope(event: AnalyticsEnvelope["event"], target?: Element) {
  const url = new URL(window.location.href);
  const app = parseAnalyticsApp(target?.getAttribute("data-analytics-app") ?? null);
  const compatibility = parseCompatibilitySource(url.searchParams.get("compatibility"));

  return {
    ...(app ? { app } : {}),
    ...(compatibility ? { compatibility } : {}),
    event,
    product: "web",
    route: normalizeAnalyticsRoute(url.pathname),
  } satisfies AnalyticsEnvelope;
}

export function FirstPartyAnalytics() {
  useEffect(() => {
    if (!endpoint || !analyticsOrigins.has(window.location.origin)) return;

    const url = new URL(window.location.href);
    const compatibility = parseCompatibilitySource(url.searchParams.get("compatibility"));
    emit(analyticsEnvelope("page_view"));

    if (compatibility) {
      url.searchParams.delete("compatibility");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    const onClick = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        "[data-analytics-event]",
      );
      const eventName = target?.getAttribute("data-analytics-event") ?? null;
      if (!target || !isAnalyticsEvent(eventName)) return;
      emit(analyticsEnvelope(eventName, target));
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
