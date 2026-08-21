# Fawxzzy public visual system

## Product direction

Fawxzzy is presented as an independent product studio and creator ecosystem.
The public experience keeps the black-green canvas, sage accent, wolf identity,
and ambient background while using composition and product proof—not extra
decoration—to establish hierarchy.

## Page families

Shared identity does not require identical composition. Active public routes use four
page families:

1. Brand and marketing: the Home route.
2. Product catalog: the Apps and Trove compatibility routes.
3. Compatibility and provenance: the Discover fallback and retired editorial history.
4. Utility and system: Login, confirmation, callback, reset, Account, and 404 recovery.

Wave 1 established the first two families. The retired Wave 2A product-detail and
Wave 2B editorial families remain historical provenance only.
The secure utility shell gives Login, confirmation, callback, and reset a focused
task layout; the Account dashboard remains the operational branch of the same
family.

## Utility and Auth template

Secure handoff pages do one job. They use a compact account navigation bar,
an unbordered orientation column, one task panel, and deterministic pending,
success, failure, and retry states. They do not repeat the public marketing
navigation or expose provider terminology in primary copy.

Successful callbacks sanitize the visible URL before a short announced handoff
to an exact allowlisted destination. A visible link remains as the fallback.
Missing, invalid, expired, or setup-pending actions fail closed and never navigate
automatically. Browser autofill semantics, origin-scoped sessions, and the
existing token/return-target constraints remain behavioral contracts.

## Style ownership

`src/app/globals.css` is the ordered import manifest, not a selector bucket. New
styles belong to the narrowest established owner:

- `src/styles/foundations/` owns tokens, reset rules, and document primitives.
- `src/styles/components/` owns cross-family site-shell and catalog primitives.
- `src/styles/components/app-launcher.css` owns the Apps icon grid and its
  opt-in Preview and Feedback dialogs.
- `src/styles/page-families/utility.css` owns Login, Auth handoff, recovery, and
  Account presentation until the utility-family refinement lands.
- `src/styles/page-families/product-detail.css` retains historical Fitness and Mazer
  detail styling for provenance and ordered-cascade compatibility; it does not authorize active detail routes.
- `src/styles/page-families/studio-public.css` owns the Home/catalog studio
  frame and its current shared footer/navigation refinements.
- `src/styles/page-families/editorial.css` retains historical Discover and
  Newsletter styling as provenance only; it does not authorize an active
  newsletter or editorial route.
- `src/styles/page-families/legacy-public.css` retains the earlier public rules
  in their original cascade position while later lanes retire or migrate them.

Import order is a compatibility contract because later studio and editorial
rules intentionally refine earlier foundations. Do not reorder the manifest to
solve a one-page styling issue. Extend the canonical owner or perform a bounded,
screenshot-proven migration instead.

## Historical editorial template

This section records the retired Wave 2B editorial design for provenance only.
It is not current route or product authority: `/newsletter` is intentionally
absent and returns 404, while `/discover` is a lightweight compatibility entry
for canonical Home.

- Historical Discover oriented visitors around Build/Train/Create,
  catalog-backed work, verified profiles, community, and the build log.
- The retired Newsletter surface explained editorial value, showed the truthful
  archive state, and disclosed email-delivery readiness as secondary operational
  status. Those behaviors must not return to active navigation or routing.
- Historical current-work rows derived product name, status, update, poster, and
  route from `src/data/apps.ts`; they did not imply scraped activity or invent
  dates, metrics, readership, releases, or social proof.
- The historical issue archive used an explicit empty state until a real issue
  had a stable URL and verified publication metadata.
- Verified profile targets were centralized in `src/data/discovery.ts`. This
  provenance does not authorize restoring retired destinations.

The historical production-before contact sheet for Wave 2B is stored at
`docs/visual-baselines/2026-07-20-wave2b-production-before.png`. It captures
Discover and Newsletter from production main `9d892a73` in desktop Chromium at
1440 by 900 and mobile WebKit at 390 by 844. Its SHA-256 is
`D7D11DCC07F47AF48D7A1143CBEBFD9FE30B1A4C0861421ABF942A66A0B9B8E1`.
It is immutable comparison evidence, not current Newsletter route or lifecycle
authority.

## Surface hierarchy

- Canvas: ambient page background with no visible border.
- Panel: one major section or product/media container, with an 18–24px radius.
- Tile: an interactive row or control, with a smaller radius and explicit
  hover/focus behavior.

Do not nest more than two visibly bordered surfaces. Text groups should sit on
the canvas unless a panel communicates a real section boundary.

## Typography and spacing

- Hero copy uses a responsive 3.4–5.5rem scale on desktop and a restrained
  2.8–3.8rem scale on narrow mobile screens.
- Major sections use 2.25–3.75rem headings and 1–1.125rem body copy.
- Body columns stay near 64–66 characters.
- The shared desktop content width is 1240px.
- Major sections use approximately 80–128px of separation; cards use 20–28px.
- Interactive controls are at least 44px tall.

## Product media

Home uses the compact product card while Apps uses a phone-home-screen launcher.
Both read icons, current storefront previews, status, app origins, and copy from
`src/data/apps.ts`. On Apps, only the app icon and name form the primary launch
action. The current source-bound WebP appears only after the visitor selects
`Preview`; no secondary detail route or screenshot gallery competes with launch.

Product accents occupy a small part of the composition and remain subordinate
to the shared black-green canvas. Fitness and Mazer continue to own their
origins and their canonical branding assets.

## Single-screen app catalog

The Apps page consolidates installation help, direct launch, an optional current
preview, and truthful feedback state into one screen family. The shared template uses:

- installation help at the top for iPhone/iPad, Android, Windows, and macOS;
- one phone-style app icon and name that opens the branded app origin directly;
- a separate `Preview` dialog for one current, source-bound product image;
- a separate `Feedback` dialog that fails closed to an unavailable state until
  the governed public review read model exists;
- a product accent constrained to borders, status text, media glow, and small
  section details rather than a separate visual theme.

Fitness uses a training-derived yellow-green accent. Mazer uses a restrained
teal/cyan accent derived from its current icon. Both keep the shared black-green
canvas, global typography, navigation, footer, and interaction rules.

Catalog copy must describe current product behavior. It must not invent roadmap
dates, usage metrics, ratings, testimonials, or canonical-origin cutovers.
Launch links continue to use the centralized current-origin contract.
Whole internal screenshot catalogs are reference evidence, not public route
media. Product-route derivatives retain their source commit or design-authority
provenance and explicit dimensions in `src/data/apps.ts`. All story images load
below the fold; planned Mazer imagery must say `Preview`, `In development`, and
`Not current gameplay` next to the image.

## Navigation and footer

The shared primary navigation is sticky, preserves one active destination, and
keeps 44px targets at 320px and wider. Account entry points live in the footer
during this wave so the narrow primary navigation remains uncluttered.

The current footer uses only Home, Apps, the centralized TikTok destination, and
Account. Newsletter, build-log, Discover, and retired social destinations must
not return to the footer without a new current owner decision. Do not invent
legal, support, or social destinations.

## Accessibility and motion

- Every interactive surface needs a visible keyboard focus state.
- Normal text must meet WCAG AA contrast.
- Trailer players have an accessible name, captions, native controls, and a
  keyboard-operable explicit play action; decorative wolf marks remain hidden.
- `prefers-reduced-motion` removes ambient animation, product lift, navigation
  transitions, and nonessential button movement.
- No essential information or action may depend on hover.

## Future migration rule

Extend the shared tokens and primitives, but keep each page family suited to its
job. Marketing is editorial, catalog pages are media-led, product pages are
proof-led, authentication is focused, and Account is structured. Avoid the
card-monoculture failure mode where every content type receives the same border,
radius, padding, and visual weight.
