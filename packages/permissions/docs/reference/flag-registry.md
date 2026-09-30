---
title: flag-registry
description: FlagRegistry — flags declared in code with an owner and an expiry, switched in Postgres, none declared in lite, and a client-gating set that is empty until widgets are ported back.
---

# `FlagRegistry`

A flag is a rollout. It turns something on for the deployment or for a list of orgs while it is
being finished, and then it is deleted. The failure it invites is the flag nobody deletes, which
becomes a permanent `if` that nobody remembers the reason for. So every flag is declared in code
with the three facts that make deleting it someone's job:

```ts
export const taskFlags = {
  "task.bulk-edit": {
    owner: "sami",
    expiresOn: "2027-03-31",
    description: "Lets a member edit several tasks at once, …",
  },
} as const satisfies Record<string, FlagMeta>;
```

That fragment is an example. Lite declares no flags: `FLAGS` in `src/flag/index.ts` is `{}`, and a
fragment is spread into it when a rollout needs one.

The declaration says a flag exists. Whether it is **on** lives in Postgres, for the deployment or
per org, and a missing row means off.

## The key

`<slice>.<change>`, where the change is a kebab noun: `task.bulk-edit`. It names what is changing,
not what it guards, because the flag is gone once the change has shipped.

## Client-gating is empty in lite

```ts
FlagRegistry.instance.clientGating(); // [] in lite
```

Only these reach the session payload. In the big kit the set is built at module load from the
widgets that name a flag, never written by hand. A hand-written list is a list someone forgets to
update, and forgetting in one direction sends a server-only flag's name to every browser.

Lite has no widgets, so `CLIENT_GATING` is an empty set and every flag stays server-only. Porting
widgets back is what fills it ([`docs/scale/widgets.md`](../../../../docs/scale/widgets.md)).

A flag's name is still not a secret. Once a flag gates something in the browser, its name is in
the bundle. **A flag decides when something ships, not who may know it exists.** That is also why
a flag check answers `NOT_FOUND` and its error carries no key.

## `meta` answers `undefined` for a flag it does not know

The same rule as `PermissionRegistry.meta`, for a different reason. A database row can outlive the
flag it names, because retiring a flag deletes the declaration first. The platform's flag list
shows such a row as orphaned instead of failing to render.

## What CI holds it to

`check-architecture.mjs` fails a flag past its `expiresOn`, or one no `src/` file outside `flag/`
reads. With zero flags it passes, because a deployment with nothing rolling out is the normal state.
