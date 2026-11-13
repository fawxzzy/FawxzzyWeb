# Live "online now" display

The site header shows a small live count of people on the website where the brand text used to be:
a dot, and once connected `12 online`. This is separate from first-party analytics
(`docs/first-party-analytics.md`): it stores nothing and reads nothing from the analytics table.

## Definition
- **Online** means a Fawxzzy site tab that is **visible in a browser right now**. Each visible tab counts
  once. A person with two visible windows counts twice; a hidden or background tab does not count.
- It is not a visitor total, not a session count and not registered accounts.
- Web only. Fitness and Mazer are separate products and are not included.

## How it works
- Each visible tab joins the anonymous Supabase Realtime presence channel `web-presence-v1` with a random
  `crypto.randomUUID()` key held only in memory, and tracks `{ v: 1 }`. Nothing else is sent: no account,
  name, email, IP-derived value, route, user agent or free text. No cookie or storage is written.
- The count is recomputed from the channel's current presence snapshot on every sync (never accumulated from
  join/leave events). A tab leaves when it becomes hidden, on `pagehide`, or when it closes; Realtime also
  drops a presence whose connection goes away.
- Code: `src/lib/presence/presence-contract.mjs` (pure rules), `src/lib/presence/presence-client.ts`
  (lazy Realtime client), `src/components/site/presence-counter.tsx` (header island).

## Where it runs
Only on the production origins `https://fawxzzy.com` and `https://account.fawxzzy.com`. Previews, local test
origins, the `www` alias, no-JS, hidden tabs and offline browsers show only the dim dot. The Realtime client is
loaded on demand about 1.5 s after the page mounts and is never part of the catalog's route JavaScript budget.

## Unavailable states
While connecting, on any error or timeout, before this tab has joined, or when the public configuration is
missing, the display is the dim dot with no number. A zero or unknown count is never shown.

## Known limits
- The channel is public: anyone holding the public publishable key can join it and inflate the number, so treat
  it as a casual indicator, not a measurement.
- Supabase Realtime connection quotas apply to the shared project; past them the display simply goes dim.
- Changing the definition (for example dedupe per browser) needs a reviewed identifier and retention contract.
