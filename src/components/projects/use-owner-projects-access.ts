"use client";

import { useEffect, useState } from "react";
import { isLiveAccountAdapterOrigin } from "@/config/account";
import { readOwnerHint } from "@/lib/projects/owner-hint.mjs";
import { writeOwnerHint } from "@/lib/projects/owner-hint-sync";
import { fetchOwnerProjects, isOwnerAccessReply } from "@/lib/projects/owner-projects-client";

export type OwnerProjectsAccess = "checking" | "owner" | "denied";

// "owner" on the account origin only after the server confirmed this exact session is the owner
// (and the shared hint is refreshed so main-site pages can show the link). Signed-out visitors
// make no request at all. On any other origin (the main site has no Auth session) the answer is
// the hint cookie alone: it only shows a link to the account-origin page, which re-verifies.
// The Auth adapter (and Supabase with it) is loaded on demand and only on the account origin,
// so the public main site never downloads it: this hook is in every page's navigation and must
// not add to the catalog's route JavaScript budget.
export function useOwnerProjectsAccess(): OwnerProjectsAccess {
  const [access, setAccess] = useState<OwnerProjectsAccess>("checking");
  useEffect(() => {
    if (!isLiveAccountAdapterOrigin(window.location.origin)) {
      const hinted = readOwnerHint(document.cookie);
      queueMicrotask(() => setAccess(hinted ? "owner" : "denied"));
      return;
    }
    let mounted = true;
    let controller: AbortController | null = null;
    let unsubscribe = () => {};
    void import("@/lib/auth/browser-adapter").then(({ resolvePortalAuthAdapter }) => {
      if (!mounted) return;
      const resolution = resolvePortalAuthAdapter(window.location);
      if (resolution.status !== "ready") {
        setAccess("denied");
        return;
      }
      const { adapter } = resolution;
      const check = () => {
        controller?.abort();
        const mine = new AbortController();
        controller = mine;
        void fetchOwnerProjects(adapter, "access", mine.signal).then((value) => {
          if (!mounted || mine.signal.aborted) return;
          const owner = isOwnerAccessReply(value);
          writeOwnerHint(owner);
          setAccess(owner ? "owner" : "denied");
        });
      };
      check();
      unsubscribe = adapter.onSessionChange(check);
    }).catch(() => { if (mounted) setAccess("denied"); });
    return () => {
      mounted = false;
      controller?.abort();
      unsubscribe();
    };
  }, []);
  return access;
}
