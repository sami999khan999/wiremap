---
title: routes
description: ROUTES — one human-readable table of destinations, why a generated route tree cannot be the source, and how web, desktop, and the Nest API each resolve against it.
---

# `ROUTES`

One table of every destination the product has, grouped by slice, hand-written and meant to be read.
`GATES` points into it, every shell links against it, and the Nest API prefixes it with an origin to
build deep links.

```ts
export type RoutePath = `/${string}`;

export const ROUTES: {
  readonly shell: { readonly home: "/"; readonly signIn: "/sign-in"; readonly forbidden: "/forbidden" };
  readonly rbac: { readonly roles: "/settings/roles"; readonly members: "/settings/members" };
};

export type AppRoute = "/" | "/sign-in" | "/forbidden" | "/settings/roles" | "/settings/members";
```

```ts
ROUTES.rbac.roles;                             // "/settings/roles"
ModuleRegistry.instance.gate("rbac").route;    // "/settings/roles" — the same literal
```

---

## Why a generated route tree is not the source

The obvious alternative is to derive paths from the router — `RoutePaths<typeof routeTree>` under
TanStack Router, or `Route` under Next with `typedRoutes`. That fails for two reasons.

**It does not exist in three of the four runtimes.** A Nest process has no route tree at all, and the
web, desktop, and Next shells each generate a *different* one. A generated type can check one shell;
it cannot be the thing all of them agree on.

**Nobody reads it.** `routeTree.gen.ts` is codegen output. The question "what screens does this
product have" should be answerable by opening one file.

So the table is the source, and a generated tree is only ever useful as a *checker* — see
[the shell assertion](#verifying-a-shell-actually-has-these-routes) below.

---

## Fragments, one per slice

The layout mirrors `catalog/` and `gate/` exactly, for the same reason: one team edits one file, and
the platform-owned barrel gains one line per slice.

```
src/route/
├── index.ts             ← merges fragments, declares RoutePath and AppRoute
├── shell.routes.ts      ← platform-owned: home, sign-in, forbidden
└── rbac.routes.ts       ← team-owned
```

```ts
// rbac.routes.ts
import type { RoutePath } from "./index.js";

export const rbacRoutes = {
  roles: "/settings/roles",
  members: "/settings/members",
} as const satisfies Record<string, RoutePath>;
```

`shell.routes.ts` is the one fragment that is not a slice — it holds destinations belonging to no
feature, and a feature team has no reason to open it.

The same paper cycle as the catalog applies: the fragment imports `RoutePath` from the barrel that
imports it back. The fragment's import is `import type`, so nothing survives to run.

---

## Two things that fail to compile

**A gate pointing at a path the table does not declare.** `ModuleGate.route` is `AppRoute`, not
`string` — verified:

```ts
rbac: { permission: "rbac.role.read", route: "/settings/rolez" },
// TS2820: Type '"/settings/rolez"' is not assignable to type 'AppRoute'.
//         Did you mean '"/settings/roles"'?
```

**A path declared without a leading slash** — that is what `RoutePath` buys, and also verified:

```ts
roles: "settings/roles",
// TS2322: Type '"settings/roles"' is not assignable to type '`/${string}`'.
```

---

## How each runtime resolves against it

| Runtime | Needs | Resolves as |
| --- | --- | --- |
| `apps/web` | internal paths | `ROUTES.rbac.roles` directly |
| `apps/desktop` (Tauri) | internal paths | the same, unless its tree diverges |
| `apps/api` (NestJS) | **absolute URLs** | `` `${PUBLIC_WEB_URL}${ROUTES.rbac.roles}` `` |

**Nest is not a shell.** It never navigates — it generates deep links for emails, notifications, and
OAuth redirects, and those always point at the web app rather than at the API. So it takes no route
table of its own, only an origin:

```ts
export class DeepLink {
  public constructor(private readonly baseUrl: string) {}

  public roles(): string {
    return `${this.baseUrl}${ROUTES.rbac.roles}`;
  }
}
```

**Tauri changes history mode, not path strings.** [30](../../../../docs/setup/30-desktop-app.md) has
the desktop app owning its own route tree, but that is about hash or memory history and its own route
files — nothing forces `/settings/roles` to be spelled differently inside the webview. Keeping the
paths identical is worth treating as an invariant: it is what lets a `<Link>` inside a `feature`
component be correct in both shells with no branching.

If a screen genuinely has to live elsewhere on desktop, override only the keys that differ:

```ts
// apps/desktop/src/routes.ts
export const DESKTOP_ROUTES = {
  ...ROUTES,
  rbac: { ...ROUTES.rbac, roles: "/roles" },
} as const;
```

The spread means a new slice appears without touching this file, and the divergence is one visible
diff rather than two full tables drifting. The cost is that `feature` components can no longer name
`ROUTES.x` directly for those screens — the path has to arrive as a prop, which is the rule
[30](../../../../docs/setup/30-desktop-app.md) already establishes. That cost is the reason to avoid
diverging unless a screen truly must move.

---

## Verifying a shell actually has these routes

The table is hand-written, so it can lie: rename `settings/roles.tsx` to `settings/access.tsx` and
the table still claims `/settings/roles`. One line per shell closes that gap, typed against whatever
that shell's router generates:

```ts
// apps/web/src/route/-nav-routes.ts — nobody reads this, it only has to pass
const _routesExist: Readonly<Record<AppRoute, true>> = /* built from routeTree */;
```

Note the direction: the generated tree checks the readable table, never replaces it.

---

## Parameterised routes

Route param syntax is not portable — TanStack writes `/members/$id`, Next writes `/members/[id]`. A
shared literal cannot be both, so store a builder, which returns a finished path and sidesteps the
question:

```ts
memberDetail: (id: string) => `/settings/members/${id}`,
```

`AppRoute` uses `Extract<…, string>` precisely so a group may hold builders without the function type
leaking into the union. What a builder cannot do is *declare* the route to a file-based router — each
shell still writes its own route file, which is the drift the assertion above catches.

---

## See also

- [`@loadbearing/permissions`](../index.md)
- [ModuleRegistry](module-registry.md) — `ModuleGate.route` is an `AppRoute` from this table
- [30 · desktop app](../../../../docs/setup/30-desktop-app.md) — why paths and history mode are separate concerns
