---
title: Authorizer
description: Three lines that are the system's only real permission gate — why they live in the use-case, the position they occupy, and the timing leak that position accepts.
---

# `Authorizer`

```ts
export class Authorizer {
  public assert(principal: Principal, permission: PermissionKey, goalId?: string): void {
    if (!principal.can(permission, goalId)) {
      throw new ForbiddenError(permission, goalId);
    }
  }
}
```

Three lines, and the single most important class in the package.

## Why it is not middleware

**Transport middleware is bypassed by two callers that matter.** `apps/worker` invokes use-cases
directly, with no request and no middleware chain. SSR direct calls do the same. A permission check
that lives in an oRPC interceptor protects the HTTP path and nothing else.

`Authorizer.assert()` is on the path every caller takes. The interceptor check in
[24](../../../../docs/setup/24-web-app.md) still exists and is still worth having — as defence in
depth, and to fail fast before a request does work. It is not the gate.

## `assert` versus `can`

Two names for two jobs, and mixing them produces the exact bug this architecture exists to prevent.

| | Returns | Used by |
| --- | --- | --- |
| `capabilities.can(...)` | `boolean` | UI, to decide whether to render a control |
| `authorizer.assert(...)` | `void`, throws | use-cases, to enforce an outcome |

A UI check silently becoming the only check is how a hidden button turns into an open endpoint.
`can()` answering a question and `assert()` enforcing one keeps the two uses visibly different at
every call site.

## Load, assert, work

```ts
public async execute(actor: Principal, input: ReactivateTaskInput): Promise<TaskEntity> {
  const task = await this.tasks.findByIdOrFail(input.taskId);

  this.authorizer.assert(actor, "task.reactivate", task.goalId);

  // ... the actual work
}
```

**The assertion is always line two or three.** Because the position is fixed, reviewing "is this
use-case gated" is reading one line per file rather than tracing a call graph. That is the entire
return on giving it a fixed position, and it is worth more than it looks.

`assertAll` exists for the case where one action needs several permissions. It throws on the first
one missing, so the error names a single permission rather than a set — which is what an operator
reading the audit trail wants.

## The leak this shape accepts

**When the permission is goal-scoped, you must load before you assert** — you need the task to know
its `goalId`. So a caller without permission can distinguish "does not exist" from "exists but
forbidden", by timing or by the shape of the failure.

For most products that is acceptable, and stating it plainly is better than pretending the ordering
is free. Where it is not acceptable, the fix is not to reorder: it is to have the repository take the
principal and filter at the query, so a forbidden row is indistinguishable from an absent one. Say so
explicitly in that port's doc comment when you do it — a repository that quietly filters is a
repository whose empty result nobody can explain.

## It throws a code, never a status

`ForbiddenError` carries `code = "FORBIDDEN"` and `context = { permission, goalId? }`. It carries no
prose and no `403` — every word a user reads lives in `content`, keyed by code, and the status is the
adapter's business.

That discipline is enforced rather than remembered: the ESLint config bans importing `HTTP_STATUS`
from `@loadbearing/errors` anywhere under `packages/application/src`. It is also what lets the worker
catch a `ForbiddenError` and log it, in a process that has no HTTP for a status code to mean anything
in.

## A flag is checked first, and it answers `NOT_FOUND`

A use-case behind a feature flag asks two questions, in this order:

```ts
await this.flags.assertOn(actor, flag); // NOT_FOUND when off
this.authorizer.assert(actor, permission); // FORBIDDEN when not held
```

Lite declares no flags, so no use-case asks the first question yet. The rule is for the first
flag that lands.

**The flag goes first because it is the broader answer.** A flag that is off means the feature does
not exist yet for this org. Answering `FORBIDDEN` would tell the caller that an endpoint exists and
they lack the key for it. That is a claim about a feature nobody has announced, and it would send an
org admin to the role editor to fix something no role can fix.

**The error names no flag.** `FlagCache.assertOn` throws `NotFoundError("feature", "unavailable")`,
the same context for every flag. `ErrorInterceptor` sends `toJSON()` to the browser, and a server-only
flag's name must never reach it. `flag.cache.spec.ts` stringifies the error and asserts the key is
absent.

`FlagCache` is not `Authorizer`. The permission check is synchronous over the principal's set, while
a flag is a read (one cache key for the whole deployment). That is why the flag check is `await`ed
and lives beside the authorizer rather than inside it.

**Its cache is invalidated with one delete, not the capability cache's two.** A read that raced the
write can restore the old state for at most the 60-second TTL, which is the window a flag already
promises. A flag is a rollout control, not a security boundary, so the second delete would buy
nothing, and `application` has no timer to schedule it with.

## `Principal.system()` is the other half

The worker needs an actor. The tempting shortcut is a wildcard principal, and the reason not to take
it is that `Authorizer` would then be a no-op for every scheduled job.

```ts
Principal.system(orgId, workerId, CapabilitySet.from({
  wildcard: false,
  org: { grants: ["task.read", "task.update"], denies: [] },
  goals: {},
}));
```

The overdue sweep needs exactly those two permissions. Giving it everything means a bug in a schedule
can do anything — and the audit row will faithfully record that the system did it.
