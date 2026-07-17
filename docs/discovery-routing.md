# FawxzzyWeb discovery-routing contract

## Purpose

`/discover` is the FawxzzyWeb-owned routing surface for the current Fitness app, the Fitness-owned
custom-workout offer, Discord, the main TikTok account, and the canonical YouTube channel. It links
out to those independently owned surfaces; it does not duplicate their application, account,
intake, authentication, data, or payment state.

## Current destinations

The exact targets were reconciled against the rendered public `https://link.me/fawxzzy` page on
July 16, 2026:

| Destination | Current target | Owner |
| --- | --- | --- |
| FawxzzyFitness App | `https://fawxzzy-fitness-local.vercel.app` | Fitness |
| Custom Workout Setup | `https://buy.stripe.com/cNi9AL4a02Qf3T4dA02cg02` | Fitness |
| Join the Discord | `https://discord.gg/tnnV7BNJ7h` | Fawxzzy community |
| Main TikTok | `https://www.tiktok.com/@fukitzzzzz` | Socials OS |
| YouTube | `https://www.youtube.com/@fawxzzy` | Socials OS |

YouTube remains a separate destination rather than being folded into the four-card Socials OS
replacement gate.

## Fitness intake replacement contract

The Stripe Custom Workout Setup target is a temporary public bridge. Fitness owns the eventual
canonical intake feature and route. Once Fitness ships and publicly verifies that route,
FawxzzyWeb may update this single centralized destination target. FawxzzyWeb must not implement or
store intake answers, authentication, workout-plan state, customer data, or payment state.

## Socials OS removal gate

Socials OS must not remove the four superseded LinkMe featured cards until the exact FawxzzyWeb
change is deployed to production and unauthenticated public readback proves:

1. `/discover` is reachable through the primary FawxzzyWeb navigation on desktop and mobile.
2. The Fitness app, Custom Workout Setup, Discord, and main TikTok links match the centralized
   targets above and complete successfully.
3. The page has a canonical URL, passes accessibility and no-horizontal-overflow checks, and has no
   unexpected console or runtime errors.
4. YouTube remains independently visible and working.

A preview proves implementation readiness but does not open the removal gate because it is not the
public `fawxzzy.com` surface.
