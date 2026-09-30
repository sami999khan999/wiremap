---
title: widget-registry
description: WidgetRegistry — the zones, the widgets registered to them, the six-word visibility answer, and why the whole thing is data with no React.
---

# `WidgetRegistry`

A dashboard card can be missing because a flag is off, because the person's role lacks its
permission, or because someone hid it. The registry holds every such unit in one table, and
`visibilityOf` gives the one answer to "why is it gone".

```ts
WidgetRegistry.instance.visibilityOf("member.count", {
  capabilities,               // already masked by the org's plan
  flags,                      // the on-set for this org
  hiddenByAdmin, hiddenByUser,
});
// "visible" | "hidden-by-flag" | "denied" | "hidden-by-admin" | "hidden-by-user" | "unregistered"
```

It is pure data, with no React. That means a zone resolves during SSR, and a spec can say what a
role sees without rendering anything.

## The declaration

```ts
export const memberWidgets = {
  "member.count": {
    zone: "dashboard.main",
    permission: "member.read",
    policy: "dismissible",
    order: 20,
  },
} as const satisfies Record<string, WidgetMeta>;
```

- **`permission` is required, `null` included.** An ungated widget says so, instead of forgetting.
  It is never a prop, so the inspector knows what a widget needs without rendering it.
- **`policy` defaults to `required`.** `dismissible` means a user may hide it and an org admin may
  hide it for everyone.
- **An inline widget has no `zone`, and its `policy` can only be `required`.** Preferences are loaded
  by the route that owns a zone. An inline widget has no zone, so there is nothing to load them.
  The type refuses the combination.

## The order, broadest cause first

Unregistered, then the flag, then the permission, then the admin's preference, then the user's.
The first that hides it is the answer. A user who hid a card their role no longer grants is told
`denied`, because restoring it would change nothing. A required widget ignores both preferences, so
a stale row can never hide the nav.

Entitlement is not a step here. It has already narrowed `capabilities` on the server, so a widget
behind an un-entitled key simply reads `denied`.

## Zones

```ts
ZONES; // ["dashboard.main"]
```

A zone key is `<page>.<region>`. There is one zone, so there is no zone folder and no zone metadata.
A tuple is the whole declaration. `forZone` returns its widgets sorted by `order`, required and
dismissible together. `ZoneWidgetKey<"dashboard.main">` is the union a zone's component map is
typed against, so a map missing a widget, or naming another zone's, does not compile.

## The nav is required, and the spec says why

Hiding is not revoking. The API still answers, a bookmark still opens, and the nav still reaches the
module. The nav is the last path to every capability, so it is `required` and never hideable. A spec
asserts that every dismissible widget's permission belongs to a module some nav gate opens. The join
is on the permission's module, not the gate's key, because the `document` gate asks for
`ai.embedding.read`.
