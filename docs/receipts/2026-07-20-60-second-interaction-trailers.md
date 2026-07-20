# 60-second live interaction trailer candidate receipt

Status: prepared and locally verified; not merged or production-released.

## Purpose

Replace the short catalog trailer masters with 60-second, vertical live interaction walkthroughs.
Each master uses real production-app interaction, a deliberate branded opening, smooth dark-to-dark
transitions with no white loading frame, ordered WebVTT captions, and a QR-code ending that targets
`https://fawxzzy.com`.

## Prepared assets

| App | Master | Duration | Video SHA-256 | Poster SHA-256 |
| --- | --- | ---: | --- | --- |
| Fitness | `public/apps/fitness/trailer.mp4` | 01:00.00 | `31747F9B62A7D55E549FE0B15F8AE56840FBE172D0871027366097EED8AF982E` | `D2228EDB36BBDA1EB1D32EA1EF8D643E1C18CEE5C7600CEC3D9B21E308223FDC` |
| Mazer | `public/apps/mazer/trailer.mp4` | 01:00.00 | `711A5ED95B3527648F69BCF0A0E69761B4B84D87CE1C919FF34C88D880E28623` | `EB092F948FA617C8906BBF59795CD17FC9839CF873A440B8589E3223CAC8FD5F` |

Both masters are 1080-by-1920 H.264/yuv420p MP4 at 30 fps with fast-start metadata, a matching
poster frame, and a matching WebVTT track. The public catalog continues to use trailers as the only
app-preview medium; this change does not restore any screenshot gallery.

## Capture truth

- Fitness was captured from `https://fawxzzy-fitness-local.vercel.app` using the dedicated,
  sanitized QA account. The recorded flow is read-only: Today, exercise detail, Routines, History,
  saved-session detail, and return to Today. It does not start, log, save, discard, delete, or edit
  workout/account data.
- Mazer was captured from `https://fawxzzy-mazer.vercel.app` in a fresh non-persistent guest
  context. The recorded flow visibly enters a maze, makes keyboard moves, pauses for the player guide,
  and returns to play.
- The raw authenticated state, browser recordings, render intermediates, and QR-generation tooling
  remain outside this repository. The QR code contains only the public website URL.

## Release boundary and rollback

This receipt records a candidate integration only. It does not authorize a merge, Vercel deployment,
social-account change, provider change, or product-data mutation. Current deployed trailer assets and
the prior production deployment remain the rollback path until a separately authorized production
release and exact deployed readback are recorded.

## Verification contract

1. Validate each master hash against `src/data/apps.ts` and this receipt.
2. Confirm 60-second duration, 1080x1920 geometry, 30 fps, H.264/yuv420p encoding, fast-start metadata,
   decodability, poster decodability, and ordered non-overlapping caption cues.
3. Confirm intro, exit, QR target, live interaction continuity, and absence of white loading frames.
4. Run the repository verification suite, then verify playback on the exact integration head before any
   separately authorized production release.
