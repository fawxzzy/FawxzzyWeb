# Discovery metadata and performance contract

FawxzzyWeb exposes one intentional public discovery surface without inventing
articles, ratings, offers, download packages, or product-domain cutovers.

## Indexing contract

The generated sitemap contains only the canonical public hub, catalog, Fitness
and Mazer details, Discover, and Newsletter. Account/Auth routes and the Trove
compatibility route are excluded. `robots.txt` allows the public site, points to
the canonical sitemap, and explicitly disallows those private or compatibility
surfaces. Route-level `noindex` metadata remains defense in depth for Trove and
the account family.

Every indexable route carries an intentional title, description, canonical URL,
Open Graph record, and large-image Twitter record. The current approved Fawxzzy
banner is the shared social image; product pages use their governed interaction
poster. No unpublished newsletter issue is represented as an Article.

The Home page emits sanitized Organization and WebSite JSON-LD. Product detail
pages emit sanitized SoftwareApplication and BreadcrumbList JSON-LD derived from
the typed catalog. They deliberately omit offers, prices, reviews, rating counts,
usage metrics, and unsupported platform claims.

## Measured baseline

`performance-baseline.json` records two distinct observations:

- public production deployment `dpl_BUsjRvDPpBqqtMoZyupdeFcPp7VM`, commit
  `9d892a73fb8fc6df7440a18c4b8ea71064604a15`;
- optimized source-main static export at commit
  `3ade2ce0c5c73b0f29aac598f44aa0f112f0af32`.

Production Chromium observed zero CLS and zero pre-interaction MP4 requests on
Home and Apps. LCP and transferred-byte values are observations, not laboratory
guarantees; CI records them on every exact head so change can be reviewed. The
deterministic gate sums the uncompressed JavaScript assets referenced by the
optimized Home and Apps HTML and permits at most ten-percent growth over the
measured source baseline.

## Media isolation

All catalog videos retain `preload="none"`, and their MP4 source is not bound
until the explicit play action. The missing source is the deterministic boundary;
`preload` alone is only a browser hint and did not prevent CI WebKit from loading
both files. Portable evidence fails if any MP4 is requested before interaction.
Browser tests open a fresh Apps page for each
product, prove the initial request set contains no MP4, start one trailer, require
real playback, keep the sibling paused at time zero, and require a byte-range
video response. Chromium additionally proves the exact page-request set contains
only the selected trailer. Playwright's WebKit transport does not expose native
media loads through the page request event, so mobile WebKit acceptance is bound
to real advancing playback, sibling state isolation, and the independent 206
delivery probe instead of a false network-event assertion. This is source and
delivery proof; it does not weaken real playback coverage.

## Governance

This lane adds no analytics, tracking, cookies, product-origin cutover, review
data, newsletter data, provider mutation, or production deployment. Performance
threshold changes require a newly measured baseline and an explicit receipt;
raising a limit to silence a regression is not an accepted fix.
