# Mazer current gameplay preview refresh

Status: source candidate prepared; no merge, deploy, provider, account, or production mutation occurred.

The prior Mazer trailer was a July 20, 2026 60-second guest walkthrough. Mazer production is now login-first and its current source head is `6d9b78d7c144c2bca4a3843a6e9d4e3f83e745f6`, so that contract was stale.

The refreshed `public/apps/mazer/trailer.mp4` is a 25.44-second, 1080-by-1920, 30 fps H.264/yuv420p MP4 with fast-start metadata. It is a deterministic Playwright recording from `https://mazer.fawxzzy.com/?mode=play&runtimeDiagnostics=1&authFixture=authenticated&mazeSeed=3749` in an isolated browser context. The documented fixture stores only synthetic state in that browser's local storage; no credentials, user records, or product mutations were used. The matching poster and ordered WebVTT captions are tracked beside the video.

Regenerate with Playwright at a 1080-by-1920 viewport and `recordVideo.size` of 1080-by-1920, using the exact URL above and no persistent browser storage. Transcode the resulting WebM with `ffmpeg -i input.webm -an -c:v libx264 -pix_fmt yuv420p -preset medium -crf 26 -movflags +faststart -r 30 public/apps/mazer/trailer.mp4`; write the poster from the inspected gameplay frame. Recompute the video and poster SHA-256 values in `src/data/apps.ts`, keep captions within the measured 25.44-second duration, run `npm run verify`, and browser-check `/apps/mazer` on mobile and desktop before any separately authorized publication.
