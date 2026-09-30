# 10 · `@loadbearing/contracts`

> The shared kernel, half four. Zod contract classes, domain entities, the oRPC contract router, and the procedure→permission map.

**Delivers:** One schema per boundary, entities that carry their own rules, and a contract implementable by oRPC today or NestJS later.

**Prerequisite:** [09b · `@loadbearing/observability`](09b-observability-package.md)

---

## The four file roles

Every feature slice in this package has the same four files, and each answers a different question.

| File | Class | Answers |
|---|---|---|
| `<subject>.contract.ts` | `TaskContract` | What shape is this data? (Zod schemas, static readonly members) |
| `<subject>.entity.ts` | `TaskEntity` | What does this data know about itself? (behaviour, no I/O) |
| `<subject>.procedures.ts` | `TaskProcedures` | What operations exist, at what path? (oRPC contract) |
| `<subject>.permissions.ts` | — | Which permission gates each procedure path? (fragment — lives in `catalog/`, not the subject folder) |

`src/` holds `index.ts`, `import.ts`, and folders ([Opinions · Folders](../opinions/folders.md)), so
the two merge points live in folders named after their role. The shape is `permissions`' shape, one
concept at a time:

| `@loadbearing/permissions` | `@loadbearing/contracts` |
|---|---|
| `catalog/` → `CATALOG` | `catalog/` → `PROCEDURE_PERMISSIONS` |
| `registry/` → `PermissionRegistry` | `registry/` → `ProcedurePermissions` |
| `route/` → `ROUTES` | `procedure/` → `contract` |

```
packages/contracts/src/
├── index.ts
├── import.ts                        ← zod, @orpc/contract, @loadbearing/permissions
├── primitive/
│   ├── index.ts
│   ├── identifiers.ts               → Identifiers, GoalId, TaskId, UserId, …
│   ├── envelope.ts                  → Envelope
│   └── pagination.ts                → Pagination
├── procedure/
│   └── index.ts                     → contract, AppContract   ← merges every slice's procedures
├── catalog/
│   ├── index.ts                     → PROCEDURE_PERMISSIONS   ← merges every slice's fragment
│   └── <subject>.permissions.ts     ←   procedure path → PermissionKey
├── registry/
│   ├── index.ts
│   └── procedure-permissions.ts     → ProcedurePermissions
└── <subject>/
    ├── index.ts
    ├── <subject>.contract.ts
    ├── <subject>.entity.ts
    └── <subject>.procedures.ts
```

Specs sit in `packages/contracts/tests/`, mirroring the tree above — so `src/<subject>/<subject>.entity.ts`
is covered by `tests/<subject>/<subject>.entity.spec.ts`. See [07](07-core-package.md#step-76--a-first-test).

> [!NOTE]
> **`procedure/` is a new name in the folder vocabulary**, added deliberately rather than reusing
> `router/`. `apps/web/src/server/orpc/` holds the routers that *implement* this contract, and one
> word meaning both would be the exact collision
> [Opinions · Folders](../opinions/folders.md) exists to prevent.

---

## Step 10.1 — Branded identifiers

First, the outside surface. Every external import this package takes is written once here
([Opinions · Imports](../opinions/imports.md)):

**`packages/contracts/src/import.ts`**

```ts
// Everything this package takes from outside itself, in one place. No relative
// re-exports live here — that is what keeps it cycle-free.

// ── @loadbearing/permissions ─────────────────────────────────────────────────
export type { PermissionKey } from "@loadbearing/permissions";

// ── @orpc/contract ───────────────────────────────────────────────────────────
export type { AnyContractRouter } from "@orpc/contract";

// ── zod ──────────────────────────────────────────────────────────────────────
export { z } from "zod";
```

`@loadbearing/core` and `@loadbearing/errors` are declared in `package.json` and are not here yet:
nothing imports them until the first slice adds an entity that takes a `Clock`.

**`packages/contracts/src/primitive/identifiers.ts`**

```ts
import { z } from "../import.js";

export class Identifiers {
  private constructor() {}

  public static readonly userId = z.uuid().brand<"UserId">();
  public static readonly roleId = z.uuid().brand<"RoleId">();
  public static readonly goalId = z.uuid().brand<"GoalId">();
  public static readonly taskId = z.uuid().brand<"TaskId">();
  public static readonly apiKeyId = z.uuid().brand<"ApiKeyId">();
}

export type UserId = z.infer<typeof Identifiers.userId>;
export type RoleId = z.infer<typeof Identifiers.roleId>;
export type GoalId = z.infer<typeof Identifiers.goalId>;
export type TaskId = z.infer<typeof Identifiers.taskId>;
export type ApiKeyId = z.infer<typeof Identifiers.apiKeyId>;
```

**Branding is not decoration.** Without it, every identifier is `string` and `reactivateTask(goalId, taskId)` compiles happily when the arguments are swapped. With it, that is a compile error at the call site. In a system with a dozen UUID-shaped identifiers this catches a real bug roughly once a month, and each one would otherwise have been found in production by a query that returned nothing.

The cost: constructing a branded value requires parsing. `Identifiers.taskId.parse(raw)` at the boundary, and everything downstream is typed. That boundary is exactly where you wanted validation anyway.

---

## Step 10.2 — The response envelope

**`packages/contracts/src/primitive/envelope.ts`**

```ts
import { z } from "../import.js";

export class Envelope {
  private constructor() {}

  public static paginated<T extends z.ZodType>(item: T) {
    return z.object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
    });
  }

  public static readonly acknowledged = z.object({
    ok: z.literal(true),
  });
}
```

**`packages/contracts/src/primitive/pagination.ts`**

```ts
import { z } from "../import.js";

export class Pagination {
  private constructor() {}

  public static readonly query = z.object({
    limit: z.number().int().positive().max(100).default(25),
    offset: z.number().int().nonnegative().default(0),
  });
}

export type PaginationQuery = z.infer<typeof Pagination.query>;
```

Decide the list shape once, here, and every list procedure in the product inherits it. The alternative — each feature inventing its own `{ data, meta }` or `{ results, nextCursor }` — means the query layer has a special case per feature and the UI has a different empty state per feature.

`max(100)` on `limit` is a denial-of-service guard living in the schema rather than in a handler, which means it applies to the worker and the offline queue too.

---

## Step 10.3 — A contract class

Contract classes are **static readonly Zod schemas on a class**. This is the data-shape exemption to the no-free-exports rule: a Zod schema is a value describing a shape, not behaviour, and it stays namespaced on the class the way a free `export const taskEntitySchema` would not.

**`packages/contracts/src/task/task.contract.ts`** — illustrative; `role/` and `member/` are the two real ones to read beside it.

```ts
import { z } from "../import.js";
import { Identifiers, Pagination } from "../primitive/index.js";

export class TaskContract {
  private constructor() {}

  public static readonly status = z.enum([
    "backlog",
    "todo",
    "in_progress",
    "blocked",
    "done",
    "overdue",
  ]);

  public static readonly priority = z.enum(["low", "medium", "high", "critical"]);

  public static readonly entity = z.object({
    id: Identifiers.taskId,
    goalId: Identifiers.goalId,
    title: z.string().min(1).max(300),
    description: z.string().max(20_000).nullable(),
    status: TaskContract.status,
    priority: TaskContract.priority,
    deadline: z.iso.datetime().nullable(),
    assigneeId: Identifiers.userId.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  });

  public static readonly create = TaskContract.entity.pick({
    goalId: true,
    title: true,
    description: true,
    priority: true,
    deadline: true,
  });

  public static readonly listQuery = Pagination.query.extend({
    goalId: Identifiers.goalId,
    status: TaskContract.status.optional(),
  });

  public static readonly reactivate = z.object({
    taskId: Identifiers.taskId,
    mode: z.enum(["same_assignee", "reassign", "cancel"]),
    newAssigneeId: Identifiers.userId.optional(),
    newDeadline: z.iso.datetime().optional(),
    reason: z.string().min(10, "A reason is required for reactivation."),
  });
}

export type TaskDto = z.infer<typeof TaskContract.entity>;
export type CreateTaskInput = z.infer<typeof TaskContract.create>;
export type ReactivateTaskInput = z.infer<typeof TaskContract.reactivate>;
export type TaskStatus = z.infer<typeof TaskContract.status>;
```

`reason: z.string().min(10)` encodes a business requirement **once**. The server rejects a short reason, the web form shows the message, and the desktop app's offline queue rejects it before the mutation is ever enqueued. Writing that rule in a handler instead means writing it three more times.

> [!IMPORTANT]
> **No `{ message: … }` in a schema, ever.** Zod's default messages are built-in messages and are discarded; a *custom* string here would be user-facing text living outside `content`, which is the one thing that split exists to prevent. A failed rule becomes `{ field: "reason", rule: "tooShort", params: { min: 10 } }` and `content` renders `error.field.tooShort` ([09](09-errors-package.md), [20](20-content-package.md)). The rule is still declared exactly once — only the sentence lives elsewhere.

**Derive, don't repeat.** `create` is `entity.pick(...)`, `listQuery` extends `Pagination.query`. When a field is added to the entity, the derived schemas move with it or fail to compile. Hand-written parallel schemas drift silently.

**Timestamps are ISO strings in contracts, `Date` in entities.** The contract crosses a JSON boundary and JSON has no date type. `z.iso.datetime()` at the edge, `new Date(...)` in `fromDto`, and the conversion happens in exactly one place.

---

## Step 10.4 — A domain entity

**`packages/contracts/src/task/task.entity.ts`** — illustrative, as in 10.3.

```ts
// `Clock` and `CapabilitySet` join `src/import.ts` when this file lands — the first
// slice is what makes those two dependencies real.
import type { CapabilitySet, Clock } from "../import.js";
import type { GoalId, TaskId, UserId } from "../primitive/index.js";
import { TaskContract, type TaskDto, type TaskStatus } from "./task.contract.js";

export class TaskEntity {
  private constructor(
    public readonly id: TaskId,
    public readonly goalId: GoalId,
    public readonly title: string,
    public readonly status: TaskStatus,
    public readonly deadline: Date | null,
    public readonly assigneeId: UserId | null,
  ) {}

  public static fromDto(dto: TaskDto): TaskEntity {
    return new TaskEntity(
      dto.id,
      dto.goalId,
      dto.title,
      dto.status,
      dto.deadline ? new Date(dto.deadline) : null,
      dto.assigneeId,
    );
  }

  public static parse(raw: unknown): TaskEntity {
    return TaskEntity.fromDto(TaskContract.entity.parse(raw));
  }

  public isOverdueAt(clock: Clock): boolean {
    if (!this.deadline || this.status === "done") return false;
    return clock.now() > this.deadline;
  }

  public isLockedFromAssignee(): boolean {
    return this.status === "overdue";
  }

  public canBeEditedBy(actor: UserId, caps: CapabilitySet): boolean {
    if (this.isLockedFromAssignee()) return caps.can("task.reactivate", this.goalId);
    if (caps.can("task.update", this.goalId)) return true;
    return this.assigneeId === actor && caps.can("task.update.self", this.goalId);
  }
}
```

### Three rules for entities

**No I/O.** An entity never reads a database, calls a service, or touches the network. Everything it needs arrives as a constructor argument or a method parameter — including `Clock`, which is why time-dependent rules are testable.

**Behaviour, not getters.** `isLockedFromAssignee()` rather than exposing `status` and letting three call sites compare it to `"overdue"`. The moment that comparison appears in a handler *and* in a component, they will diverge.

**Private constructor, static factories.** `fromDto` and `parse` are the only ways to make one. That guarantees every entity in the system came through validation.

`canBeEditedBy` is the pattern to notice: it takes a `CapabilitySet` and answers a question the server handler, the React disabled-button state, and the offline validator all need. One implementation, three consumers, no possibility of drift.

---

## Step 10.5 — The oRPC contract

**`packages/contracts/src/task/task.procedures.ts`** — illustrative, as in 10.3.

```ts
import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { TaskContract } from "./task.contract.js";

export class TaskProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/goals/{goalId}/tasks" })
    .input(TaskContract.listQuery)
    .output(Envelope.paginated(TaskContract.entity));

  public static readonly create = oc
    .route({ method: "POST", path: "/goals/{goalId}/tasks" })
    .input(TaskContract.create)
    .output(TaskContract.entity);

  public static readonly reactivate = oc
    .route({ method: "POST", path: "/tasks/{taskId}/reactivate" })
    .input(TaskContract.reactivate)
    .output(TaskContract.entity);
}
```

**`packages/contracts/src/procedure/index.ts`** — the merge point. What ships is the empty one:

```ts
import type { AnyContractRouter } from "../import.js";

// The merge point for every slice's `<subject>.procedures.ts`. Add each slice here —
// `task: TaskProcedures.all`. `satisfies` is what makes a fragment that is not an
// oRPC contract fail on this line rather than downstream in `apps/web`.
export const contract = {} as const satisfies AnyContractRouter;

export type AppContract = typeof contract;
```

With the illustrative task slice added, it reads:

```ts
import { TaskProcedures } from "../task/index.js";

export const contract = {
  task: {
    list: TaskProcedures.list,
    create: TaskProcedures.create,
    reactivate: TaskProcedures.reactivate,
  },
} as const satisfies AnyContractRouter;
```

**Write `.route({ method, path })` on every procedure, from the first one.** It costs one line now and buys three things: OpenAPI generation for external integrations, REST-shaped URLs so a partner can call your API without an oRPC client, and the path metadata `@orpc/nest` requires if you ever implement the same contract in a NestJS controller. Retrofitting it across two dozen feature modules is tedious in a way that "we'll add it later" always underestimates.

The router object is the one place a plain `export const` appears in this package. It is a data structure, not behaviour, and oRPC's type inference requires the literal shape — a class would erase it.

---

## Step 10.6 — `ProcedurePermissions`

**`packages/contracts/src/catalog/task.permissions.ts`** — illustrative; the slice's fragment.

> [!NOTE]
> This one file lives in `catalog/` rather than in the subject folder alongside the other three, which is the single exception to the folder-prefix rule. It is a **cross-check** — "does every declared procedure have a gate" — rather than part of the subject's own definition. `catalog/` is the same name `@loadbearing/permissions` and `@loadbearing/errors` give the same pattern: team-owned fragments plus a platform-owned index that merges them.

```ts
import type { PermissionKey } from "../import.js";

export const taskProcedurePermissions = {
  "task.list": "task.read",
  "task.create": "task.create",
  "task.reactivate": "task.reactivate",
} as const satisfies Record<string, PermissionKey>;
```

**`packages/contracts/src/catalog/index.ts`** — the merge. What ships is the empty one:

```ts
import type { PermissionKey } from "../import.js";

// Merged from team-owned fragments, one `<subject>.permissions.ts` per slice. Add
// them here — `...taskProcedurePermissions`. Fragmented for the same reason the
// permission catalog is: one team, one file, no merge conflicts in a shared list.
//
// Not re-exported from the package barrel. It is an input to `ProcedurePermissions`
// and to the coverage test, and nothing outside this package may read it.
export const PROCEDURE_PERMISSIONS: Readonly<Record<string, PermissionKey>> = {};
```

**`packages/contracts/src/registry/procedure-permissions.ts`**

```ts
import { PROCEDURE_PERMISSIONS } from "../catalog/index.js";
import type { PermissionKey } from "../import.js";

const PATHS: readonly string[] = Object.freeze(Object.keys(PROCEDURE_PERMISSIONS));

// Every procedure path must appear in the catalog. The oRPC base middleware fails
// closed on any path that does not, so a forgotten entry denies the call.
export class ProcedurePermissions {
  private constructor() {}

  // `Object.hasOwn`, not a bare index — `PROCEDURE_PERMISSIONS["toString"]` resolves
  // up the prototype chain to a function, which would gate a procedure on garbage.
  public static required(path: string): PermissionKey | undefined {
    return Object.hasOwn(PROCEDURE_PERMISSIONS, path) ? PROCEDURE_PERMISSIONS[path] : undefined;
  }

  public static paths(): readonly string[] {
    return PATHS;
  }
}
```

Fragment it the same way as the permission catalog. Each slice declares its own map next to its procedures; `catalog/index.ts` merges them. Otherwise every team edits one file on every feature and it becomes the busiest merge conflict in the repository.

> [!WARNING]
> **`Object.hasOwn`, not `PROCEDURE_PERMISSIONS[path]`.** `path` arrives from the wire, and a bare index resolves up the prototype chain: `required("toString")` returns `Object.prototype.toString`, which is not `undefined`, so the middleware treats the procedure as gated and hands a function to the capability check. `noUncheckedIndexedAccess` does not catch it — the declared type says the index yields `PermissionKey | undefined` and is simply wrong about the runtime. Same reasoning as `PermissionRegistry.isKnown` ([08](08-permissions-package.md)) and `AppError.isKnownCode` ([09](09-errors-package.md)).

### The coverage test

**`packages/contracts/tests/registry/procedure-permissions.spec.ts`**

```ts
import { isContractProcedure, oc } from "@orpc/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contract } from "../../src/procedure/index.js";
import { ProcedurePermissions } from "../../src/registry/procedure-permissions.js";

// Flattens a contract router to the dotted paths a procedure is reachable at.
class ContractWalker {
  public static paths(node: unknown, prefix: readonly string[] = []): string[] {
    if (isContractProcedure(node)) return [prefix.join(".")];
    if (!node || typeof node !== "object") return [];
    return Object.entries(node).flatMap(([key, child]) =>
      ContractWalker.paths(child, [...prefix, key]),
    );
  }
}

// A second, fixed router the walker is exercised against directly. The two coverage
// tests below run over the real `contract`, which carries the `role` slice; this
// fixture is what proves the walker itself — nesting, a procedure recognised as a
// leaf, and an empty router — and it names a slice the kit does not ship so the
// “undeclared path” test stays honest.
const fixture = {
  task: {
    list: oc.route({ method: "GET", path: "/goals/{goalId}/tasks" })
      .input(z.object({ goalId: z.uuid() }))
      .output(z.object({ items: z.array(z.string()) })),
    reactivate: oc.route({ method: "POST", path: "/tasks/{taskId}/reactivate" })
      .input(z.object({ taskId: z.uuid() }))
      .output(z.object({ ok: z.literal(true) })),
  },
};

describe("ContractWalker", () => {
  it("finds every procedure, at its dotted path", () => {
    expect(ContractWalker.paths(fixture).sort()).toEqual(["task.list", "task.reactivate"]);
  });

  it("recognises an oRPC procedure as a leaf, not as a record to descend into", () => {
    expect(ContractWalker.paths(fixture.task.list, ["task", "list"])).toEqual(["task.list"]);
  });
});

describe("ProcedurePermissions", () => {
  it("gates every procedure the contract router declares", () => {
    const declared = ContractWalker.paths(contract);
    const missing = declared.filter((path) => ProcedurePermissions.required(path) === undefined);
    expect(missing).toEqual([]);
  });

  it("has no entries for procedures that no longer exist", () => {
    const declared = new Set(ContractWalker.paths(contract));
    const orphans = ProcedurePermissions.paths().filter((path) => !declared.has(path));
    expect(orphans).toEqual([]);
  });

  it("answers undefined for an inherited key", () => {
    expect(ProcedurePermissions.required("toString")).toBeUndefined();
  });
});
```

**Use `isContractProcedure`, not `"~orpc" in node`.** The tilde is oRPC saying the marker is
internal; `@orpc/contract` exports the same check behind a supported name. The failure mode is
silent either way and worth naming: if the marker stops matching, a procedure gets walked as a plain
object and yields its *internal* keys as paths — `missing` comes out empty and the coverage test
stays green while covering nothing. That is why the spec asserts a procedure is treated as a leaf.

**The fixture is not decoration.** The kit ships no slices, so `contract` is `{}` and both coverage
tests pass over an empty list. Green, proving nothing — including nothing about the walker. Building
a fixture with `oc` is what makes the test fail on the day the first real slice lands with a missing
gate.

This is a **transport-layer guarantee that no procedure ships ungated**, and the orphan test is what stops the map growing stale entries that look like coverage. The real authorization check still lives in the use-case; this is defence in depth, not the gate itself.

---

## Step 10.7 — The barrel

**`packages/contracts/src/index.ts`** — what ships:

```ts
export {
  type ApiKeyId,
  Envelope,
  type GoalId,
  Identifiers,
  Pagination,
  type PaginationQuery,
  type RoleId,
  type TaskId,
  type UserId,
} from "./primitive/index.js";
export { type AppContract, contract } from "./procedure/index.js";
export { ProcedurePermissions } from "./registry/index.js";
```

A subject folder adds one more statement:

```ts
export {
  type CreateTaskInput,
  type ReactivateTaskInput,
  TaskContract,
  type TaskDto,
  TaskEntity,
  TaskProcedures,
  type TaskStatus,
} from "./task/index.js";
```

**`catalog/` is not re-exported.** Its fragments are inputs to `ProcedurePermissions`, and the coverage test reaches `contract` and the class rather than the raw map. That is the private layer a named barrel gives you and `export *` cannot ([Opinions · Imports](../opinions/imports.md)).

Adding a subject means three edits, not two: `procedure/index.ts`, `catalog/index.ts`, and this barrel. The third is the one that makes the new surface show up in review.

---

## What ships, and what is illustrative

**`primitive/` is real, and so are `role/` and `member/`.** The kit ships two slices through this
package and no sample task tracker: `procedure/index.ts` and `catalog/index.ts` are **merge points**,
and that is the deliverable — each slice adds one line to each, and a product with neither would have
`contract` as `{}` and `PROCEDURE_PERMISSIONS` as `{}`.

Every `task.*` sample above is illustrative and cannot be pasted in as-is: `@loadbearing/permissions`
declares no `task.read` or `task.reactivate` key, so `satisfies Record<string, PermissionKey>` in the
fragment would fail to compile. A slice means adding the permission keys in
[08](08-permissions-package.md) first — which is the dependency direction working correctly, and
exactly what `role` and `member` did.

---

## ✅ Gate

```bash
pnpm --filter @loadbearing/contracts build
pnpm --filter @loadbearing/contracts test
```

- The build succeeds and `dist/index.d.ts` exists, exporting `Identifiers`, `Envelope`,
  `Pagination`, `contract`, and `ProcedurePermissions` — and **not** `PROCEDURE_PERMISSIONS`.
- `pnpm exec biome check packages/contracts` and `pnpm exec eslint packages/contracts` are clean.
- The `ContractWalker` fixture tests pass — that is what proves the coverage test can fail.
- `ProcedurePermissions.required("toString")` is `undefined`.
- `Identifiers.taskId.parse(uuid)` and `Identifiers.goalId.parse(uuid)` are `===` at runtime, and
  assigning one to the other is a compile error.
- `src/` contains `index.ts`, `import.ts`, and folders — nothing else
  ([Opinions · Folders](../opinions/folders.md)).

Do not proceed until this passes.

---

[← `@loadbearing/observability`](09b-observability-package.md) · [Local Infrastructure →](11-local-infrastructure.md)
