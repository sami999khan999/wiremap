---
title: procedure-permissions
description: The map that guarantees no procedure ships ungated, the test that enforces it, and why the walker uses oRPC's own predicate.
---

# `ProcedurePermissions`

```ts
// src/catalog/index.ts — merged from one <subject>.permissions.ts per slice
export const PROCEDURE_PERMISSIONS: Readonly<Record<string, PermissionKey>>;

// src/registry/procedure-permissions.ts
export class ProcedurePermissions {
  public static required(path: string): PermissionKey | undefined;
  public static paths(): readonly string[];
}
```

The shape mirrors `@loadbearing/permissions` exactly: `catalog/` holds team-owned fragments and the
platform-owned index that merges them, `registry/` holds the lookup class over the result. Knowing
one package teaches you the other.

---

## What this is, and what it is not

**It is a transport-layer guarantee that no procedure ships ungated.** The oRPC base middleware
reads `required(path)` and fails closed when it is `undefined`, so a procedure someone forgot to map
denies every call rather than allowing every call.

**It is not the authorization check.** The real decision lives in the use-case, which asks a
`CapabilitySet` a question with the goal scope in hand. This map cannot do that — it does not know
which goal a request is about. It is defence in depth: the outer gate that makes "I forgot" fail
safe, not the gate that decides.

## `Object.hasOwn`, not a bare index

```ts
public static required(path: string): PermissionKey | undefined {
  return Object.hasOwn(PROCEDURE_PERMISSIONS, path) ? PROCEDURE_PERMISSIONS[path] : undefined;
}
```

`path` arrives from the wire. Indexing the object directly resolves up the prototype chain, so
`required("toString")` returns `Object.prototype.toString` — a function, which is not `undefined`,
so the middleware treats the procedure as gated and hands a function to the capability check.

`noUncheckedIndexedAccess` does not catch this: the declared type is
`Record<string, PermissionKey>`, so TypeScript believes the index yields
`PermissionKey | undefined` and is simply wrong about the runtime. The same reasoning is why
`PermissionRegistry.isKnown` and `AppError.isKnownCode` are written the same way.

## The coverage test needs a fixture

The kit ships no feature slices, so `contract` is `{}` and both coverage tests pass over an empty
list. Green, and proving nothing — including nothing about the walker that is supposed to enforce
them. So the spec builds a fixture with `oc` and asserts the walker finds its paths:

```ts
const fixture = {
  task: {
    list: oc.route({ method: "GET", path: "/goals/{goalId}/tasks" })./* … */,
    reactivate: oc.route({ method: "POST", path: "/tasks/{taskId}/reactivate" })./* … */,
  },
};

expect(ContractWalker.paths(fixture).sort()).toEqual(["task.list", "task.reactivate"]);
```

That is the test that fails the day the first real slice lands with a missing gate — because it is
the test that proves the walker still recognises a procedure.

## `isContractProcedure`, not `"~orpc" in node`

The walker has to tell a procedure (a leaf) from a nested router (descend into it). The obvious
check is the marker property oRPC puts on a procedure:

```ts
if (node && typeof node === "object" && "~orpc" in node) return [prefix.join(".")];
```

That works today and is internal — the tilde is oRPC saying so. `@orpc/contract` exports
`isContractProcedure`, which is the same check behind a supported name, so use it. If the internals
move, a supported predicate moves with them and a `~orpc` string does not.

The failure mode is worth naming, because it is silent: if the marker stops matching, a procedure
is walked as a plain object and yields its *internal* keys as paths. `paths()` then returns
plausible-looking garbage, `missing` comes out empty, and the coverage test stays green while
covering nothing. The spec asserts a procedure is treated as a leaf for exactly this reason.

## Adding a slice

Three edits, in this order:

1. `src/<subject>/<subject>.procedures.ts` — the oRPC definitions.
2. `src/procedure/index.ts` — one line adding the slice to `contract`.
3. `src/catalog/<subject>.permissions.ts` plus one spread in `src/catalog/index.ts`.

Miss the third and the coverage test fails by name, listing the ungated paths. Miss the second and
the procedures are unreachable. Neither is a runtime surprise.
