---
title: Enforcement surfaces
description: The four places a permission is checked, in order of authority — and why the three weaker ones are worth having even though only the first one is the gate.
---

# Enforcement surfaces

| # | Surface | Where | What it is |
|---|---|---|---|
| 1 | `Authorizer.assert()` | inside the use-case | **the gate** |
| 2 | `principalMiddleware` | the oRPC chain | defence in depth, failing closed |
| 3 | `RouteGuard` | a route's `beforeLoad` | stops the page rendering |
| 4 | `<Can>` | a component | a UX affordance |

**The rule they exist to serve:** removing a permission from a role must hide the affordance **and**
return `FORBIDDEN`. One without the other is either security theatre or a UI full of buttons that
error.

Only the first is authoritative. The worker bypasses 2, 3 and 4 entirely, and so does any SSR call
that skipped the adapter — which is exactly why the assertion lives in the use-case.

**The count does not grow with features, and that is worth saying once.** The archived
notification read added a permission key, a procedure, a use-case, a route guard and a `<Can>` —
and no fifth surface. It is an ordinary procedure: the assertion is in the use-case, the mapping
is in `PROCEDURE_PERMISSIONS`, and the two client-side checks are affordances. A feature that
*did* need a fifth surface would be one reaching the data by a path none of these four sit on,
which is the thing to notice rather than the surface to add.

## 1. `Authorizer.assert()`

The only one that runs on every path. See
[`application/docs/reference/authorizer.md`](../../../../packages/application/docs/reference/authorizer.md).

## 2. `principalMiddleware`

Defence in depth, and it fails **closed**: a procedure with no entry in `PROCEDURE_PERMISSIONS` is
denied, not allowed. Paired with the coverage test in `packages/contracts`, forgetting to map a new
procedure is caught at test time and, failing that, here — never by shipping an ungated endpoint.

`authed` is built from `implement(contract)` rather than from `base`, so a router writes
`authed.role.list.handler(…)` and gets the procedure's input and output types with no annotation.
`implement(contract.role.list).use(authed)` looks like the same thing and is not: `.use()` takes a
*middleware*, and a builder passed there fails with several hundred characters of inference rather
than a sentence.

Anything built on `base` instead of `authed` is unauthenticated on purpose and obvious in review.

### Why the error middleware is a middleware

`errorMiddleware` sits **inside** the chain rather than at the adapter. An adapter-level interceptor
sees only the initial context, so it has no `traceId` and no request-scoped logger to hand
`ErrorInterceptor`.

It wraps `principalMiddleware` too, so an unauthenticated call is logged and shaped like every other
failure rather than short-circuiting past the one place that logs. It is declared against what it
*requires* rather than derived from the chain above: `BuilderWithMiddlewares` has no `.middleware()`,
so a middleware depending on an earlier one states its own context and oRPC checks the chain supplies
it.

### Correlation comes first

`correlationMiddleware` runs before `principalMiddleware`, so a failure to resolve a principal is
already correlated. `Correlation.fromHeaders` adopts an upstream `x-request-id` where a proxy set one
— sanitised first, because it arrives from the network and then rides every line of the request — and
mints a `Uuid.v7()` otherwise.

## 3. `RouteGuard`

Stops the page rendering at all, which `<Can>` cannot. It calls **the same `CapabilitySet.can()` the
server calls**, which is why the guard rebuilds the DTO rather than shape-checking the JSON: a second
implementation of `can()` is a second answer.

The leading hyphen in `-guard.ts` keeps the file out of the route tree. Framework naming wins inside
`src/route/`.

**`requireSession()` carries the destination it interrupted.** `redirect({ to: "/sign-in" })` alone
lands every deep link on `/` after the sign-in it triggered — although `/sign-in` already declares
`validateSearch: RedirectSearch.schema` and reads `redirect` back on success. The guard passes
`location.href`, which is path and search: exactly the shape that schema accepts.

**`RedirectSearch` rejects a backslash anywhere, not only a leading double slash.** A browser
resolves `/\evil.test` with `evil.test` as the host, the same way it resolves `//evil.test` — a
backslash is a path separator, so a rule that only refuses `//` is half a rule. The shape is one
leading slash, no second separator of either kind, and no backslash later in the string.

## 4. `<Can>`

Not the gate. `<Can>` hides an affordance — a button, a link — and names its permission at the call
site.


Hiding a button is a courtesy. The check is `Authorizer.assert()` in the use-case, and it runs whether
or not the button was ever rendered — which is what makes a link that is hidden here still answer
`FORBIDDEN` when typed by hand.

## The DTO has three axes now, and the surface count did not grow

`CapabilitySetDto` carries `org`, `goals` and `platform`. All four surfaces above call the same
`can()`, so a `platform.*` key is enforced by the same four and needs no fifth.

The one thing worth knowing is where the merge happens. `PrincipalBuilder` reads the tenant set and
the platform set in parallel and merges them, and **`session.fn.ts` runs the same merge** — the SSR
snapshot is the only other place a `CapabilitySet` is built. If it did not, surfaces 3 and 4 would
hide a platform page the server would happily have served, which is the failure mode this note
exists to prevent.

The snapshot also carries `isPlatformOrganization`: whether the *active* tenant is the tier, which
is not whether the user is a platform admin. Only the role editor reads it, to decide whether to
offer the platform module at all.

## No loading state grants access

The session store is seeded **signed out**, denying everything, and resolution only ever widens it.
A guard that somehow ran before `__root.tsx` resolved sees an empty capability set and denies.

There is deliberately no third state where a not-yet-resolved store is treated as permissive.
