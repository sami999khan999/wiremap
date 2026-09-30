---
title: CapabilityCache
description: Sixty seconds, and no longer — the TTL is a revocation window rather than a performance dial. Plus why the key carries the organization, and why it carries it in that position.
---

# `CapabilityCache`

`CapabilityRepository.resolveFor()` is four queries: role permissions, goal memberships, per-user
overrides, and the org's entitlement, which masks the other three. It runs on essentially every request. Fine at ten users, not at five hundred.
This class is the read-through in front of it.

## The TTL is a revocation window

```ts
private static readonly TTL_SECONDS = 60;
```

**Sixty seconds is the number this system answers for when someone asks why removed access still
worked.** It is not a cache-hit-rate dial, and raising it because the hit rate looks better trades a
security window for a metric.

**An expiry lands within the same window, and nothing fires at the moment itself.** A per-user
grant or an entitlement trial is read only while it is live: `explainFor` and `entitlementFor`
filter out a row past its `expires_at`. Nothing flushes the cache at that instant, so a set
resolved just before a grant lapses can serve it for up to sixty more seconds. The nightly sweep
removes and audits the row, and flushes the person or the org, but by then the row has granted
nothing for hours. The filter is the mechanism; the sweep is housekeeping.

The same ceiling applies to `AUTH_COOKIE_CACHE_MAX_AGE_SECONDS`, which is capped at 60 in the
`env.ts` schema rather than by convention — a deploy that raises it fails at boot instead of quietly
widening the gap between removing access and access stopping.

**The TTL is the backstop, not the mechanism.** The mechanism is `invalidate()`, called on every RBAC
write:

| Change | Call |
|---|---|
| Role permissions edited | `invalidateOrganization(organizationId)` |
| Membership's role changed | `invalidate(organizationId, userId)` |
| Membership added or removed | `invalidate(organizationId, userId)` |
| Per-user override written | `invalidate(organizationId, userId)` |
| Membership deactivated or reactivated | `invalidate(organizationId, userId)` — `CR.2` |
| Any of the above **in the platform tier** | the same call, plus `invalidatePlatform()` |

The domain does not name this class. `CreateRoleUseCase` and its four siblings take a
`CapabilityInvalidator` port from `application/src/port/`, and `Container` is the one line that binds
this to it — the same shape as every other adapter.

**The call goes after the commit, never inside it.** A flush issued while the old row is still the
committed one lets a concurrent read resolve the stale set and put it straight back, which is the
same bug the flush exists to prevent, now with a race attached.

**After the commit is not quite enough, so every flush happens twice** (`CR.9`). A read-through
that ran its query *before* the commit and reaches its `SET` *after* the flush writes the revoked
set back, and it is served for the rest of the minute. Each invalidation repeats itself two seconds
later — longer than any read-through takes, since that is one indexed query, and far shorter than
the TTL. The repeat is a timer that holds no process open and swallows its own failure: the TTL is
still the backstop. A generation counter compared on every read would close the window exactly,
at the price of a second Redis round trip on every request; this closes it for a timer.

Getting this wrong in the stale direction means a revoked permission keeps working, which is a
security bug wearing a caching bug's clothes. The TTL exists so that a forgotten call site costs a
minute rather than a session lifetime.

## Which write flushes what

Every write that changes what someone may do calls exactly one of these, after its commit.

| Write | Call | Why that wide |
|---|---|---|
| A per-user override, a membership's role or active state | `invalidate(org, user)` | One person's set changed |
| A role's grants, a role deleted | `invalidateOrganization(org)` | Everyone holding the role changed, and they are not enumerated |
| An org moved to a plan, an adjustment added, cleared or expired | `invalidateOrganization(org)` | The org's mask changed |
| A plan edited or deleted | `invalidateAll()` | Every org on the plan changed, and they are not enumerated |
| A module switched off or on | `invalidateAll()` | The kill switch masks every org |
| Anything in the platform tier | the platform prefix too | Added by this class, never by a use-case |

`invalidateAll()` is one `deletePrefix` over `capability:user:`, repeated after two seconds like the
rest. It leaves `capability:platform:` alone, because no plan reaches the platform axis. It is rare
(a plan edit, an incident), and a flushed entry costs one resolution to rebuild. Either way, that is
cheaper than enumerating a plan's orgs to flush them one at a time.

**No version stamp, on purpose.** Keying every entry on a plan or org version would make a plan
edit invalidate by construction. But each request would then read the version before the entry,
which is the second Redis round trip the section above already declined. The stamp would buy exact
invalidation for writes that happen a few times a month, and charge for it on every request. The
flush, repeated, costs nothing until something changes.

## The third axis has its own prefix, and the adapter decides when to flush it

`platformFor(userId)` caches under `capability:platform:<userId>` — no organization in the key,
because the answer does not change with whichever tenant the session is pointed at. A platform
admin switched into a customer tenant is still a platform admin.

That makes flushing a question the use-cases cannot answer: `invalidateOrganization(id)` knows a
tenant changed, and only this class knows whether that tenant *is* the tier. So both invalidation
methods read `PlatformReader.organizationId()` and, on a match, also `deletePrefix` the platform
namespace. The rule lands in one place instead of in four use-cases that each have to remember it,
and a role edit in a customer tenant provably cannot change a platform grant.

The flush is every user at once, which is right and is cheap: the tier has a handful of members,
and the entries for everyone else are empty sets that cost one query to rebuild.

## The key carries the organization, and its position matters

```ts
`${CapabilityCache.PREFIX}${organizationId}:${userId}`
//  capability:user:        <org>            <user>
```

**The organization has to be in the key.** A user who belongs to two organizations would otherwise
get whichever capability set was cached first — a cross-tenant privilege bug with a one-minute fuse
and no error anywhere. It is the kind of bug that never reproduces on a single-tenant dev database.

**And it has to be in that position.** `invalidateOrganization()` is a `deletePrefix` on
`capability:user:<org>:`, so an organization segment placed *before* the fixed part would put the
tenant's entries out of that flush's reach — and one placed *after* the user id would make the flush
unable to name a tenant at all. A role edit affects everyone holding the role, and enumerating them
is more expensive and more forgettable than flushing.

## `invalidateOrganization()` is a flush, not a scan

`RedisCacheStore.deletePrefix` uses `SCAN` plus `UNLINK`, and it has a trap documented in
[15](../../../../docs/setup/15-infrastructure-package.md): ioredis applies `keyPrefix` to key
arguments but **not** to `SCAN` results, so passing them straight back to `unlink` prefixes them a
second time — and `UNLINK` on a key that does not exist is not an error. The prune reports success
and deletes nothing. The prefix is stripped before the delete for exactly that reason.

## Tested behaviours

`tests/principal/capability.cache.spec.ts` pins the key layout directly rather than through
behaviour, because the layout *is* the behaviour: one assertion on
`capability:user:<org>:<user>`, one that the same user in two tenants gets two answers and two
repository calls, and one that `invalidateOrganization()` takes the named tenant's entries and
leaves both the other tenant's and unrelated keys alone. `invalidateAll()` has its own case: every
tenant's entry goes, and the platform entry stays.
