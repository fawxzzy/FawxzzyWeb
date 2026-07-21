# Test contract matrix

| Surface or contract | Deterministic source/build proof | Browser proof | Portable evidence |
| --- | --- | --- | --- |
| Marketing Home | site smoke, optimized build | Chromium + mobile WebKit, WCAG, focus, overflow, runtime errors | `/` at 1440×900 and 390×844 |
| Apps catalog | centralized catalog/media assertions | trailer isolation/playback, WCAG, focus, overflow | `/apps` in both engines |
| Fitness and Mazer detail | centralized origins and media hashes | trailer playback/retry, metadata, WCAG | both `/apps/<slug>` routes |
| Editorial | truthful Discover/Newsletter assertions | hierarchy, links, WCAG, overflow | `/discover` and `/newsletter` |
| Utility/Auth | origin, return, PKCE, password, error, cooldown contracts | Login/confirm/callback/reset states, WCAG, errors | four Auth routes in both engines |
| Account | session, capability, username, service-state contracts | signed-out/unavailable state, WCAG, overflow | `/account` in both engines |
| Compatibility | canonical and reversible Trove assertions | redirect/canonical/no runtime errors | `/trove` in both engines |
| Discovery and SEO | exact sitemap/robots, canonical social metadata, sanitized Organization/WebSite/SoftwareApplication/Breadcrumb JSON-LD | public-route metadata and noindex exclusions | Home, Apps, product details, Discover, Newsletter, Trove |
| Media performance | optimized route-JavaScript budget, `preload=none`, no MP4 before interaction, one-product range-request isolation | real trailer start plus response header assertions | `/apps` in Chromium and mobile WebKit |
| Runtime/security | Node, Actions, Docker, HTTP-header contracts | Lifeline smoke | source receipt captures exact tree/run |
| Deployment binding | missing/malformed/wrong/correct workspace bindings, clean exact-main source, CI and provider identity guards | production smoke and log verification run only after separate release authority | production receipt binds source, project, deployment, aliases, smoke, and rollback |
| Style ownership | ordered import and file-owner assertions | full cross-family regression matrix | contact sheet makes visual review portable |

Test-count changes must be explained in the PR and receipt by the new or removed
behavioral denominator. A green total without a contract delta is not sufficient
release evidence.
