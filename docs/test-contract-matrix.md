# Test contract matrix

| Surface or contract | Deterministic source/build proof | Browser proof | Portable evidence |
| --- | --- | --- | --- |
| Apps catalog | centralized catalog/media, direct-origin, install-guide, and compatibility-redirect assertions | current previews, direct launch links, WCAG, focus, overflow | `/apps` on all four emulated UI target classes |
| Root and Discover compatibility | redirect config (`/` and `/discover` to Apps), root fallback smoke, shared nav/footer link assertions | `/` continues to Apps, lightweight Discover fallback, no Home or social-profile surface, WCAG, overflow | `/discover` on all four emulated UI target classes |
| Utility/Auth | origin, return, PKCE, password, error, cooldown contracts | Login/confirm/callback/reset states, WCAG, errors | four Auth routes on all four emulated UI target classes |
| Account | session, capability, username, service-state contracts; portal copy length cap (70 characters per message, `npm run test:account-copy`) | signed-out/unavailable state, WCAG, overflow | `/account` on all four emulated UI target classes |
| Projects (owner-only) | owner endpoint guard/auth/owner match, owner snapshot, adapter, data-free static shell, canonical/noindex metadata | signed-out, other-account, outage and owner states; tab only for the verified owner; no request when signed out; main site shows only a sign-in link | `/projects` and the nav on `/apps` |
| Compatibility | canonical and reversible Trove assertions | redirect/canonical/no runtime errors | `/trove` on all four emulated UI target classes |
| System/404 | shared recovery state and static-export output | no runtime errors, WCAG, overflow | real 404 surface on all four emulated UI target classes |
| Discovery and SEO | exact sitemap/robots, canonical social metadata, sanitized Organization/WebSite/SoftwareApplication/ItemList JSON-LD | public-route metadata and noindex exclusions | Apps, Discover, Trove |
| Media performance | responsive storefront derivatives and optimized route-JavaScript budget | current preview delivery without active trailer payloads | Apps in Chromium and WebKit |
| Runtime/security | Node, Actions, Docker, HTTP-header contracts | Lifeline smoke | source receipt captures exact tree/run |
| Deployment binding | missing/malformed/wrong/correct workspace bindings, clean exact-main source, CI and provider identity guards | production smoke and log verification run only after separate release authority | production receipt binds source, project, deployment, aliases, smoke, and rollback |
| Style ownership | ordered import and file-owner assertions | full cross-family regression matrix | contact sheet makes visual review portable |
| Auth email | Standard Webhooks signature, per-app theme parity with the portal tokens, every action type, escaping, contrast, link construction against the real confirm/reset route logic, mocked Resend sends, `verify_jwt = false` (`npm run test:auth-email`) | none (hermetic; preview via `npm run email:preview`) | none |

Test-count changes must be explained in the PR and receipt by the new or removed
behavioral denominator. A green total without a contract delta is not sufficient
release evidence.
