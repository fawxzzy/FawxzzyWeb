import type { AuthNotice } from "@/lib/auth/copy-matrix";

/**
 * Part of the copy matrix (src/lib/auth/copy-matrix.ts composes and re-exports it): the 404 and
 * crash screens' words. Those screens ship on every route (route error boundary, global error,
 * not-found), so they import this leaf instead of the whole matrix; keeping the matrix out of every
 * route's JavaScript holds the /apps budget in scripts/assert-discovery-performance.mjs.
 */
export const STATUS_COPY = {
  tryAgain: "Try again",
  goToAccount: "Go to account",
  pageNotFound: "Page not found",
  couldNotLoad: "Could not load",
  pageNotFoundLead: "That page does not exist.",
  crash: "Check your connection and try again.",
} as const;

/** The crash screen's notice (`page.crash`), built without the full message table. */
export const PAGE_CRASH_NOTICE: AuthNotice = { id: "page.crash", tone: "error", text: STATUS_COPY.crash };
