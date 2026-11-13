"use client";

import { useEffect, useState } from "react";
import { emitAccountProjectsPageView } from "@/components/analytics/first-party-analytics";
import { ProjectBoard } from "@/components/projects/project-board";
import { NotFoundState } from "@/components/system/not-found-state";
import { accountContract, accountProjectsUrl } from "@/config/account";
import emptyPreview from "@/data/project-board-preview.generated.json";
import { buildOwnerBoardState } from "@/data/project-board-owner-state.mjs";
import { resolvePortalAuthAdapter } from "@/lib/auth/browser-adapter";
import { fetchOwnerProjects } from "@/lib/projects/owner-projects-client";

type BoardState = ReturnType<typeof buildOwnerBoardState>;
type View =
  | { status: "checking" }
  | { status: "hidden" }
  | { status: "ready"; state: BoardState };

// Projects is the owner's private view and must not be visible to anyone else:
// this static page contains no board data, no heading and no copy about Projects.
// Until the server confirms the owner it shows nothing; for everyone else it is
// indistinguishable from a page that does not exist. A signed-out visitor on the
// account origin is sent to sign in; any other origin is sent to the account origin
// (the Auth session lives only there). The board is fetched only after the browser's
// Auth session exists, from /api/projects/board, which answers the account owner
// and no one else.
export function OwnerProjectBoard() {
  const [view, setView] = useState<View>({ status: "checking" });
  useEffect(() => {
    const resolution = resolvePortalAuthAdapter(window.location);
    if (resolution.status !== "ready") {
      if (window.location.origin === accountContract.canonicalOrigin) {
        queueMicrotask(() => setView({ status: "hidden" }));
      } else {
        window.location.replace(accountProjectsUrl);
      }
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
          setView({ status: "checking" });
          window.location.replace("/login?returnTo=%2Fprojects");
          return;
        }
        setView({ status: "checking" });
        const snapshot = await fetchOwnerProjects(adapter, "board", mine.signal);
        if (!mounted || mine.signal.aborted) return;
        if (snapshot === null) { setView({ status: "hidden" }); return; }
        try {
          setView({ status: "ready", state: buildOwnerBoardState(emptyPreview, snapshot) });
          if (!counted && emitAccountProjectsPageView()) counted = true;
        } catch {
          setView({ status: "hidden" });
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
  if (view.status === "hidden") return <NotFoundState />;
  return <div aria-busy="true" />;
}
