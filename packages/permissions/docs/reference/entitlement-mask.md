---
title: entitlement-mask
description: EntitlementMask — what an org's plan allows, as a filter over role grants rather than a deletion of them, and the four rules for which key survives.
---

# `EntitlementMask`

An org's roles say what each person may do. Its plan says what the org has paid for. When the plan
shrinks, the roles do not change. The org admin set them, and an upgrade next month should bring them
back exactly as they were. So entitlement is a **mask**: it filters the grants a principal holds
before `CapabilitySet.from` ever sees them, and it deletes nothing.

```ts
const mask = EntitlementMask.from({
  plan: ["member.read", "member.invite"], // or "all"
  added: ["ai.embedding.read"],           // a trial is an expiring add
  removed: [],
  disabledModules: [],                    // the deployment-wide kill switch
});

CapabilitySet.from(mask.narrow(resolved.toJSON()));
```

## Which key survives

The rules are checked in this order, and the first that applies decides.

| # | Rule | Why |
|---|---|---|
| 1 | A `core`-module key or a `platform`-scope key is always entitled | Everyone holds a core key, and no tenant plan can reach a platform one |
| 2 | A key in a disabled module is not | The kill switch is for an incident, and nothing an org bought outranks it |
| 3 | A removed key is not | A removal is an explicit "not this org", so it beats the plan and an add |
| 4 | An added key is | An add widens the plan for one org, with an expiry for a trial |
| 5 | Otherwise, whatever the plan says | `"all"` answers yes to everything |

**`"all"` is resolved at the question, never listed.** The unlimited plan is a property of the plan
row, not a set of `plan_permissions` rows. Rows would have to be reconciled on every deploy that
adds a key, and a deploy that skipped it would hide the new key from every tenant. The spec pins
this with a key the catalog has never declared.

## What `narrow` touches

**Grants only**, at the org and in every goal. Everything else passes through:

- **Denies.** A mask that dropped a deny would *widen* access. That is the one direction a filter
  must never move.
- **The platform axis.** No plan reaches it.
- **`wildcard`.** Nothing in production sets it (see [the platform scope](platform-scope.md)). A set
  that had it would pass through unmasked, which is one more reason it stays `false`.

## What it does not do

**It does not read the database.** The four inputs arrive already resolved. Where they come from
(plans, adjustments with their expiry, disabled modules) is the capability repository's job, and it
reads them in one statement.

**It does not close over `requires`.** A plan is stored already closed both ways, so the mask trusts
it. Closing on write is `PermissionRegistry.closure` and `dependentClosure`; see
[permission-registry](permission-registry.md#requires-and-its-mirror).
