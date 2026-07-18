# Future public app reviews contract

Status: design contract only; no database, authentication, API, environment, or production
configuration is implemented by this packet.

## Boundary and ownership

Fitness and Mazer own the in-app review prompts and the product context attached to a submission.
The governed Fawxzzy platform owns durable review intake, identity boundaries, moderation, privacy,
aggregates, and the public read model. FawxzzyWeb is a read-only consumer of that published model.

FawxzzyWeb must never write reviews directly to a shared database, expose a service credential, or
infer review truth from an owner app's private runtime. A platform owner lease and a separately
reviewed interface are required before implementation.

## Intake contract

Each accepted review event must carry:

- a platform-issued immutable review ID;
- an app ID from the canonical product registry and the submitting app version;
- a server-validated actor or eligibility reference that is not a public email or raw account ID;
- an idempotency key scoped to the actor, app, and submission attempt;
- the rating, optional review body, locale, and server receipt time;
- the moderation state and a revision number.

Retries with the same idempotency key must return the original result. Editing, withdrawal, account
deletion, moderation changes, and appeals create revisions or tombstones; they do not silently
replace historical state.

## Moderation and privacy

Reviews are private-by-default until the governed moderation policy admits them to the public read
model. The platform contract must define spam and abuse handling, prohibited personal information,
reporting, moderator attribution, appeal, deletion, and legal-retention behavior.

Public reviewer identity is an explicit display choice. The public model must not expose raw account
IDs, email addresses, IP addresses, authentication claims, or unmoderated text. A review may be
shown as verified only when the platform has a durable, auditable eligibility signal.

## Public read model

The public interface is read-only and versioned. Every response includes an `asOf` timestamp,
contract version, app ID, and freshness state. FawxzzyWeb renders `UNKNOWN` or temporarily hides the
review module when the model is unavailable, too stale, or incompatible; it never converts missing
data into zero reviews or a zero rating.

Review lists use opaque cursor pagination with a deterministic order and stable tie-breaker. The
contract defines maximum page size, cursor expiry, deleted-item behavior, and whether moderation
changes may move items between pages.

## Rating and aggregate semantics

Before public display, the platform owner must freeze:

- the allowed rating scale and whether partial ratings exist;
- which moderation states contribute to an aggregate;
- minimum eligible-review thresholds;
- rounding and display precision;
- whether weighting or Bayesian smoothing is used;
- the treatment of edited, withdrawn, deleted, and suspected-abuse reviews;
- the exact meaning of review count versus rating count.

FawxzzyWeb displays only the supplied aggregate and its `asOf` time. It does not recompute or blend
ratings in the browser.

## Failure, rollback, and observability

The public reviews module requires a kill switch and a last-known-good, time-bounded read response.
If the interface fails validation, leaks a disallowed field, or exceeds its freshness budget, the
module fails closed without affecting app-detail navigation or launch links.

Correlated intake, moderation, projection, and public-read receipts must make one review traceable
without logging review bodies or private actor data. Rollback restores the prior contract version or
hides the module; it never writes from FawxzzyWeb into source review records.

## Admission gate

Implementation remains blocked until the platform owner issues an explicit database/auth migration
lease and approves the versioned intake and read-model schemas. Fitness and Mazer then adopt intake
through their separate owner lanes. FawxzzyWeb adopts only the approved public read interface in a
later bounded packet.
