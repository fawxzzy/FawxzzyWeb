# Fawxzzy public visual system

## Product direction

Fawxzzy is presented as an independent product studio and creator ecosystem.
The public experience keeps the black-green canvas, sage accent, wolf identity,
and ambient background while using composition and product proof—not extra
decoration—to establish hierarchy.

## Page families

Shared identity does not require identical composition. Public routes use five
page families:

1. Brand and marketing: the Home route.
2. Product catalog: the Apps and Trove compatibility routes.
3. Product detail: Fitness, Mazer, and future product routes.
4. Editorial and directory: Discover, the build log, and Newsletter.
5. Utility: Login, confirmation, callback, reset, and Account.

Wave 1 implements the first two families. Later waves should migrate the other
families without duplicating the Home or catalog composition.

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

The product showcase is the canonical Home and Apps product primitive. It reads
icons, posters, status, current updates, and routes from `src/data/apps.ts`.
Posters render before playback UI. Video keeps native controls, captions,
explicit user-start behavior, and `preload="none"` so the MP4 payload is not an
initial-page requirement.

Product accents occupy a small part of the composition and remain subordinate
to the shared black-green canvas. Fitness and Mazer continue to own their
origins and their canonical branding assets.

## Navigation and footer

The shared primary navigation is sticky, preserves one active destination, and
keeps 44px targets at 320px and wider. Account entry points live in the footer
during this wave so the narrow primary navigation remains uncluttered.

The footer uses only routes that already exist: Apps, Fitness, Mazer, Discover,
Newsletter/build log, Login, and Account. Do not invent legal, support, or
social destinations.

## Accessibility and motion

- Every interactive surface needs a visible keyboard focus state.
- Normal text must meet WCAG AA contrast.
- Product posters carry useful alternative text; decorative wolf marks do not.
- Trailer disclosures retain native `details`/`summary` semantics.
- `prefers-reduced-motion` removes ambient animation, product lift, navigation
  transitions, and nonessential button movement.
- No essential information or action may depend on hover.

## Future migration rule

Extend the shared tokens and primitives, but keep each page family suited to its
job. Marketing is editorial, catalog pages are media-led, product pages are
proof-led, authentication is focused, and Account is structured. Avoid the
card-monoculture failure mode where every content type receives the same border,
radius, padding, and visual weight.
