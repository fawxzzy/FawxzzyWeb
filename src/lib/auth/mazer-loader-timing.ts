/**
 * Timeline of the host's Mazer authorization loader (MAZER-ACCT-041). It must look and time like
 * Mazer's own loader (Mazer repo, src/render/appLoader.ts) so the person sees one continuous
 * loading look: opaque dark page from the first paint, the app icon appears only after
 * LOADER_SHOW_DELAY_MS (CSS animation, 200 ms fade in), and once shown it stays at least
 * LOADER_MIN_HOLD_MS before the page leaves. A wait that ends before the icon would show leaves
 * immediately, so a fast sign-in shows only the bare dark page. The 300 ms fade-out is not copied:
 * this page unloads when it navigates, so there is nothing left to fade.
 */
export const LOADER_SHOW_DELAY_MS = 150;
export const LOADER_MIN_HOLD_MS = 350;
export const LOADER_FADE_IN_MS = 200;

/**
 * How long to keep waiting before leaving the page. `elapsedMs` is the time since the loader was
 * first painted. Under the show delay nothing was ever visible, so there is nothing to hold.
 */
export function loaderHoldRemainingMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < LOADER_SHOW_DELAY_MS) return 0;
  return Math.max(0, LOADER_SHOW_DELAY_MS + LOADER_MIN_HOLD_MS - elapsedMs);
}
