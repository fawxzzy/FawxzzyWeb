# Fawxzzy Legal Center

Status: versioned source contract for the public Fawxzzy and Mazer policies.

## Canonical routes

- Platform Privacy Policy: `https://fawxzzy.com/privacy`
- Platform Terms of Service: `https://fawxzzy.com/terms`
- Mazer Privacy Policy: `https://fawxzzy.com/legal/mazer/privacy`
- Mazer Terms of Service: `https://fawxzzy.com/legal/mazer/terms`

All four documents use the registry in `src/config/legal.ts`, one document component, a visible title, an exact version, and an exact last-updated date. The public sitemap includes each canonical route.

Website account screens link to the platform documents. Mazer account and consent screens link to the Mazer documents. Fitness continues to link to its app-owned `/privacy` and `/terms` routes.

Unknown or duplicate account contexts fail closed to the Website presentation and platform legal links; they never select product-specific documents or Auth authority.

## Current-truth boundary

The Mazer documents describe the current local-first game, optional supported remote sync, compact progression and cycle summaries, and the shared Fawxzzy account. They make no current claim about paid features, subscriptions, refunds, virtual currency, or purchases.

Before any Mazer monetization is enabled:

1. Update the stable Privacy Policy and Terms with the relevant payment, license, renewal, cancellation, refund, processor, tax, geography, and virtual-item rules.
2. Display visible links to the effective policies in checkout.
3. Require affirmative acceptance of the applicable terms before purchase submission.
4. Verify the published policy version and checkout behavior before production activation.

This future gate is a design and release requirement. It grants no payment, provider, deployment, or production authority.
