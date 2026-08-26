"use client";

import { useEffect, useSyncExternalStore } from "react";
import { StaticLink } from "@/components/site/static-link";
import { accountUrls } from "@/config/account";

const DISPLAY_KEY = "fawxzzy.account.display-authenticated-until.v1";
const DISPLAY_EVENT = "fawxzzy-account-display-auth-changed";
const DISPLAY_TTL_MS = 5 * 60 * 1000;

function hasFreshDisplayMarker() {
  const expiresAt = Number(window.sessionStorage.getItem(DISPLAY_KEY));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    window.sessionStorage.removeItem(DISPLAY_KEY);
    return false;
  }
  return true;
}

function subscribe(listener: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleExpiry = () => {
    if (timer) clearTimeout(timer);
    const expiresAt = Number(window.sessionStorage.getItem(DISPLAY_KEY));
    const remaining = Number.isFinite(expiresAt) ? expiresAt - Date.now() : 0;
    if (remaining <= 0) {
      window.sessionStorage.removeItem(DISPLAY_KEY);
      return;
    }
    timer = setTimeout(() => {
      window.sessionStorage.removeItem(DISPLAY_KEY);
      listener();
    }, remaining);
  };
  const handleChange = () => {
    scheduleExpiry();
    listener();
  };
  const handleVisibility = () => {
    if (document.visibilityState === "visible") handleChange();
  };
  window.addEventListener(DISPLAY_EVENT, handleChange);
  window.addEventListener("storage", handleChange);
  window.addEventListener("focus", handleChange);
  document.addEventListener("visibilitychange", handleVisibility);
  scheduleExpiry();
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener(DISPLAY_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
    window.removeEventListener("focus", handleChange);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}

export function AuthAwareSignInAction() {
  const signedIn = useSyncExternalStore(
    subscribe,
    hasFreshDisplayMarker,
    () => false,
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("signedIn") === "1") {
      window.sessionStorage.setItem(DISPLAY_KEY, String(Date.now() + DISPLAY_TTL_MS));
    }
    if (url.searchParams.get("signedOut") === "1") window.sessionStorage.removeItem(DISPLAY_KEY);
    if (url.searchParams.has("signedIn") || url.searchParams.has("signedOut")) {
      url.searchParams.delete("signedIn");
      url.searchParams.delete("signedOut");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new Event(DISPLAY_EVENT));
    }
  }, []);

  if (signedIn) return null;
  return (
    <StaticLink className="catalog-button catalog-button--ghost" href={accountUrls.login}>
      Sign in
    </StaticLink>
  );
}
