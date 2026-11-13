import { RealtimeClient, type RealtimeChannel } from "@supabase/realtime-js";
import { isBrowserSafeSupabasePublicKey } from "@/lib/auth/supabase-public-key.mjs";
import { PRESENCE_CHANNEL, countPresence, realtimeUrl } from "@/lib/presence/presence-contract.mjs";

// Lazy chunk: loaded only on the production site origins, after the page settles (see
// presence-counter.tsx). Joins an anonymous presence channel while this tab is visible and
// reports the current count; reports null whenever the count is unknown.
export function startPresence(onCount: (count: number | null) => void): () => void {
  // Literal property reads so Next inlines the public values at build time.
  const url = realtimeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !isBrowserSafeSupabasePublicKey(key)) {
    onCount(null);
    return () => undefined;
  }

  let client: RealtimeClient | null = null;
  let channel: RealtimeChannel | null = null;
  let stopped = false;

  const leave = () => {
    const current = channel;
    const connection = client;
    channel = null;
    client = null;
    onCount(null);
    if (current) void current.untrack().catch(() => undefined);
    if (connection) void connection.disconnect();
  };

  const join = () => {
    if (stopped || client || document.visibilityState !== "visible") return;
    const connection = new RealtimeClient(url, { params: { apikey: key } });
    // A random per-tab key held only in memory; it is gone when the tab closes.
    const presence = connection.channel(PRESENCE_CHANNEL, { config: { presence: { key: crypto.randomUUID() } } });
    client = connection;
    channel = presence;
    let tracked = false;
    presence.on("presence", { event: "sync" }, () => {
      // The first sync arrives before this tab has joined and reports 0: never show it.
      const count = countPresence(presence.presenceState());
      onCount(tracked && count >= 1 ? count : null);
    });
    presence.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void presence.track({ v: 1 }).then(() => {
          tracked = true;
          onCount(countPresence(presence.presenceState()) || null);
        }).catch(() => onCount(null));
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        tracked = false;
        onCount(null);
      }
    });
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") join();
    else leave();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", leave);
  join();

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", leave);
    leave();
  };
}
