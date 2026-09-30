---
title: identifiers
description: Why every UUID is branded, what branding costs, and where the parse boundary belongs.
---

# `Identifiers`

```ts
export class Identifiers {
  public static readonly organizationId: z.ZodBranded<z.ZodUUID, "OrganizationId">;
  public static readonly userId: z.ZodBranded<z.ZodUUID, "UserId">;
  public static readonly roleId: z.ZodBranded<z.ZodUUID, "RoleId">;
  public static readonly goalId: z.ZodBranded<z.ZodUUID, "GoalId">;
  public static readonly taskId: z.ZodBranded<z.ZodUUID, "TaskId">;
  public static readonly apiKeyId: z.ZodBranded<z.ZodUUID, "ApiKeyId">;
}

export type OrganizationId = z.infer<typeof Identifiers.organizationId>;
export type UserId = z.infer<typeof Identifiers.userId>;
export type RoleId = z.infer<typeof Identifiers.roleId>;
export type GoalId = z.infer<typeof Identifiers.goalId>;
export type TaskId = z.infer<typeof Identifiers.taskId>;
export type ApiKeyId = z.infer<typeof Identifiers.apiKeyId>;
```

`organizationId` is the tenant key, present on every domain table and used as the sharding key
([Data and scale](../../../../docs/opinions/data-and-scale.md)). It is the one identifier where a
swapped argument is a cross-tenant leak rather than an empty result set, which is why it is branded
like the rest rather than passed as a bare `string`.

---

## Branding is not decoration

Without it, every identifier in the system is `string`, and this compiles:

```ts
reactivateTask(goalId, taskId);   // signature is (taskId: string, goalId: string)
```

The arguments are swapped. Both are UUID-shaped, both are strings, and nothing objects. The query
runs, matches nothing, and returns an empty result — which reads like missing data rather than a bug,
so it gets investigated in the repository layer where nothing is wrong.

With a brand, that line is a compile error at the call site. In a system with a dozen UUID-shaped
identifiers this catches a real mistake regularly, and each one would otherwise have been found in
production.

## What it costs

A branded value cannot be constructed by assignment. You have to parse:

```ts
const taskId = Identifiers.taskId.parse(raw);
```

That is the whole cost, and it is charged at exactly the boundary where you wanted validation
anyway — an oRPC input, a row read off Postgres, a queue payload. Downstream of that line the type
travels with the value and nothing has to check it again.

## The brand is compile-time only

```ts
const taskId = Identifiers.taskId.parse(UUID);
const goalId = Identifiers.goalId.parse(UUID);

taskId === goalId;   // true — same string
```

Nothing is added to the runtime value. `JSON.stringify` produces a plain string, Postgres stores a
plain `uuid`, and a branded id round-trips through the wire without any special handling. The type
is erased; only the compiler ever knew.

This is why the spec asserts both facts — that the two are equal at runtime, and that assigning one
to the other is a `@ts-expect-error`.

## No message, here or anywhere

`z.uuid()` carries Zod's own failure text, and this package never replaces it with a custom string.
A malformed id produces an issue with `code: "invalid_format"`, `ValidationError.fromIssues` turns
that into `{ field, rule: "invalidFormat" }`, and `@loadbearing/content` renders
`error.field.invalidFormat`. See [errors](../../../errors/docs/reference/error-normalizer.md).

## Adding one

One line in this class and one exported type. The name is the domain noun in `PascalCase`, and the
schema member is the same noun in `camelCase` — `Identifiers.invoiceId` / `InvoiceId`. Anything
UUID-shaped that means something specific belongs here; a UUID that is genuinely just a UUID
(a request id, a trace id) does not.
