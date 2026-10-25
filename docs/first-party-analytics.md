# First-party website analytics

FawxzzyWeb has a privacy-minimal first-party analytics source contract. It measures only the
closed product-navigation vocabulary needed to improve the storefront and decide when legacy
compatibility routes can be retired.

## Data boundary

The client may send only:

- event: `page_view`, `tiktok_open`, `catalog_app_view`, `app_launch`, or `compatibility_visit`
- product: `web`, `fitness`, or `mazer`
- canonical route: `/`, `/apps`, or the fixed app route `app`; retired website detail paths normalize to `/apps`
- optional app: `fitness` or `mazer`
- optional compatibility source: `discover`, `trove`, `fitness_legacy_origin`, or
  `mazer_legacy_origin`

The server supplies the timestamp. The implementation does not create cookies or identifiers and
does not store IP addresses, user agents, referrers, arbitrary URLs, account IDs, or free-form text.
The table lives in a private schema, is not granted to `anon` or `authenticated`, and is writable
only through the bounded Edge Function.

## Activation boundary

Source presence does not mean provider activation. Activation requires separately authorized:

1. migration application to the bound Supabase project;
2. deployment of `first-party-analytics` with JWT verification disabled because it is a public,
   origin-restricted event collector with its own closed validation;
3. the public collector URL on each product build (`NEXT_PUBLIC_FAWXZZY_ANALYTICS_URL` for
   FawxzzyWeb and Fitness, `VITE_FAWXZZY_ANALYTICS_URL` for Mazer);
4. new reviewed production deployments and live readback for every instrumented product.

When the environment variable is absent, the client performs no network request.
The website client also emits only from the canonical `fawxzzy.com` and `www.fawxzzy.com`
origins. Account and other subdomains do not send storefront analytics.

## Aggregate projection source contract

The pure `projectAnalyticsSnapshot` contract accepts a complete aggregate for one closed UTC
window, with `windowStart`, `windowEnd`, a source freshness timestamp `asOf`, and rows containing
only a known event, known product, and nonnegative safe-integer count. A caller supplies the
current UTC time and its maximum allowed source age. The contract rejects missing or invalid
freshness, unknown labels, duplicate event/product rows, extra fields, invalid time ordering,
and unsafe counts. A valid empty row set represents a measured zero for that complete window;
an absent or stale source never does.

`pageViews` sums only `page_view` rows, both overall and for `web`, `fitness`, and `mazer`.
Navigation events cannot establish people, sessions, or live presence. `uniqueVisitors`,
`sessions`, and `activeNow` therefore remain explicitly unavailable, even when page-view
aggregates are fresh. Visitor and session metrics require a separately reviewed identifier,
consent, retention, bot, and cross-tab contract. Active presence additionally requires a
reviewed heartbeat and expiry contract. No such collector or provider contract is installed by
this source-only projection.

The projection is not a live counter, public API, board value, or deployment claim. It is a
validation boundary for a future approved aggregate reader. Provider activation, private-card
adoption, public rendering, and observed browser acceptance remain separate decisions.

## Compatibility retirement

`/discover`, `/trove`, and the old Fitness and Mazer Vercel origins remain compatibility redirects.
Their destinations add a one-use `compatibility` marker; the destination product records it once
and removes it from the address bar. A route or origin may be retired only after a declared
observation window has zero matching compatibility events, rollback evidence is retained, and a
separate retirement decision is approved. Source installation starts the observation capability;
it does not establish a zero-traffic window retroactively.
