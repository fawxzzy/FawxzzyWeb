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

The site-wide browser, installed-web-app, and Apple-touch icon derivatives are generated from the
same square source. They are product outputs, not a separate brand source.

| Product icon output | SHA-256 |
| --- | --- |
| `public/favicon.ico` | `FD188203DFA88789887317E477F10114D8889875B00149AC2517D258A2DE8F00` |
| `public/favicon-16x16.png` | `BE565B2C59E9C609C21E6884E4BAF8EBAEBE9AF58E0E2A4D1CAF51D270FDE0A5` |
| `public/favicon-32x32.png` | `6F74F0C18F2CF5D694805DA1995F65AFC0893F62573ECE5BFF3CBEC623AC42F7` |
| `public/app/icon-192.png` | `706FBAAE6ED1F82D736B03F8D334246257C7C2AD12D8D2EDB4B2CA4A37525018` |
| `public/app/icon-512.png` | `CC32C475A3B9E6B5079E2AD0EF935256741930CB4D0D7614892DEB1EA67CD4E3` |
| `public/icons/apple-touch-icon.png` | `4883D5810B0456B87D0A15112FF960BDA5162C4FBAC8864572E0762AAEB139B1` |

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
- A July 18 browser preflight found no reusable Fitness production session in either available
  browser surface; the public app resolved to its password-gated login route. No credentials were
  requested, entered, or retained, and no Fitness production capture was taken. This is the release
  gate for replacing the current Fitness trailer with honest live production footage.
- Seven unreferenced legacy screenshot candidates remain retained locally until a separate
  retention decision confirms they are no longer needed for rollback or provenance.
- The public catalog is trailer-only. Static screenshot galleries and the Fitness screenshot-board
  route are removed from the visible experience; Vercel permanently redirects the legacy URL to the
  Fitness trailer anchor. Existing static source files remain unlinked for rollback and provenance.
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
