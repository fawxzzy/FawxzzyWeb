# Public project-board source boundary

`/projects` provides the four requested display boards: Fitness, Mazer, Fawxzzy Web, and Atlas Stack. The committed JSON is an empty, dated placeholder with `publicationReady: false`. It contains no actual card, lifecycle, owner, dependency, or result record. The page says that approved card content and live synchronization are pending and is excluded from search indexing.

`src/data/project-board-adapter.mjs` is a local source seam for a future authorized public projection. It validates exact board and card fields, source identity, revisions, generation time, publication readiness, and health. A validated healthy nonempty snapshot can be supplied to the renderer by an eventual approved caller. Exact repeats are idempotent. Forked or backdated revisions show last accepted data as non-authoritative. Invalid, incompatible, and unavailable responses expose no cards. The empty placeholder is accepted only as an unapproved initial preview; it cannot become a healthy public projection.

The repository has no public projection transport, polling loop, board writer, reverse editor, or database client for this view. The adapter's envelope is not an adopted platform API. Test-only synthetic cards exercise status changes, relationships, privacy rejection, and detail selection; they are not current project work. Actual public fields and prose require their owners' approval before entering repository source. Private operator records stay with their canonical writer and must not be serialized into the public website.

Source publication, deployment, and a real authorized card's automatic source-to-page/result-return acceptance are separate gates. The current source establishes the UI and validation behavior only.
