# Fawxzzy discovery-routing contract

## Purpose

`/discover` is the canonical Fawxzzy ecosystem hub. It replaces the former third-party LinkMe
directory with an owned, versioned route that has one job: help people use the apps, follow what
is being built, and join the community. Build, Train, and Create provide the primary orientation;
current work and verified profiles support that journey without becoming equally weighted cards.
The hub links to independently owned surfaces; it does not duplicate their application, account,
intake, authentication, data, payment, or platform state.

The canonical hub URL is `https://fawxzzy.com/discover`. Social profile website fields should
point there rather than at the retired LinkMe profile.

## Current destinations

The exact targets below were reconciled against the rendered public `https://link.me/fawxzzy`
profile and its authenticated editor on July 18, 2026. The former self-referential LinkMe icon is
intentionally omitted.

| Destination | Current target or identity | Owner |
| --- | --- | --- |
| FawxzzyFitness App | `https://fawxzzy-fitness-local.vercel.app` | Fitness |
| Custom Workout Setup | `https://buy.stripe.com/cNi9AL4a02Qf3T4dA02cg02` | Fitness |
| Join the Discord | `https://discord.gg/tnnV7BNJ7h` | Fawxzzy community |
| Main TikTok | `https://www.tiktok.com/@fukitzzzzz` | Socials OS |
| YouTube | `https://www.youtube.com/@fawxzzy` | Socials OS |
| X | `https://x.com/Fawxzzy` | Socials OS |
| Snapchat | `https://www.snapchat.com/add/fawx.zzy` | Socials OS |
| Twitch | `https://www.twitch.tv/fawxzzy` | Socials OS |
| Cash App | `https://cash.app/$fawxzzy` | Socials OS |
| PlayStation | Exact online ID `fawxzzy`; no verified public profile URL | Socials OS |

The PlayStation identity remains plain text because the prior hub exposed it as a username button,
not a public URL, and no current official public profile URL was established. Do not invent or use
a third-party profile URL.

Meta-owned surfaces are intentionally out of scope: Fawxzzy is under a standing Meta account ban
and no Instagram, Facebook, or Threads destination is published or operated through this hub.

## Building Fawxzzy weekly

`/newsletter` is the owned archive and future subscription surface for the weekly Building Fawxzzy
brief. It is linked from the primary home and Discover routes. The archive may be public before
email delivery is enabled, but no address may be collected until the delivery provider, double-opt-in
policy, unsubscribe route, and auditable sending receipts are live. This keeps the subscribe surface
truthful while Socials OS establishes the delivery boundary.

The publication surface leads with editorial value: product decisions, development notes,
experiments, lessons, and releases. Delivery readiness is secondary status. Until a real issue is
published with a stable URL and verified metadata, the archive must render an honest empty state;
draft titles, invented issue numbers, implied dates, and readership claims are prohibited.

## Current-work read model

Discover may show compact current-work entries only from centralized FawxzzyWeb catalog truth in
`src/data/apps.ts`. Product names, status, latest-update copy, posters, and internal detail routes
must remain synchronized with the app catalog. The hub does not scrape social activity, infer
recency, or present unverified external activity as a Fawxzzy release.

## Fitness intake replacement contract

The Stripe Custom Workout Setup target is a temporary public bridge. Fitness owns the eventual
canonical intake feature and route. Once Fitness ships and publicly verifies that route,
the FawxzzyWeb owner may update this single centralized destination target. FawxzzyWeb must not
implement or store intake answers, authentication, workout-plan state, customer data, or payment
state.

## Link hub retirement gate

LinkMe may be retired from Socials OS only after the exact FawxzzyWeb revision is production-live
and public readback proves:

1. `https://fawxzzy.com/discover` is reachable through the primary Fawxzzy navigation on desktop
   and mobile.
2. Every target or identity in the table above matches the centralized contract.
3. The page has a canonical URL, passes accessibility and no-horizontal-overflow checks, and has no
   unexpected console, request, or runtime errors.
4. Supported social profile website fields have moved from LinkMe to the canonical hub, with exact
   account and post-save readback.
5. Historical LinkMe receipts remain preserved for auditability while LinkMe is removed from active
   account, collection, planning, and publishing scope.

A preview proves implementation readiness but does not open the retirement gate because it is not
the public `fawxzzy.com` surface.
