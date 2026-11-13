"use client";

import { useEffect, useState } from "react";
import { emitAccountProjectsPageView } from "@/components/analytics/first-party-analytics";
import { ProjectBoard } from "@/components/projects/project-board";
import { StaticLink } from "@/components/site/static-link";
import { accountUrls, privateProjectsSignInUrl } from "@/config/account";
import emptyPreview from "@/data/project-board-preview.generated.json";
import { buildOwnerBoardState } from "@/data/project-board-owner-state.mjs";
import { resolvePortalAuthAdapter } from "@/lib/auth/browser-adapter";
import { fetchOwnerProjects } from "@/lib/projects/owner-projects-client";

type BoardState = ReturnType<typeof buildOwnerBoardState>;
type View =
  | { status: "checking" }
  | { status: "sign-in"; href: string }
  | { status: "unavailable" }
  | { status: "ready"; state: BoardState };

// Projects is the owner's private view: this static page contains no board data.
// The board is fetched only after the browser's Auth session is verified by
// /api/projects/board, which answers the account owner and no one else. A
// signed-out visitor is offered the sign-in link; any other account, and any
// error, shows the same neutral message.
export function OwnerProjectBoard() {
  const [view, setView] = useState<View>({ status: "checking" });
  useEffect(() => {
    const resolution = resolvePortalAuthAdapter(window.location);
    if (resolution.status !== "ready") {
      // Auth lives only on the account origin; elsewhere this page is a sign-in link.
      queueMicrotask(() => setView({ status: "sign-in", href: privateProjectsSignInUrl }));
      return;
    }
    const { adapter } = resolution;
    let mounted = true;
    let controller: AbortController | null = null;
    let counted = false;
    const load = () => {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      void (async () => {
        const session = await adapter.getSession().catch(() => null);
        if (!mounted || mine.signal.aborted) return;
        if (!session) {
          setView({ status: "sign-in", href: "/login?returnTo=%2Fprojects" });
          return;
        }
        setView({ status: "checking" });
        const snapshot = await fetchOwnerProjects(adapter, "board", mine.signal);
        if (!mounted || mine.signal.aborted) return;
        if (snapshot === null) { setView({ status: "unavailable" }); return; }
        try {
          setView({ status: "ready", state: buildOwnerBoardState(emptyPreview, snapshot) });
          if (!counted && emitAccountProjectsPageView()) counted = true;
        } catch {
          setView({ status: "unavailable" });
        }
      })();
    };
    load();
    const unsubscribe = adapter.onSessionChange(load);
    return () => {
      mounted = false;
      controller?.abort();
      unsubscribe();
    };
  }, []);

  if (view.status === "ready") return <ProjectBoard boardState={view.state} />;
  return (
    <section aria-label="Projects" className="project-workspace">
      <div className="project-board-shell">
        <div className="project-board-toolbar">
          <div>
            <p className="eyebrow">Fawxzzy project boards</p>
            <h1>Projects</h1>
            {view.status === "checking" ? <p aria-live="polite" role="status">Checking access…</p> : null}
            {view.status === "sign-in" ? (
              <p>Projects is private. <StaticLink href={view.href}>Sign in</StaticLink> to continue.</p>
            ) : null}
            {view.status === "unavailable" ? (
              <p role="status">Projects is not available for this account. <StaticLink href={accountUrls.account}>Back to your account</StaticLink></p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
