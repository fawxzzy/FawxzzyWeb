# Live interaction trailer remake receipt

## Purpose

Replace the catalog trailer masters with short, vertically framed production walkthroughs that
show real navigation and visible input rather than static screen presentation. Every master opens
with a Fawxzzy brand card and ends with a clear app call-to-action.

## Released assets

| App | Master | Duration | Video SHA-256 | Poster SHA-256 |
| --- | --- | ---: | --- | --- |
| Fitness | `public/apps/fitness/trailer.mp4` | 00:19.83 | `CB26D96E72C6ABCAB9A57F4C4774291E89D1DDA1C0634902F7C667F5D4EB07E5` | `391CC4B80246BA41F12CBA8D3A6FD132D4711BE8AA9F37B56911F1CA62E2E3D0` |
| Mazer | `public/apps/mazer/trailer.mp4` | 00:14.33 | `0F04162F9E9C9FA8AD7203245BEAA78B4A3967D23D8E7035AA65F6949008B297` | `9999A84AE09894A5900A12581A0FCBD486A852C9EE9F191052CAC09F2F9DD6A0` |

Both masters are 1080-by-1920 H.264/yuv420p MP4 at 30 fps with a matching WebVTT track and a
poster frame extracted from the trailer itself. Catalog routes use these trailers as the only
preview medium; no static screenshot rail remains in the public catalog.

## Capture truth

- Fitness: current production at `https://fawxzzy-fitness-local.vercel.app`, using the dedicated
  sanitized QA account. The capture visibly opens Routines, History, Today, resumes the existing
  training session, then opens the next exercise. It does not log, save, discard, or edit any
  workout data.
- Mazer: current production at `https://fawxzzy-mazer.vercel.app`, in a fresh non-persistent guest
  context. The capture visibly enters a run, moves through the maze, pauses, and resumes.
- The pointer/tap indicator is included in the recorded browser surface. Raw capture, temporary
  authenticated state, and render intermediates remain ignored local artifacts outside this repo.

## Storage and rollback

- The obsolete unreferenced screenshot asset directories are removed from the public catalog
  bundle. Historical Git revisions and prior Vercel deployments remain the rollback/provenance
  record; no product-origin storage, Fitness/Mazer source repository, account data, or provider
  configuration was changed.
- The Fawxzzy banner and icon already present in this branch remain the site identity assets. This
  receipt does not authorize any social-profile change.

## Verification contract

1. Confirm both MP4 masters and captions are referenced from centralized `src/data/apps.ts`.
2. Run the repository verification suite and validate visible trailer playback on the exact merged
   production `/apps` and app-detail routes.
3. Verify the public catalog contains no static screenshot-gallery UI or obsolete screenshot
   preview assets after deployment.
