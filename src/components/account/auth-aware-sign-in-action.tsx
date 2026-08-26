"use client";

import { useEffect, useSyncExternalStore } from "react";
import { StaticLink } from "@/components/site/static-link";
import { accountUrls } from "@/config/account";

const DISPLAY_KEY = "fawxzzy.account.display-authenticated.v1";
const DISPLAY_EVENT = "fawxzzy-account-display-auth-changed";

function subscribe(listener: () => void) {
  window.addEventListener(DISPLAY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(DISPLAY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function AuthAwareSignInAction() {
  const signedIn = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(DISPLAY_KEY) === "1",
    () => false,
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("signedIn") === "1") window.localStorage.setItem(DISPLAY_KEY, "1");
    if (url.searchParams.get("signedOut") === "1") window.localStorage.removeItem(DISPLAY_KEY);
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
