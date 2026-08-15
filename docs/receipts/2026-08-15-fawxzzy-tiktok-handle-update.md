# Fawxzzy TikTok handle update

Date: 2026-08-15

## Current identity

- Public label: `@fawxzzy`
- Public profile: `https://www.tiktok.com/@fawxzzy`
- Operator source: current-thread identity correction
- Read-only public URL check: HTTP `200` at the exact profile URL

## FawxzzyWeb change

The centralized TikTok discovery destination now uses the current public label
and exact current profile URL. Home, the compatibility Discover page, and the
site footer consume that one source, so they remain consistent without
route-specific copies.

The dated production receipt that contains the prior handle is preserved as
historical provenance. It is not an active routing source.

## Boundaries

- No TikTok account or provider mutation was performed.
- No analytics collector, tracking provider, email, newsletter, Discord,
  YouTube, X, Snapchat, or other retired-channel behavior was introduced.
- Deployment and production remain separately gated.
