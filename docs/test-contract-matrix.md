# Test contract matrix

| Surface or contract | Deterministic source/build proof | Browser proof | Portable evidence |
| --- | --- | --- | --- |
| Marketing Home | site smoke, optimized build | Chromium + WebKit, WCAG, focus, overflow, runtime errors | `/` on four disclosed Playwright UI-target emulations |
| Apps catalog | centralized catalog/media assertions | trailer isolation/playback, WCAG, focus, overflow | `/apps` on all four emulated UI target classes |
| Fitness and Mazer detail | centralized origins and media hashes | trailer playback/retry, metadata, WCAG | both `/apps/<slug>` routes |
| Unified discovery | truthful app/TikTok assertions plus redirect config | Home hierarchy, lightweight Discover fallback, WCAG, overflow | `/` and `/discover` on all four emulated UI target classes |
| Utility/Auth | origin, return, PKCE, password, error, cooldown contracts | Login/confirm/callback/reset states, WCAG, errors | four Auth routes on all four emulated UI target classes |
| Account | session, capability, username, service-state contracts | signed-out/unavailable state, WCAG, overflow | `/account` on all four emulated UI target classes |
| Compatibility | canonical and reversible Trove assertions | redirect/canonical/no runtime errors | `/trove` on all four emulated UI target classes |
| System/404 | shared recovery state and static-export output | no runtime errors, WCAG, overflow | real 404 surface on all four emulated UI target classes |
| Discovery and SEO | exact sitemap/robots, canonical social metadata, sanitized Organization/WebSite/SoftwareApplication/Breadcrumb JSON-LD | public-route metadata and noindex exclusions | Home, Apps, product details, Discover, Trove |
| Media performance | responsive storefront derivatives, optimized route-JavaScript budget, `preload=none`, no MP4 before interaction, one-product range-request isolation | detail-route trailer start plus response header assertions | Home, Apps, and product detail routes in Chromium and WebKit |
| Runtime/security | Node, Actions, Docker, HTTP-header contracts | Lifeline smoke | source receipt captures exact tree/run |
| Deployment binding | missing/malformed/wrong/correct workspace bindings, clean exact-main source, CI and provider identity guards | production smoke and log verification run only after separate release authority | production receipt binds source, project, deployment, aliases, smoke, and rollback |
| Style ownership | ordered import and file-owner assertions | full cross-family regression matrix | contact sheet makes visual review portable |

Test-count changes must be explained in the PR and receipt by the new or removed
behavioral denominator. A green total without a contract delta is not sufficient
release evidence.
