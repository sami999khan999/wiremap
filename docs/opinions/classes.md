---
title: Classes and methods
description: Plain role nouns for seams, technology prefixes for implementations, and a closed method vocabulary.
---

# Classes and methods

## Class names

| Kind | Convention | Example |
|---|---|---|
| Abstract seam | Plain role noun — **no `I`, no `Abstract`** | `VectorStore`, `AuthStrategy`, `Clock` |
| Concrete implementation | **Technology prefix** + the seam name | `PgVectorStore`, `S3StorageGateway`, `SystemClock` |
| Test double | `Fake` or `Fixed` prefix | `FakeTaskRepository`, `FixedClock` |
| Use-case | `<Verb><Noun>UseCase` | `ReactivateTaskUseCase` |
| Repository | `<Aggregate>Repository` | `TaskRepository` |
| Entity | `<Noun>Entity` | `TaskEntity` |
| Contract | `<Noun>Contract` | `TaskContract` |
| Error | `<Reason>Error` | `ForbiddenError` |
| Registry | `<Noun>Registry` | `PermissionRegistry` |

The technology-prefix rule is what makes a seam visible at a glance. Seeing `PgVectorStore` in the
`Container` and `VectorStore` everywhere else tells you exactly where the Qdrant swap happens
([14](../setup/14-vector-store.md)).

**Banned suffixes:** `Manager`, `Helper`, `Util`, `Handler`, and bare `Service`. They describe
nothing. If a class fits none of `UseCase`, `Repository`, `Gateway`, `Store`, `Reader`, `Logger`,
`Provider`, `Publisher`, `Resolver`, `Renderer`, `Rules`, `Subscriber`, `Policy`, `Strategy`,
`Entity`, `Registry`, it probably wants splitting. `Policy` is the escape valve for a domain rule too broad
for one entity, and `Rules` is what several writes over one subject share — `RoleRules` exists
because a create that allows what an update refuses is a hole reachable by creating and then
editing. A `Renderer` turns data into a document and touches no transport.

The list is longer than it looks because it is descriptive: every suffix on it names a port that
exists. A `Reader` reads and never writes — `LogReader` is the whole reason that
distinction is worth a word, because a write method on it would silently make a derived store
authoritative ([Data and scale](data-and-scale.md) §2). Adding a suffix means adding a row here and a row in
[Files](files.md), which is the friction that keeps `Manager` out.

**`Bus` was on this list and is not any more**, and it is worth knowing why rather than rediscovering
it. An `EventBus` port was declared, faked, and deleted with no adapter — and when the design that
was going to justify it finally landed, it turned out to be a *publisher*, a *gateway* and a set of
*subscribers*. Nothing in it is a bus. A descriptive list that names a shape nobody built is the
thing this list exists not to be.

## Methods

| Pattern | Rule | Example |
|---|---|---|
| Use-case entry | Always `execute` | `execute(principal, input)` |
| Repository read, nullable | `findBy<X>` | `findById` |
| Repository read, throwing | `findBy<X>OrFail` | `findByIdOrFail` |
| Repository write | `save`, `delete` — never `update`/`insert` | `save(entity)` |
| Existence | `exists<X>` | `existsByEmail` |
| Mapping | `toDto` / `fromDto` / `toEntity` | `TaskEntity.fromDto(dto)` |
| Factory | `static from<X>` or `static create` | `CapabilitySet.from(dto)` |
| Boolean | `is` / `has` / `can` / `should` prefix | `isLockedFromAssignee()` |
| Assertion (throws) | `assert<X>` | `authorizer.assert(...)` |
| Predicate (returns) | `can<X>` | `capabilities.can(...)` |
| Aggregate read | the metric, pluralised | `dailyCounts(from, to)` |

**An aggregate read is the one row with no verb prefix, and that is deliberate.** `findBy<X>` returns
entities; these return numbers over a window, so `findByDailyCount` would be a lie about what comes
back. Name the metric and let the plural carry the "many" — and keep any permitted scope in the
signature, because a derived store cannot resolve a `CapabilitySet` for you.

**The `assert` vs `can` split is worth internalising.** `can()` answers a question; `assert()`
enforces an outcome. Mixing them produces the exact bug this architecture exists to prevent — a UI
check silently becoming the only check.

## Accessibility is explicit, always

`public`, `private`, or `protected` on every member. Enforced by Biome's
`style/useConsistentMemberAccessibility` with `accessibility: "explicit"`. An unmarked member is
public by accident rather than by decision, which is the same failure `export *` causes one level
up.

## No exported free functions in the OOP packages

`core`, `permissions`, `errors`, `observability`, `contracts`, `application`, `infrastructure`,
`auth`, `composition`, `api-client`, `asset`, `content` export classes. A namespace of static methods
on a class with a private constructor is the shape — `Locales`, `Results`, `ErrorNormalizer`.
Enforced by ESLint `no-restricted-syntax` over `packages/{…}/src/**/*.ts`
(`tooling/eslint-config/src/index.js`); Biome's `complexity/noStaticOnlyClass` is switched off
precisely to allow it.

**The scope is the shipped surface, and both halves of that are deliberate.** `src/` only, so a
spec's local `harness()` is not a violation — a test file has no public API to keep coherent, and
forcing one into a class buys nothing. Exported only, so a module-private helper beside the class
that uses it is fine; what the rule prevents is a package whose barrel is half classes and half
loose functions, where there is no answer to *where does the next one go*.

**`ui`, `query`, and `feature` are exempt**, and `apps/*` is outside the glob entirely: React
components and hooks are functions, and an app is framework-shaped by definition.

## No static mutable state

`static readonly` holding a `Map` is mutable state wearing a `readonly` keyword — the reference is
frozen, the contents are not. Derived lookups are built once at module load and frozen instead:

```ts
// packages/permissions/src/registry/permission-registry.ts
const ALL_KEYS: readonly PermissionKey[] = Object.freeze(Object.keys(CATALOG) as PermissionKey[]);
```

Enforced by ESLint `no-restricted-syntax`.
