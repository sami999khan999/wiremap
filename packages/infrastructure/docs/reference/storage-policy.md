---
title: The bucket's lifecycle policy
description: Why a second gateway rather than a method on StorageGateway, why "no configuration" is an error code rather than an empty list, and why the app owns the whole configuration rather than one rule of it.
---

# `S3StoragePolicyGateway`

`StorageGateway` moves objects. This moves the **bucket's own policy**: the lifecycle rules that say
how long an object lives in S3 before the bucket deletes it. Lite writes one rule: objects under
`export/` expire after seven days.

## Why it is a second port

`StorageGateway`'s header says "no bucket, no region, no endpoint — those are adapter
configuration". A lifecycle rule is exactly those things: it names a bucket, it is not about any
object, and no use-case that stores a file has any business reaching it.

So the seam is drawn where the subject changes rather than where the vendor does. Two gateways over
one S3 client, and the container builds both from the same `S3Config`.

## The application owns the configuration, not a rule of it

`PutBucketLifecycleConfiguration` **replaces every rule on the bucket**. There is no per-rule
write, and there is no merge — S3 offers neither.

That decides the shape of everything above it:

- `RetentionRules.lifecycleFor()` composes the **whole** configuration. In lite that is the one
  `export/` rule; the big kit adds a rule per retained table here.
- The rules are **sorted by prefix**, so two runs compare equal. Without that, the daily job would
  see a difference whenever the order changed and rewrite the bucket for nothing.
- An empty list **deletes** the configuration, with `DeleteBucketLifecycle` rather than a `Put` of
  zero rules — S3 and MinIO both answer `InvalidArgument` to that. Lite never sends one, since it
  always composes the `export/` rule.

## The `export/` rule

`export/` is a flat rule at seven days, present whether or not anyone has ever exported a tenant,
because a lifecycle rule has to exist before the objects it governs do. A fresh deployment's first
`retention` run applies it, and every run after that applies nothing — the job converges, then
stops.

It is flat rather than per tenant because **a bucket takes at most a thousand lifecycle rules**,
and one per customer is a ceiling with a date on it.

`cold/` has no rule. A deleted tenant's archive is removed by the nightly sweep after thirty days —
see [Cold storage](cold-storage.md).

## "No configuration" is an error, and treating it as one would never converge

A bucket that has never had a lifecycle configuration answers `GetBucketLifecycleConfiguration`
with **`NoSuchLifecycleConfiguration`**, not with an empty rule list. Letting that propagate is the
failure worth naming: the daily reconcile would read a failure, apply nothing, report drift, and do
the same thing again tomorrow, forever, on the one deployment shape where it most needs to work —
a fresh bucket.

So `lifecycle()` catches that one code and answers `[]`. The code is read off `name` for an error
the SDK models and off `Code` for one it only saw on the wire, because the AWS SDK surfaces it in
both places depending on which.

**MinIO answers with the same code**, which is what makes the local compose stack a real test of
this path rather than a rehearsal of it.

## A rule the app did not write is reported as absent

`lifecycle()` drops any rule with no prefix filter, and any whose expiry is a *date* rather than a
span of days. Both are legal S3 and neither is anything this system writes. A transition is
ignored: lite writes and compares none.

Reporting them as absent rather than as rules means the next `applyLifecycle` removes them — which
is correct: the bucket's configuration is derived from `RetentionRules`, and a rule it did not
compose is drift by definition. A deployment that wants a hand-written rule on this bucket needs to
add it to `RetentionRules`, or use a different bucket.

## What is not here

**Per-table retention and a colder storage class.** The big kit composes a `cold/<table>/` rule per
retention row, with an optional transition to a cheaper class. Both left with calendar retention;
bringing them back is [Retention](../../../../docs/scale/retention.md).

**Per-tenant expiry.** Lifecycle rules match a prefix and are capped at 1,000 per bucket, so a rule
per tenant is not available at any tenant count worth having.
