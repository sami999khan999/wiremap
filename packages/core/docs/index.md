---
title: "@loadbearing/core"
description: Four primitives every other package may need and no feature owns — Clock, Result, Uuid, ServerOnly. One dependency, and it is a leaf.
---

# `@loadbearing/core`

One edge above the bottom of the dependency graph. Everything else may import it; it imports exactly
one thing, [`@loadbearing/errors`](../../errors/docs/index.md), because
[`ServerOnly.assert`](reference/server-only.md) throws and nothing in this repository throws a bare
`Error`. `errors` is itself a zero-dependency leaf, so the property that matters survives: `core` is
the one place where a dependency cannot be faked, and the bar for adding to it is deliberately high.

| | |
| --- | --- |
| **Package** | `@loadbearing/core` (private, never published) |
| **Entrypoint** | `src/index.ts` |
| **Depends on** | `@loadbearing/errors` — and nothing else, ever |
| **Used by** | every other package |
| **Environment** | isomorphic — server, browser, and Tauri webview |
| **Build** | `tsup` → `dist/index.js` + `dist/index.d.ts` |

```
packages/core/
├── vitest.config.ts      ← resolve.conditions: ["development"], for the errors import
├── src/
│   ├── index.ts          ← the public barrel; names only folder barrels
│   ├── import.ts         ← ServerOnlyError, from @loadbearing/errors
│   └── primitive/
│       ├── index.ts
│       ├── clock.ts      → Clock, SystemClock, FixedClock
│       ├── result.ts     → Result, Ok, Err, Results
│       ├── uuid.ts       → Uuid
│       ├── token.ts      → Token
│       └── server-only.ts → ServerOnly
└── tests/
    └── primitive/
        ├── clock.spec.ts
        ├── result.spec.ts
        ├── server-only.spec.ts
        └── uuid.spec.ts
```

---

## What belongs here

Two conditions, both required:

1. **Every other package might need it.** Not "two packages need it" — that is a case for putting
   it in whichever package owns the concept.
2. **No feature owns it.** A `Deadline` type belongs to the domain, not here, however generic it
   looks.

Everything that clears both bars is something that can never be substituted with a fake, because
there is no seam below `core` to insert one. That is the real cost of an addition, and it is why
the package has five exports rather than forty.

---

## The five primitives

### [`Clock`](reference/clock.md) — time as an injected dependency

```ts
export abstract class Clock {
  public abstract now(): Date;
}
```

`SystemClock` in production, `FixedClock` in tests. The rule it exists to enforce:

> [!IMPORTANT]
> **No code anywhere in `packages/` calls `Date.now()` or `new Date()` for a decision.**
> Formatting a display string is fine. Deciding whether something is overdue is not.

`Uuid.v7()` is the one sanctioned exception, and it is inside `core` itself — see
[uuid](reference/uuid.md).

### [`Result`](reference/result.md) — expected failure as a return value

```ts
Results.ok<number, string>(1).mapOk((n) => n + 1).unwrapOr(0); // 2
Results.err<string, number>("nope").unwrapOr(0);               // 0

if (parsed.kind === "err") {
  return this.presenter.invalid(parsed.error); // narrowed to Err
}
```

A discriminated union — `Ok<T, E> | Err<T, E>` — rather than an abstract class, because that is
the only shape that narrows in the `else` branch, after an early return, and in an exhaustive
`switch`. Deliberately the *minority* pattern: `Result` is for failures the caller branches on;
invariant violations throw a domain error instead. The table in [result](reference/result.md) is
the whole decision.

### [`Uuid`](reference/uuid.md) — time-ordered primary keys

```ts
Uuid.v7();               // "0194a5c3-8f21-7b4e-9a02-3c8d1f6e0a7b"
Uuid.isValid(someInput); // boolean
```

v7 rather than v4 so inserts land at the tail of the B-tree instead of scattering across it. The
tradeoff — IDs leak creation time — is documented rather than hidden.

### [`Token`](reference/token.md) — an opaque random string, and the digest of one

```ts
export class Token {
  public static random(bytes = 32): string;
  public static hash(value: string): Promise<string>;
}
```

`random()` goes to the recipient; `hash()` goes to the table. It is here rather than beside
`ApiKeyHasher` in `auth` because both `application` (hashing an invitation before saving it) and
`infrastructure` (hashing before looking one up) need it, and neither can reach `auth`.

### [`ServerOnly`](reference/server-only.md) — a runtime bundle-leak tripwire

```ts
// packages/infrastructure/src/index.ts
import { ServerOnly } from "@loadbearing/core";
ServerOnly.assert("@loadbearing/infrastructure");
```

Called on the first line of four barrels: `application`, `infrastructure`, `auth`, `composition`. It is the
second of three independent defences against server code reaching the browser.

---

## Two things that do not compile the obvious way

Both come from `library.json` setting `lib: ["ES2024"]` with **no DOM**, which is what makes this
package honestly isomorphic. Both are load-bearing enough to have their own note in the reference
pages, and both were found by running the build rather than by reading it.

| Written the obvious way | What happens | What the code does instead |
| --- | --- | --- |
| `typeof window !== "undefined"` | `TS2304: Cannot find name 'window'` — a `typeof` guard needs a *declared* binding | `typeof (globalThis as { window?: unknown }).window !== "undefined"` |
| `crypto.getRandomValues(…)` | compiles **only** because a spec file imports vitest, which drags `@types/node` into the program | a four-line `WebCrypto` type read off `globalThis` |

> [!CAUTION]
> The second one is the nastier of the two: it is green today and would break the moment `core`'s
> tests moved or were deleted, in a package fourteen others depend on. See
> [uuid](reference/uuid.md#why-crypto-is-not-a-global-here).

---

## One folder, two barrels

Everything this package exports lives in `primitive/`: a value type or a small class with no layer
role, which is exactly what that folder name means everywhere it appears — `content` uses it for
`Locale`. `src/` itself holds only `index.ts` and `import.ts`
([Opinions · Folders](../../../docs/opinions/folders.md)).

`primitive/index.ts` names the five exports; the root `index.ts` re-exports that one barrel. The
indirection costs a line and buys the thing barrels exist for: moving `clock.ts` into a future
`time/` folder changes two files and nothing downstream.

**If `core` ever needs a second folder, it has grown past its job.**

---

## Testing

Tests live in this package's **`tests/`** directory, named `<subject>.spec.ts` and mirroring the
`src/` tree — `src/primitive/clock.ts` is covered by `tests/primitive/clock.spec.ts`. Not colocated in `src/`, not in
`__tests__/`, and not in one repo-wide `test/` folder. Keeping specs out of `src/` keeps `src/`
equal to the shipped surface, since `tsup` builds from `src/index.ts` and the `development` export
condition resolves into `src/`; the mirrored path is what replaces adjacency.

`vitest.config.ts` narrows `include` to `tests/**/*.spec.ts` so the runner never picks up compiled
output from `dist/`. `tsconfig.json` includes `tests/**` alongside `src/**`, which is what keeps
`pnpm typecheck` covering the specs.

```bash
pnpm --filter @loadbearing/core test
```

---

## See also

- [Clock](reference/clock.md) · [Result](reference/result.md) · [Uuid](reference/uuid.md) · [Token](reference/token.md) · [ServerOnly](reference/server-only.md)
- [Build order · 07 · core](../../../docs/setup/07-core-package.md)
- [`@loadbearing/tsconfig` · base](../../../tooling/tsconfig/docs/reference/base.md) — where `lib: ["ES2024"]` and `noUncheckedIndexedAccess` come from
