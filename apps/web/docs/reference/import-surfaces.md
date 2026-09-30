---
title: The two import surfaces
description: Why this app has two import.ts files rather than one, what each may name, and the three imports that are deliberately outside both because a tool demands it.
---

# The two import surfaces

Every package in this repository writes each external import exactly once, in `src/import.ts`, and
imports it from there. This app has **two**, and the split is the server-only boundary made
readable.

| Surface | May name | Read by |
|---|---|---|
| `src/import.ts` | the client-safe workspace packages, React, `@tanstack/react-query`, `createRouter`, zod | anything |
| `src/server/import.ts` | `@loadbearing/composition`, `@loadbearing/application` and the vendor SDKs beneath them | `src/server/**` only |

`apps/web/src/**` is banned from naming `composition`, `application`, `auth`, `infrastructure` and
their vendors. `apps/web/src/server/**` is the one exemption, because nothing that reads that file
reaches a browser.

**Merging them would hand every route component an edge into the server graph** and leave the client
bundle's cleanliness resting on tree-shaking — which is exactly what `check-architecture` §8 exists
to avoid depending on.

Read as a list, `server/import.ts` answers "what does the transport layer touch?", and a server-only
package appearing on the client surface instead is the leak.

## The three imports that sit outside both

Each is forced by a tool, and each is commented at the line where it appears.

**`env.ts` keeps its own imports.** It carries the marker that makes Start's import-protection plugin
fail the build if the module ever becomes reachable from the client graph, and **a side-effect import
cannot be re-exported**. Before that marker was there, `Env` shipped in the browser bundle as
`Schema.parse({})` and threw on `DATABASE_URL` before the first render.

**`@tanstack/react-router` is imported directly inside `src/route/`.** The route generator only
recognises `createFileRoute` when it is imported from that specifier literally, and prepends its own
import when it is not. `createRouter` is on the client surface because `router.tsx` is a file the
generator never reads.

**`@tanstack/react-start` and its `/server` subpath are imported directly in `server/*.fn.ts`.** See
[`server-functions.md`](./server-functions.md) — a re-exported `/server` entry is a client-graph edge
that Start's import protection denies outright.

## The stylesheet pair

```ts
export { default as classCss } from "@loadbearing/ui/class.css?url";
export { default as themeCss } from "@loadbearing/ui/theme.css?url";
```

Two links, and **the order they are written into `<head>` matters** rather than the order they are
named here: `class.css` reads the token names `theme.css` defines. An app supplying its own design
drops the second.

## What the client surface deliberately does not carry

- **`SERVER_CATALOG`.** The client catalog by way of `StaticContentSource`, always — the `email`
  namespace is the worker's, and the ESLint ban fires on that line.
- **Wire shapes.** Only the two branded ids `session.fn.ts` casts to. What a component renders
  arrives through `@loadbearing/query`.
- **zod, for anything but search parameters.** A route validates what a browser put in its own URL
  bar; the wire shapes are `contracts`' business.
- **A module-singleton `AuthClient`.** It is constructed per component, because the instance differs
  per environment and the desktop shell supplies absolute URLs of its own.
