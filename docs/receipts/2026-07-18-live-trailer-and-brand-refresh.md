# Live trailer and brand refresh receipt

## Purpose

Replace the Mazer catalog trailer with a compact, captioned live-interaction master and synchronize
the newly supplied Fawxzzy banner and square icon onto the public web surface. The Fitness fixture
capture is retained as private review evidence only until an exact production showcase capture is
available.

## Brand outputs

| Role | Public output | SHA-256 | Source role |
| --- | --- | --- | --- |
| Horizontal banner | `public/brand/fawxzzy-banner.png` | `54AA29C345131D50125339185805583BA7F031824E2542299CF04E624ADB08AC` | Current Fawxzzy header/banner standard |
| Square icon | `public/brand/fawxzzy-wolf.png` | `0B9D183E1DD6738C6C2BD41A38593B26BD50FAD3C7F7B897AC263D6387132D13` | Current Fawxzzy avatar/icon standard |

The supplied originals were 1280x426 (banner) and 1254x1254 (icon). Public outputs are lossless
PNG derivatives so existing rooted routes and metadata continue to work without MIME ambiguity.

## Trailer outputs

| App | Duration | Video SHA-256 | Poster SHA-256 | Capture truth |
| --- | ---: | --- | --- | --- |
| Mazer | 00:34.8 | `7D88E51802780DBD6AAB97D329E55C9FF0A8FBEBFF6F761EC9C19BB7A9DAD6FB` | `753BF581A2A093341745C64A21876F5E2DF6B1405F127A20C0CBE9AA5CA950B5` | Live Mazer production capture: watch mode, active play, pause, and resume. |

The Mazer master is 1080x1920 H.264/yuv420p MP4 at 30fps with an AAC-LC silent compatibility
track and an independent WebVTT caption track. It uses live screencast frames and safe-area
composition; no legacy catalog screenshots are used as trailer footage.

## Boundaries

- The previous masters remain recoverable through the pre-refresh Git revision and the existing
  Vercel deployment rollback path; this change does not delete historical release evidence.
- The Fitness live-fixture review cut is not published as a catalog master; it remains local-only
  evidence until a privacy-safe production showcase capture can replace it.
- Seven unreferenced legacy screenshot candidates remain retained locally until a separate
  retention decision confirms they are no longer needed for rollback or provenance.
- The current web update does not change Fitness or Mazer deployment, Supabase/Auth/billing data,
  social accounts, profile fields, or external publishing.
- The Fawxzzy icon/banner rollout to social profiles requires exact authenticated account
  verification and a per-save public readback. It is planned through Socials OS rather than
  inferred from this web asset refresh.

## Follow-up contract

1. Verify the exact catalog routes and trailer playback on a preview.
2. Publish this bounded FawxzzyWeb change only through the separately approved production path.
3. Execute the social-profile avatar/banner refresh as a bounded, verified Socials OS curation
   batch; preserve the approved body photograph as a separate profile-image option.
