---
title: result
description: Result, Ok, Err and Results — a discriminated union that narrows in every position, and the decision table for when a failure is a return value and when it is a thrown domain error.
---

# `Result<T, E>`

A two-case discriminated union. `Ok` and `Err` are classes so they can carry behaviour; `Result`
itself is the union of the two, which is what makes it narrow.

```ts
export type Result<T, E> = Ok<T, E> | Err<T, E>;
```

| Export | Kind | Carries |
| --- | --- | --- |
| `Result<T, E>` | type alias | the union — annotate with this |
| `Ok<T, E>` | class | `readonly kind: "ok"`, `readonly value: T` |
| `Err<T, E>` | class | `readonly kind: "err"`, `readonly error: E` |
| `Results` | static-only class | the `ok` / `err` factories |

Both classes implement `unwrapOr`, `mapOk` and `mapErr`, declared on an unexported `ResultBase`.

---

## Use it, or throw?

This is the part worth getting right. Getting it wrong produces either an exception-driven
codebase or one where every call site spends three lines unwrapping something that could not
have failed.

| Situation | Use |
| --- | --- |
| The operation fails as part of the normal business flow — validation, a lookup that legitimately misses, a parse of untrusted input | **`Result`** |
| An invariant is violated — the caller lacks permission, a referenced row must exist and doesn't, a config value is absent | **throw** a domain error from `application/error/` |

`ForbiddenError` throws. `NotFoundError` throws. A repository's `findByIdOrFail` throws. In all
three the caller has no meaningful recovery, and the right thing is for the transport adapter to
map the error to a status code once, at the edge.

`Result` is for the cases where the caller genuinely *does* branch.

> [!NOTE]
> **`Result` should be the minority pattern here.** `strict` and `noUncheckedIndexedAccess` already
> force most of the branches that matter. If `Result` starts appearing on every method, the
> codebase is drifting toward exception-free purism and away from readable use-cases — which is a
> worse trade than the occasional `throw`.

---

## Usage

```ts
const parsed = Email.parse(input); // Result<Email, ParseError>

if (parsed.kind === "err") {
  return this.presenter.invalid(parsed.error); // narrowed to Err
}

return this.presenter.ok(parsed.value); // narrowed to Ok
```

`mapOk` and `mapErr` transform one side and pass the other through untouched:

```ts
Results.ok<number, string>(1)
  .mapOk((n) => n + 1)
  .unwrapOr(0); // 2

Results.err<string, number>("nope")
  .mapOk((n) => n + 1)   // not called
  .mapErr((e) => e.toUpperCase())
  .unwrapOr(0);          // 0
```

`unwrapOr` is the only way out that cannot throw. There is deliberately no bare `unwrap()` — it
would be the shortest path to writing `Result` everywhere and then defeating it at every call
site.

---

## Why a union rather than an abstract class

Every other port in this codebase is an abstract class, so `Result` being a `type` is the
exception and worth justifying. It is the only shape that narrows.

The first draft was an abstract `Result` base with `isOk` / `isErr` boolean getters. Twenty-two
lines across three classes, and they bought nothing:

```ts
if (parsed.isOk) {
  parsed.value; // ✗ Property 'value' does not exist on type 'Result<number, string>'
}
```

Promoting them to type predicates (`isOk(): this is Ok<T, E>`) fixes the positive branch and
nothing else. Measured against this repo's exact compiler flags:

| Position | abstract class | union |
| --- | --- | --- |
| `if (r.isOk()) { r.value }` | ✅ | ✅ |
| the `else` branch | ❌ stays `Result<T, E>` | ✅ narrows to `Err` |
| fall-through after `if (r.isErr()) return` | ❌ | ✅ |
| negative branch of `instanceof` | ❌ | ✅ |
| `switch (r.kind)` with no `default` | ❌ not exhaustive | ✅ exhaustive |

> [!IMPORTANT]
> The cause is structural, not a missing annotation: **TypeScript can subtract a member from a
> union, but not from a class.** A value declared `Result<T, E>` where `Result` is a class has no
> "everything except `Ok`" type to narrow to in the negative branch. As `Ok<T, E> | Err<T, E>`, it
> does.

So the accessors are gone entirely. `r.kind === "ok"` is the branch, it narrows both ways, and it
makes a `switch` exhaustive without a `default` arm — which means adding a third case later would
be a compile error at every site rather than a silent fall-through.

### What it costs

A type alias cannot carry statics, so the factories moved to their own class:

```ts
Results.ok(value);   // not Result.ok(value)
Results.err(error);
```

That is the entire price. The factories exist rather than bare `new Ok(1)` because `E` is not
mentioned in the constructor and would infer as `unknown`; `Results.ok<T, E = never>` defaults it,
and `Results.err<E, T = never>` flips the order for the same reason. Constructing `Ok` and `Err`
directly still works and is not banned.

`ResultBase` is not exported. `tsup` emits it as a local `declare abstract class` that no public
signature mentions.

---

## Tests

`tests/result.spec.ts` covers the factories and the two `map` methods the ordinary way, then pins
every row of the narrowing table above.

> [!TIP]
> Those are **compile-time assertions wearing a test's clothes**. `tests/` is inside the package's
> tsconfig `include`, so a regression to a non-narrowing shape fails `pnpm typecheck` on this file
> before any test executes.
>
> The `widen` helper in that block is load-bearing: without it `Results.ok(7)` infers as
> `Ok<number, string>` rather than the union, which narrows trivially and would prove nothing.

---

## See also

- [`@loadbearing/core`](../index.md)
- [Clock](clock.md) · [Uuid](uuid.md) · [ServerOnly](server-only.md)
