---
title: flag-registry
description: FlagRegistry — flags declared in code with an owner and an expiry, switched in Postgres, and the client-gating set derived from widgets rather than declared.
---

# `FlagRegistry`

A flag is a rollout. It turns something on for the deployment or for a list of orgs while it is
being finished, and then it is deleted. The failure it invites is the flag nobody deletes, which
becomes a permanent `if` that nobody remembers the reason for. So every flag is declared in code
with the three facts that make deleting it someone's job:

```ts
export const widgetFlags = {
  "widget.dismissal": {
    owner: "sami",
    expiresOn: "2027-03-31",
    description: "Lets a user hide a dismissible dashboard card, …",
  },
} as const satisfies Record<string, FlagMeta>;
```

The declaration says a flag exists. Whether it is **on** lives in Postgres, for the deployment or
per org, and a missing row means off.

## The key

`<slice>.<change>`, where the change is a kebab noun: `widget.dismissal`. It names what is changing,
not what it guards, because the flag is gone once the change has shipped.

## Client-gating is derived

```ts
FlagRegistry.instance.clientGating(); // the flags some widget names
```

Only these reach the session payload. The set is built at module load from `WIDGETS`, never written
by hand. A hand-written list is a list someone forgets to update, and forgetting in one direction
sends a server-only flag's name to every browser.

A flag's name is still not a secret. Every client-gating name is in the bundle, because the widget
that names it is. **A flag decides when something ships, not who may know it exists.** That is also
why a flag check answers `NOT_FOUND` and its error carries no key.

## `meta` answers `undefined` for a flag it does not know

The same rule as `PermissionRegistry.meta`, for a different reason. A database row can outlive the
flag it names, because retiring a flag deletes the declaration first. The platform's flag list
shows such a row as orphaned instead of failing to render.

## What CI holds it to

`check-architecture.mjs` fails a flag past its `expiresOn`, or one no `src/` file outside `flag/`
reads. With zero flags it passes, because a deployment with nothing rolling out is the normal state.
